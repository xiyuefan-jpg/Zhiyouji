/** 我 (PRD part 5 G1–G5). */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, List, Selector, Switch } from "antd-mobile";
import { api } from "../api";
import { Avatar, AUTO_READ_KEY, canSpeak, PageHeader } from "../components/ui";
import { useChild, useMe, useSession } from "../session";
import { DOCS } from "./Gate";

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.1.0";

export function MeTab() {
  const me = useMe();
  const child = useChild();
  const { logout } = useSession();
  const nav = useNavigate();
  return (
    <>
      <div className="row" style={{ margin: "8px 0 22px" }}>
        <Avatar id={child.avatar} size={64} />
        <div className="grow">
          <h1 className="title" style={{ margin: 0 }}>
            {child.nickname}
          </h1>
          <div className="hint">{child.gradeLabel}</div>
        </div>
      </div>

      <List>
        <List.Item onClick={() => nav("/report?tab=messages")}>我的消息</List.Item>
        <List.Item onClick={() => nav("/me/edit")}>修改资料</List.Item>
        <List.Item onClick={() => nav("/choose")} extra={me.children.length > 1 ? `${me.children.length} 个孩子` : undefined}>
          切换孩子
        </List.Item>
      </List>

      <div style={{ height: 14 }} />
      <List>
        <List.Item onClick={() => nav("/me/settings")}>设置</List.Item>
        <List.Item onClick={() => nav("/me/privacy")}>协议与隐私</List.Item>
        <List.Item onClick={() => nav("/me/about")}>关于与 AI 公示</List.Item>
      </List>

      <div style={{ height: 14 }} />
      <List>
        <List.Item
          arrowIcon={false}
          extra={<span className="hint">{me.family.phone}</span>}
          onClick={async () => {
            const ok = await Dialog.confirm({ content: "退出登录后，下次要用家长手机号重新登录。", confirmText: "退出登录", cancelText: "取消" });
            if (ok) await logout();
          }}
        >
          <span>退出登录</span>
        </List.Item>
      </List>
    </>
  );
}

export function Settings() {
  const child = useChild();
  const { refresh } = useSession();
  const [autoRead, setAutoRead] = useState(() => {
    try {
      return localStorage.getItem(AUTO_READ_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [saving, setSaving] = useState(false);

  return (
    <>
      <PageHeader title="设置" />
      <div className="field-label">交任务时默认怎么讲解</div>
      <Selector
        columns={2}
        showCheckMark={false}
        options={[
          { label: "说话讲解", value: "voice" },
          { label: "写字讲解", value: "text" },
        ]}
        value={[child.explainPref]}
        disabled={saving}
        onChange={async (v) => {
          const pref = v[0];
          if (!pref || pref === child.explainPref) return;
          setSaving(true);
          try {
            await api.updateChild(child.id, { explainPref: pref as "voice" | "text" });
            await refresh();
          } finally {
            setSaving(false);
          }
        }}
      />

      {canSpeak() && (
        <>
          <div className="field-label">朗读</div>
          <div className="panel row">
            <div className="grow">
              <div>自动朗读</div>
              <div className="hint">打开页面时自动读出主要的文字，适合低年级。</div>
            </div>
            <Switch
              checked={autoRead}
              onChange={(v) => {
                setAutoRead(v);
                try {
                  localStorage.setItem(AUTO_READ_KEY, v ? "1" : "0");
                } catch {
                  /* storage blocked */
                }
              }}
            />
          </div>
        </>
      )}

      <div className="field-label">通知</div>
      <div className="panel">
        <p style={{ marginTop: 0 }}>所有通知都在“战报 → 我的消息”里。</p>
        <p style={{ marginBottom: 0 }}>
          这几种紧急情况还会发短信到家长手机：本组被进攻、作品离截止不到 6 小时、军需任务自己那份离截止不到 3 小时、仙品出价被超过。晚上 21:30 到早上 7:00 不发，攒到早上发。
        </p>
      </div>
    </>
  );
}

export function PrivacyPage() {
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="协议与隐私" />
      <List>
        {DOCS.map((d) => (
          <List.Item key={d.slug} onClick={() => nav(`/docs/${d.slug}`)}>
            {d.title}
          </List.Item>
        ))}
      </List>
      <div className="field-label">导出或删除数据</div>
      <div className="panel">
        <p style={{ margin: 0 }}>家长可以申请导出或删除孩子的数据。网站上的申请入口还在做，开放之前请联系老师办理。</p>
      </div>
    </>
  );
}

export function AboutPage() {
  return (
    <>
      <PageHeader title="关于与 AI 公示" />
      <div className="panel">
        <div className="row">
          <span className="grow">版本</span>
          <span className="hint">{APP_VERSION}</span>
        </div>
      </div>
      <div className="field-label">使用的 AI 模型</div>
      <div className="panel">
        <p style={{ margin: 0 }}>打分、审核、转写和生成知识卡片分别使用哪个模型，以及模型的备案号或登记编号，正式上线前公布在这里。</p>
      </div>
      <div className="field-label">插画作者</div>
      <div className="panel">
        <p style={{ margin: 0 }}>插画上线后，每幅画的作者会列在这里。</p>
      </div>
    </>
  );
}
