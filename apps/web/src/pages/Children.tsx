/** 我是谁 and child profiles (PRD part 5 A3, G1, G2). */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Input, Selector } from "antd-mobile";
import { AddOutline } from "antd-mobile-icons";
import { AVATARS, GRADE_LABELS, MAX_GRADE, MIN_GRADE, type ChildView } from "@zhiyouji/shared";
import { api } from "../api";
import { Avatar, AVATAR_GLYPHS, PageHeader, ReadAloud, useAutoRead } from "../components/ui";
import { useMe, useSession } from "../session";

export function ChooseChild() {
  const me = useMe();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useAutoRead("我是谁？点一下自己的名字。");

  if (me.children.length === 0) return <ChildForm first />;

  async function pick(c: ChildView) {
    setBusy(c.id);
    setError(null);
    try {
      await api.chooseChild(c.id);
      await refresh();
      nav("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="row" style={{ marginTop: 24 }}>
        <h1 className="title grow">我是谁？</h1>
        <ReadAloud text="我是谁？点一下自己的名字。" />
      </div>
      <p className="subtitle">点一下自己的名字。</p>
      <div style={{ display: "grid", gap: 12 }}>
        {me.children.map((c) => (
          <button
            key={c.id}
            type="button"
            className="panel row"
            disabled={busy !== null}
            onClick={() => void pick(c)}
            aria-label={`${c.nickname}，${c.gradeLabel}`}
            style={{ width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", outline: c.id === me.activeChildId ? "2px solid var(--earth)" : undefined }}
          >
            <Avatar id={c.avatar} size={56} />
            <div className="grow">
              <div style={{ fontFamily: "var(--serif)", fontWeight: 700, fontSize: 21 }}>{c.nickname}</div>
              <div className="hint">{c.gradeLabel}</div>
            </div>
            {busy === c.id && <span className="hint">进入中…</span>}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--vermilion)" }}>
          {error}
        </p>
      )}
      <Button className="big-button quiet-button" block style={{ marginTop: 20 }} onClick={() => nav("/children/new")}>
        <AddOutline /> 添加孩子
      </Button>
    </div>
  );
}

const gradeOptions = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, i) => ({ label: GRADE_LABELS[i + MIN_GRADE]!, value: i + MIN_GRADE }));
const explainOptions = [
  { label: "说话讲解", value: "voice" as const },
  { label: "写字讲解", value: "text" as const },
];

/** New child (first = no child yet, right after the parent agreed) or edit an existing one. */
export function ChildForm({ first = false, child }: { first?: boolean; child?: ChildView }) {
  const { refresh } = useSession();
  const nav = useNavigate();
  const [nickname, setNickname] = useState(child?.nickname ?? "");
  const [grade, setGrade] = useState<number | null>(child?.grade ?? null);
  const [avatar, setAvatar] = useState<string>(child?.avatar ?? "a1");
  const [explainPref, setExplainPref] = useState<"voice" | "text">(child?.explainPref ?? "voice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = nickname.trim().length >= 1 && nickname.trim().length <= 12 && grade !== null;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      if (child) {
        await api.updateChild(child.id, { nickname: nickname.trim(), grade: grade!, avatar: avatar as (typeof AVATARS)[number], explainPref });
        await refresh();
        nav(-1);
      } else {
        const r = await api.createChild({ nickname: nickname.trim(), grade: grade!, avatar: avatar as (typeof AVATARS)[number], explainPref });
        if (first) await api.chooseChild(r.child.id);
        await refresh();
        nav(first ? "/" : "/choose", { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      {first ? (
        <>
          <h1 className="title" style={{ marginTop: 24 }}>
            给孩子建个档案
          </h1>
          <p className="subtitle">一个手机号下可以有几个孩子，以后在“我”里还能再加。</p>
        </>
      ) : (
        <PageHeader title={child ? "修改资料" : "添加孩子"} />
      )}

      <label className="field-label" htmlFor="nickname" style={{ display: "block" }}>
        昵称
      </label>
      <Input id="nickname" className="text-input" placeholder="1–12 个字" maxLength={12} value={nickname} onChange={setNickname} />
      <p className="hint" style={{ margin: "6px 0 0" }}>
        填昵称就行，不用填真实姓名。
      </p>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="field-label grow" style={{ margin: 0 }}>
          现在几年级？
        </div>
        <ReadAloud text="现在几年级？" />
      </div>
      <Selector
        style={{ marginTop: 8, "--checked-color": "var(--blush)" } as React.CSSProperties}
        columns={4}
        options={gradeOptions}
        value={grade === null ? [] : [grade]}
        onChange={(v) => setGrade(v[0] ?? null)}
        showCheckMark={false}
      />

      <div className="field-label">选一个头像</div>
      <div role="radiogroup" aria-label="头像" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={avatar === a}
            aria-label={`头像 ${AVATAR_GLYPHS[a]!.glyph}`}
            onClick={() => setAvatar(a)}
            style={{
              border: avatar === a ? "2px solid var(--ochre)" : "2px solid transparent",
              borderRadius: "50%",
              padding: 2,
              background: "none",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Avatar id={a} size={44} />
          </button>
        ))}
      </div>

      <div className="field-label">交任务时默认怎么讲解</div>
      <Selector
        columns={2}
        options={explainOptions}
        value={[explainPref]}
        onChange={(v) => v[0] && setExplainPref(v[0])}
        showCheckMark={false}
      />
      <p className="hint" style={{ margin: "6px 0 0" }}>
        每次交任务时还能换。
      </p>

      {error && (
        <p role="alert" style={{ color: "var(--vermilion)" }}>
          {error}
        </p>
      )}
      <Button className="big-button" color="primary" block style={{ marginTop: 28 }} disabled={!valid} loading={busy} onClick={() => void save()}>
        {child ? "保存" : first ? "建好了，开始" : "添加"}
      </Button>
    </div>
  );
}

/** Edit the chosen child (我 → 修改资料). */
export function EditChild() {
  const me = useMe();
  const child = me.children.find((c) => c.id === me.activeChildId);
  return child ? <ChildForm child={child} /> : null;
}
