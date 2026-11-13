/** Admin console login and the invite page (PRD part 7 §0, part 8 §3.1). */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert, Button, Card, Form, Input, Steps, Typography } from "antd";
import QRCode from "qrcode";
import { MIN_ADMIN_PASSWORD } from "@zhiyouji/shared";
import { api } from "../api";
import { useAuth } from "../auth";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f1e3cf" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
    </div>
  );
}

const codeRule = { pattern: /^\d{6}$/, message: "请输入 6 位数字" };

export function LoginPage() {
  const { state, signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reason = state.status === "out" ? state.reason : undefined;

  async function submit(v: { email: string; password: string; totp: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(v.email.trim().toLowerCase(), v.password, v.totp.trim());
      signIn(r.token, r.me);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          智游记管理端
        </Typography.Title>
        {reason && <Alert type="info" showIcon message={reason} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入邮箱" }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item label="两步验证码" name="totp" extra="打开手机上的验证器 App，输入智游记管理端的 6 位数字。" rules={[{ required: true, message: "请输入两步验证码" }, codeRule]}>
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
          </Form.Item>
          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
          <Button type="primary" htmlType="submit" block size="large" loading={busy}>
            登录
          </Button>
        </Form>
      </Card>
    </Centered>
  );
}

/** /invite?token=… : set a password, scan the two-step QR code, confirm one code. */
export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; email: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (setup) QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [setup]);

  async function start(v: { password: string }) {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.inviteStart(token, v.password));
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(v: { code: string }) {
    setBusy(true);
    setError(null);
    try {
      await api.inviteFinish(token, v.code.trim());
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          开通管理端账号
        </Typography.Title>
        <Steps size="small" current={step} items={[{ title: "设密码" }, { title: "两步验证" }, { title: "完成" }]} style={{ marginBottom: 24 }} />
        {!token && <Alert type="error" message="邀请链接不完整，请向管理员要一个新的。" />}
        {token && step === 0 && (
          <Form layout="vertical" onFinish={start} requiredMark={false}>
            <Form.Item label="设一个密码" name="password" extra={`至少 ${MIN_ADMIN_PASSWORD} 位。`} rules={[{ required: true, min: MIN_ADMIN_PASSWORD, message: `密码至少 ${MIN_ADMIN_PASSWORD} 位` }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="再输一遍"
              name="again"
              dependencies={["password"]}
              rules={[
                { required: true, message: "请再输一遍" },
                ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一样"))) }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
            <Button type="primary" htmlType="submit" block loading={busy}>
              下一步
            </Button>
          </Form>
        )}
        {step === 1 && setup && (
          <Form layout="vertical" onFinish={finish} requiredMark={false}>
            <Typography.Paragraph>用手机上的验证器 App（例如 Google Authenticator、Microsoft Authenticator）扫这个二维码，然后输入它显示的 6 位数字。</Typography.Paragraph>
            <div style={{ textAlign: "center", marginBottom: 12 }}>{qr ? <img src={qr} alt="两步验证二维码" width={220} height={220} /> : null}</div>
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              扫不了的话，手动输入密钥：<Typography.Text code copyable>{setup.secret}</Typography.Text>
            </Typography.Paragraph>
            <Form.Item label="6 位数字" name="code" rules={[{ required: true, message: "请输入 6 位数字" }, codeRule]}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
            </Form.Item>
            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
            <Button type="primary" htmlType="submit" block loading={busy}>
              完成
            </Button>
          </Form>
        )}
        {step === 2 && (
          <>
            <Alert type="success" showIcon message={`账号 ${setup?.email ?? ""} 已开通。以后登录要输邮箱、密码和验证器上的数字。`} style={{ marginBottom: 16 }} />
            <Button type="primary" block onClick={() => nav("/", { replace: true })}>
              去登录
            </Button>
          </>
        )}
      </Card>
    </Centered>
  );
}
