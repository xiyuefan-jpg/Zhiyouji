/**
 * Getting uploaded files ready for the AI (PRD part 6 §2, T1–T3):
 * - audio → speech-to-text (T1);
 * - video → speech-to-text of the sound track (T1) and key frames, one every
 *   10 seconds, at most 30 (T2), stored next to the video;
 * - PDF → its text (T3);
 * - images need nothing.
 *
 * The worker processes new uploads in the background; the daily-task review
 * and the work scoring also call `ensure` so they never run before the
 * material is ready ("材料齐了"). A file that fails 3 times is marked failed
 * and the AI works with what it has (the reviewer still sees the file).
 *
 * The real services (Aliyun speech recognition, media processing) replace the
 * fake once the accounts exist.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { files, type Db } from "@zhiyouji/db";
import type { AiUsage } from "./ai.js";
import type { Clock } from "./clock.js";
import type { ServerConfig } from "./config.js";
import type { Notifier } from "./notify/notifier.js";
import type { ObjectStorage } from "./storage.js";

export interface MediaInput {
  fileId: string;
  kind: "audio" | "video" | "pdf";
  contentType: string;
  filename: string | null;
  /** Short-lived URL the service can read the file from. */
  url: string;
}

/** Which service the gateway picked (primary or the backup one; part 6 §5 "换备用的语音识别服务"). */
export interface MediaCallOptions {
  provider?: string;
  model?: string;
}

export interface MediaProcessor {
  /** Speech-to-text (audio, or a video's sound track). */
  transcribe(i: MediaInput, opts?: MediaCallOptions): Promise<{ text: string; durationSec: number | null; usage?: AiUsage }>;
  /** Key frames of a video: every `everySec` seconds, at most `max`. */
  keyFrames(i: MediaInput, opts: { everySec: number; max: number } & MediaCallOptions): Promise<{ bytes: Buffer; contentType: string }[]>;
  /** The text of a document. */
  parseDocument(i: MediaInput, opts?: MediaCallOptions): Promise<{ text: string; usage?: AiUsage }>;
}

/** Deterministic stand-in: tests can set a transcript per file id or name, or make a file fail. */
export class FakeMediaProcessor implements MediaProcessor {
  readonly texts = new Map<string, string>();
  /** Length in seconds per file id or name (default 30). */
  readonly durations = new Map<string, number>();
  readonly failing = new Set<string>();
  calls = 0;

  private check(i: MediaInput) {
    this.calls++;
    if (this.failing.has(i.fileId) || this.failing.has(i.filename ?? "")) throw new Error("fake media failure");
  }
  async transcribe(i: MediaInput) {
    this.check(i);
    return { text: this.texts.get(i.fileId) ?? this.texts.get(i.filename ?? "") ?? `（语音转写）${i.filename ?? "录音"}`, durationSec: this.durations.get(i.fileId) ?? this.durations.get(i.filename ?? "") ?? 30 };
  }
  async keyFrames(i: MediaInput, opts: { everySec: number; max: number }) {
    this.check(i);
    return Array.from({ length: Math.min(3, opts.max) }, () => ({ bytes: Buffer.from("frame"), contentType: "image/jpeg" }));
  }
  async parseDocument(i: MediaInput) {
    this.check(i);
    return { text: this.texts.get(i.fileId) ?? this.texts.get(i.filename ?? "") ?? `（文档文字）${i.filename ?? "文件"}` };
  }
}

export const FRAME_EVERY_SEC = 10;
export const FRAME_MAX = 30;
export const MAX_ATTEMPTS = 3;

type FileRow = typeof files.$inferSelect;

export class MediaPipeline {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly storage: ObjectStorage,
    private readonly processor: MediaProcessor,
    private readonly notifier?: Notifier,
    private readonly limits?: ServerConfig["uploads"],
  ) {}

  /**
   * Hard length limit of a processed team file (part 3 §20.6): video or audio
   * ≤10 minutes. A child's daily narration (≤90 s) is capped by the recorder
   * and checked when the upload starts and when it is handed in; once handed
   * in it is reviewed as it is (no message here, it would only confuse).
   */
  private maxSec(f: FileRow): number | null {
    if (!this.limits || !f.teamId || (f.kind !== "audio" && f.kind !== "video")) return null;
    return this.limits.maxDurationSec[f.kind];
  }

  /**
   * The browser did not say (or said less): the real length is over the limit.
   * Tell the child who uploaded it; handing the file in is refused from now on.
   */
  private async tooLong(f: FileRow, durationSec: number): Promise<void> {
    const max = this.maxSec(f);
    if (max === null || !this.limits || durationSec <= max + this.limits.durationGraceSec || !this.notifier) return;
    const what = f.kind === "video" ? "视频" : "音频";
    const limit = max % 60 === 0 ? `${max / 60} 分钟` : `${max} 秒`;
    await this.notifier.notify({
      kind: "system",
      childIds: [f.childId],
      serverId: f.serverId,
      title: `${what}太长了`,
      body: `你传的${what}${f.filename ? `「${f.filename}」` : ""}超过了 ${limit}，交作品时用不了。请剪短一点再传。`,
      link: null,
      dedupeKey: `media_too_long:${f.id}`,
    });
  }

  /** Process one file now. Returns false when it failed this time (it may be tried again). */
  async process(f: FileRow): Promise<boolean> {
    if (f.status !== "uploaded") return true;
    const now = this.clock.now();
    if (f.kind === "image") {
      await this.db.update(files).set({ status: "processed", processedAt: now }).where(eq(files.id, f.id));
      return true;
    }
    try {
      const input: MediaInput = { fileId: f.id, kind: f.kind as MediaInput["kind"], contentType: f.contentType, filename: f.filename, url: await this.storage.downloadUrl(f.storageKey, +now) };
      const set: Partial<FileRow> = { status: "processed", processedAt: now, processError: null };
      if (f.kind === "audio" || f.kind === "video") {
        const t = await this.processor.transcribe(input);
        set.transcript = t.text;
        if (t.durationSec !== null) set.durationSec = Math.round(t.durationSec);
      }
      if (f.kind === "video") {
        const frames = await this.processor.keyFrames(input, { everySec: FRAME_EVERY_SEC, max: FRAME_MAX });
        const keys: string[] = [];
        for (const [i, fr] of frames.slice(0, FRAME_MAX).entries()) {
          const key = `${f.storageKey}/frame-${String(i + 1).padStart(2, "0")}.jpg`;
          await this.storage.put(key, fr.bytes, fr.contentType);
          keys.push(key);
        }
        set.frames = keys;
      }
      if (f.kind === "pdf") set.transcript = (await this.processor.parseDocument(input)).text;
      await this.db.update(files).set(set).where(eq(files.id, f.id));
      if (set.durationSec != null) await this.tooLong(f, set.durationSec);
      return true;
    } catch (err) {
      const attempts = f.processAttempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await this.db
        .update(files)
        .set({ processAttempts: attempts, processError: String((err as Error).message ?? err).slice(0, 300), ...(failed ? { status: "failed" } : {}) })
        .where(eq(files.id, f.id));
      if (failed && this.notifier)
        await this.notifier.notifyAdmins({
          kind: "media_failed",
          title: "文件处理失败",
          body: `一个${f.kind === "pdf" ? "文档" : f.kind === "video" ? "视频" : "录音"}转写 / 解析失败了 ${MAX_ATTEMPTS} 次，AI 将只看文字部分；复核员仍能打开原文件。`,
          link: null,
          dedupeKey: `media_failed:${f.id}`,
          roles: ["admin"],
        });
      return false;
    }
  }

  /**
   * Make sure these files are processed before the AI looks at them. Throws
   * when one is still not ready after this try (the caller retries later);
   * files that failed for good are skipped.
   */
  async ensure(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    const rows = await this.db.select().from(files).where(inArray(files.id, fileIds));
    let missing = 0;
    for (const f of rows) if (f.status === "uploaded" && !(await this.process(f))) missing++;
    if (missing) throw new Error(`${missing} 个文件还没处理好`);
  }

  /** Worker: process new uploads in the background. */
  async runDue(limit = 50): Promise<{ processed: number; failed: number }> {
    const rows = await this.db.select().from(files).where(and(eq(files.status, "uploaded"))).orderBy(asc(files.uploadedAt)).limit(limit);
    let processed = 0;
    let failed = 0;
    for (const f of rows) (await this.process(f)) ? processed++ : failed++;
    return { processed, failed };
  }
}
