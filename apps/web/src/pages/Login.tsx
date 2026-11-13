/** Login with the parent's phone number and an SMS code (PRD part 5 A2). */

import { useState } from "react";
import { Button, Dialog, Input } from "antd-mobile";
import { isMainlandMobile } from "@zhiyouji/shared";
import { api, ApiError } from "../api";
import { Seal, useCountdown } from "../components/ui";
import { useSession } from "../session";

export function Login() {
  const { setMe } = useSession();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [sent, setSent] = useState(false);
  const [left, startCountdown] = useCountdown();

  const phoneOk = isMainlandMobile(phone);

  async function sendCode(captcha?: string) {
    setError(null);
    if (!phoneOk) {
      setError("请输入正确的手机号");
      return;
    }
    setSending(true);
    try {
      const r = await api.sendCode(phone, captcha);
      setSent(true);
      startCountdown(r.resendAfterMs);
    } catch (e) {
      if (e instanceof ApiError && e.code === "captcha_required") {
        // TODO(Aliyun captcha): show the real graphic captcha once the account exists.
        const ok = await Dialog.confirm({ title: "安全验证", content: "验证码输错的次数有点多。为了账号安全，请确认是本人操作。", confirmText: "是我本人", cancelText: "取消" });
        if (ok) return sendCode("web-confirm");
      } else if (e instanceof ApiError && e.code === "too_soon" && typeof e.extra.retryAfterMs === "number") {
        startCountdown(e.extra.retryAfterMs);
        setSent(true);
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function login() {
    setError(null);
    setLoggingIn(true);
    try {
      const r = await api.login(phone, code);
      setMe(r.me);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "center", margin: "40px 0 18px" }}>
        <Seal size={84} />
      </div>
      <h1 className="title" style={{ textAlign: "center" }}>
        登录
      </h1>
      <p className="subtitle" style={{ textAlign: "center" }}>
        用家长的手机号登录，第一次会自动创建账号
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (phoneOk && /^\d{6}$/.test(code)) void login();
        }}
      >
        <label className="field-label" htmlFor="phone" style={{ display: "block" }}>
          家长手机号
        </label>
        <Input
          id="phone"
          className="text-input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="11 位手机号"
          maxLength={11}
          value={phone}
          onChange={(v) => setPhone(v.replace(/\D/g, ""))}
          clearable
        />

        <label className="field-label" htmlFor="code" style={{ display: "block" }}>
          短信验证码
        </label>
        <div className="row">
          <Input
            id="code"
            className="text-input grow"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位数字"
            maxLength={6}
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, ""))}
          />
          <Button
            className="quiet-button"
            style={{ height: 50, borderRadius: 12, minWidth: 116 }}
            disabled={!phoneOk || left > 0}
            loading={sending}
            onClick={() => void sendCode()}
          >
            {left > 0 ? `${left} 秒后重发` : sent ? "重新获取" : "获取验证码"}
          </Button>
        </div>
        {sent && <p className="hint">验证码已发到 {phone.slice(0, 3)}****{phone.slice(7)}，5 分钟内有效。</p>}

        {error && (
          <p role="alert" style={{ color: "var(--vermilion)", margin: "14px 0 0" }}>
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="big-button"
          color="primary"
          block
          style={{ marginTop: 26 }}
          loading={loggingIn}
          disabled={!phoneOk || !/^\d{6}$/.test(code)}
        >
          登录
        </Button>
      </form>
    </div>
  );
}
