import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dailySubmissions, files, knowledgeCards, messages } from "@zhiyouji/db";
import type { FakeMediaProcessor, ScoreRequest } from "../src/index.js";
import { bj, setup } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

type Call = (m: "GET" | "POST", url: string, body?: unknown) => Promise<{ json: () => any; statusCode: number }>;

async function upload(t: { app: { inject: (o: object) => Promise<{ statusCode: number }> } }, call: Call, prefix: string, kind: string, contentType: string, filename: string): Promise<string> {
  const up = (await call("POST", `${prefix}/uploads`, { kind, contentType, size: 4, filename })).json();
  await t.app.inject({ method: "PUT", url: up.upload.url, payload: Buffer.from("data"), headers: { "content-type": contentType } });
  await call("POST", `${prefix}/uploads/${up.fileId}/complete`);
  return up.fileId as string;
}

describe("getting uploads ready for the AI (part 6 §2, T1–T3)", () => {
  it("a voice explanation is transcribed before the daily review; the card comes from the transcript", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const media = t.services.mediaProcessor as FakeMediaProcessor;
    const f = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
    const call: Call = (m, url, body) => t.call(m, url, body, f.token);
    const pic = await upload(t, call, "/v1/daily", "image", "image/jpeg", "a.jpg");
    const voice = await upload(t, call, "/v1/daily", "audio", "audio/webm", "voice.webm");
    media.texts.set(voice, "我学了大气压，吸管喝饮料就是外面的空气把饮料压进嘴里。");
    const r = (await call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "voice", fileId: voice }, aiNote: "让 AI 举例子" })).json();
    expect(r.status).toBe("passed");
    const [file] = await t.db.select().from(files).where(eq(files.id, voice));
    expect(file).toMatchObject({ status: "processed", transcript: "我学了大气压，吸管喝饮料就是外面的空气把饮料压进嘴里。", durationSec: 30 });
    const [card] = await t.db.select().from(knowledgeCards);
    expect(card!.summary).toContain("吸管");
    // the evidence picture is marked processed by the worker's pass
    await t.services.media.runDue();
    expect((await t.db.select().from(files).where(eq(files.id, pic)))[0]!.status).toBe("processed");
    await t.close();
  });

  it("a file that cannot be transcribed: the review waits and retries; after 3 failures the admins hear and the review goes on", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const media = t.services.mediaProcessor as FakeMediaProcessor;
    await t.adminUser();
    const f = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
    const call: Call = (m, url, body) => t.call(m, url, body, f.token);
    const pic = await upload(t, call, "/v1/daily", "image", "image/jpeg", "a.jpg");
    const voice = await upload(t, call, "/v1/daily", "audio", "audio/webm", "bad.webm");
    media.failing.add(voice);
    const r = (await call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "voice", fileId: voice }, aiNote: "让 AI 举例子" })).json();
    expect(r.status).toBe("reviewing");
    for (let i = 0; i < 3; i++) {
      t.clock.advance(31 * 60_000);
      await t.services.daily.runDue();
    }
    const [file] = await t.db.select().from(files).where(eq(files.id, voice));
    expect(file).toMatchObject({ status: "failed", processAttempts: 3 });
    expect((await t.db.select().from(dailySubmissions))[0]!.status).not.toBe("reviewing");
    expect((await t.db.select().from(messages)).some((m) => m.type === "media_failed")).toBe(true);
    await t.close();
  });

  it("a video in a team work: transcript and key frames are ready for the AI's first score", async () => {
    const t = await contestSetup();
    const call: Call = (m, url, body) => t.a1api(m as "GET", url, body);
    const video = await upload(t, call, "/v1/season", "video", "video/mp4", "work.mp4");
    const seen: ScoreRequest[] = [];
    const ai = t.services.ai as { score: (r: ScoreRequest) => Promise<unknown> };
    const orig = ai.score.bind(ai);
    ai.score = async (r) => (seen.push(r), orig(r));
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "video", fileIds: [video], text: "我们的视频", members: [t.a1] });
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    const [file] = await t.db.select().from(files).where(eq(files.id, video));
    expect(file!.status).toBe("processed");
    expect((file!.frames as string[]).length).toBe(3);
    const mine = seen.find((r) => r.text === "我们的视频")!;
    expect(mine.transcript).toBe("（语音转写）work.mp4");
    expect(mine.images).toHaveLength(3);
    await t.close();
  });
});
