/**
 * 家长确认 (PRD part 5 A2, part 8 §2.1–2.2): the parent reads what is
 * collected, why, who sees it and for how long, then presses 同意 or 不同意.
 * Shown after the first login and again whenever the documents change.
 */

import { useState } from "react";
import { Button } from "antd-mobile";
import { api } from "../api";
import { useMe, useSession } from "../session";
import { DocLinks } from "./Gate";

export function Consent() {
  const me = useMe();
  const { refresh, logout } = useSession();
  const [reading, setReading] = useState(!me.refused);
  const [busy, setBusy] = useState<"agree" | "disagree" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const again = !me.refused && me.children.length > 0;

  async function choose(choice: "agree" | "disagree") {
    setBusy(choice);
    setError(null);
    try {
      await api.consent(choice, me.policyVersion);
      await refresh();
      if (choice === "disagree") setReading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!reading)
    return (
      <div className="page">
        <h1 className="title">家长没有同意</h1>
        <div className="panel">
          <p style={{ marginTop: 0 }}>所以暂时不能使用智游记。</p>
          <p style={{ marginBottom: 0 }}>如果改变主意，可以重新阅读后点“同意”。</p>
        </div>
        <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
          <Button className="big-button" color="primary" block onClick={() => setReading(true)}>
            重新阅读
          </Button>
          <Button className="big-button quiet-button" block onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
      </div>
    );

  return (
    <div className="page">
      <h1 className="title">家长确认</h1>
      <p className="subtitle">{again ? "协议有更新，请家长重新读一下再选择。" : "请家长读完后选择。同意后，这个手机号下的所有孩子都可以使用。"}</p>

      <div className="panel doc-text">
        <p>
          <strong>我们保存什么</strong>
          <br />
          家长的手机号（用来登录和接收提醒短信）；孩子的昵称、头像、年级；孩子交的学习内容：照片、讲解录音、文字和团队作品。不收集姓名、学校、身份证号和位置。
        </p>
        <p>
          <strong>用来做什么</strong>
          <br />
          组织学习赛季、给作品打分、生成孩子的学习记录。
        </p>
        <p>
          <strong>谁会看到</strong>
          <br />
          作品由评审人员在线查看和打分，评审人员中有在境外的中国籍大学生。作品结算后，其他用户（包括观战的人）可以看到，作品上不显示真实姓名。
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>保存多久</strong>
          <br />
          孩子的账号在使用，学习记录就一直保存；注销后删除。连续 2 年没有登录的，会提前 30 天短信通知家长，没有回应的删除。家长可以随时申请导出或删除孩子的数据。
        </p>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        完整内容见：
      </p>
      <DocLinks />

      {error && (
        <p role="alert" style={{ color: "var(--vermilion)" }}>
          {error}
        </p>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        <Button className="big-button" color="primary" block loading={busy === "agree"} disabled={busy !== null} onClick={() => void choose("agree")}>
          同意
        </Button>
        <Button className="big-button quiet-button" block loading={busy === "disagree"} disabled={busy !== null} onClick={() => void choose("disagree")}>
          不同意
        </Button>
      </div>
    </div>
  );
}
