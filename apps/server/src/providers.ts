/**
 * Outside services behind small interfaces. Until the Aliyun accounts exist
 * (PRD part 9 §1) the server runs with the fake versions below; the real ones
 * (Aliyun SMS, Aliyun captcha) plug in without touching the callers.
 */

import type { SmsTemplate } from "@zhiyouji/shared";

export interface SmsResult {
  ok: boolean;
  /** Provider's message id. */
  id?: string;
  error?: string;
}

export interface SmsProvider {
  /** Login code (sent right away, not through the reminder outbox). */
  sendCode(phone: string, code: string): Promise<SmsResult>;
  /** Reminder with a fixed approved template. */
  sendReminder(phone: string, template: SmsTemplate): Promise<SmsResult>;
}

export interface CaptchaVerifier {
  /** Check a graphic captcha token from the website. */
  verify(token: string, ip: string | undefined): Promise<boolean>;
}

/** Records what would have been sent. `fail` makes the next sends fail (tests). */
export class FakeSms implements SmsProvider {
  sent: { phone: string; kind: "code" | SmsTemplate; code?: string; at: number }[] = [];
  fail = false;
  private n = 0;

  async sendCode(phone: string, code: string): Promise<SmsResult> {
    if (this.fail) return { ok: false, error: "fake failure" };
    this.sent.push({ phone, kind: "code", code, at: Date.now() });
    return { ok: true, id: `fake-${++this.n}` };
  }

  async sendReminder(phone: string, template: SmsTemplate): Promise<SmsResult> {
    if (this.fail) return { ok: false, error: "fake failure" };
    this.sent.push({ phone, kind: template, at: Date.now() });
    return { ok: true, id: `fake-${++this.n}` };
  }

  /** Last code sent to a phone (tests and local development). */
  lastCode(phone: string): string | undefined {
    return [...this.sent].reverse().find((s) => s.phone === phone && s.kind === "code")?.code;
  }
}

/** Accepts any token except "bad" (tests and local development). */
export class FakeCaptcha implements CaptchaVerifier {
  async verify(token: string): Promise<boolean> {
    return token !== "bad";
  }
}
