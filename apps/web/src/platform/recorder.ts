/**
 * Voice recording behind a small interface (PROGRESS "网站先行"): the website
 * uses the browser's MediaRecorder; the packaged app later swaps in a native
 * recorder without touching the pages.
 */

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface Recorder {
  /** Can this browser record at all? (Some in-app browsers cannot: offer writing instead.) */
  supported(): boolean;
  start(): Promise<void>;
  stop(): Promise<Recording>;
  cancel(): void;
}

const PREFERRED = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickMimeType(isSupported: (t: string) => boolean): string | undefined {
  return PREFERRED.find((t) => isSupported(t));
}

export class BrowserRecorder implements Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stream: MediaStream | null = null;

  supported(): boolean {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.startedAt = Date.now();
    this.rec.start(1000);
  }

  stop(): Promise<Recording> {
    const rec = this.rec;
    if (!rec) return Promise.reject(new Error("not recording"));
    return new Promise((resolve) => {
      rec.onstop = () => {
        const mimeType = rec.mimeType || "audio/webm";
        resolve({ blob: new Blob(this.chunks, { type: mimeType }), mimeType, durationMs: Date.now() - this.startedAt });
        this.release();
      };
      rec.stop();
    });
  }

  cancel(): void {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

export const recorder: Recorder = new BrowserRecorder();
