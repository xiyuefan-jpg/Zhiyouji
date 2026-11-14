import { FilePicker } from "../components/FilePicker";
/**
 * 每日任务 (PRD part 5 C1–C3, §3.1): choose a template, hand in evidence
 * pictures, an explanation and one line on how AI was used, then the result.
 * The explanation is spoken (hold to talk, up to 90 seconds) or written
 * (50–150 characters); the child's default comes from the profile.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Checkbox, Input, TextArea } from "antd-mobile";
import { DAILY_TEMPLATES, DAILY_TEXT_MAX, DAILY_TEXT_MIN, EXPLAIN_HINTS } from "@zhiyouji/shared";
import { ApiError, request } from "../api";
import { Empty, PageHeader, ReadAloud, Seal } from "../components/ui";
import { ticketUploader } from "../platform/upload";
import type { Recording } from "../platform/recorder";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { useChild } from "../session";
import { useLoad } from "./season/useSeason";

interface Today {
  passedToday: number;
  retriesLeft: number;
  season: { countedToday: number; capPerDay: number; countedThisWeek: number; capPerWeek: number } | null;
}

interface Result {
  id: string;
  status: "reviewing" | "passed" | "failed" | "error";
  feedbackGood: string | null;
  feedbackBetter: string | null;
  failReason: string | null;
  grain: number | null;
  counted: boolean | null;
  card: { id: string; title: string; summary: string; tag: string | null } | null;
  templateId: number;
  explainKind?: "voice" | "text";
  explainText?: string | null;
  aiNote?: string | null;
  noAi?: boolean;
  evidenceFileIds?: string[];
}

const uploader = ticketUploader("/v1/daily", request);

/** C1: the six templates and today's count. */
export function DailyHome() {
  const today = useLoad(() => request<Today>("GET", "/v1/daily/today"));
  return (
    <div className="page">
      <PageHeader title="去修行" />
      {today.data?.season && (
        <p className="subtitle">
          今天已计 {today.data.season.countedToday}/{today.data.season.capPerDay} 次、本周 {today.data.season.countedThisWeek}/{today.data.season.capPerWeek} 次
        </p>
      )}
      {today.data && today.data.retriesLeft < 3 && (
        <p className="hint">{today.data.retriesLeft > 0 ? `今天没通过的还可以再交 ${today.data.retriesLeft} 次。` : "今天没通过的次数用完了，明天再来。"}</p>
      )}
      {DAILY_TEMPLATES.map((t) => (
        <Link key={t.id} to={`/daily/new/${t.id}`} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
          <Seal text={String(t.id)} size={36} tilt={0} outline />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{t.name}</div>
            <div className="hint">{t.prompt}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** C2: hand in. */
export function DailyNew() {
  const { templateId = "1" } = useParams();
  const tpl = DAILY_TEMPLATES.find((t) => String(t.id) === templateId) ?? DAILY_TEMPLATES[0];
  const nav = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const child = useChild();
  const [mode, setMode] = useState<"voice" | "text">(child.explainPref === "text" ? "text" : "voice");
  const [voice, setVoice] = useState<Recording | null>(null);
  const [text, setText] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [noAi, setNoAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = [...text].length;
  // "改一改再交": start from the last hand-in (its text, AI line and evidence pictures)
  const [search] = useSearchParams();
  const from = search.get("from");
  const [oldEvidence, setOldEvidence] = useState<string[]>([]);
  useEffect(() => {
    if (!from) return;
    request<Result>("GET", `/v1/daily/submissions/${from}`).then(
      (r) => {
        if (r.explainKind === "text" && r.explainText) {
          setMode("text");
          setText(r.explainText);
        }
        if (r.noAi) setNoAi(true);
        else if (r.aiNote) setAiNote(r.aiNote);
        setOldEvidence(r.evidenceFileIds ?? []);
      },
      () => undefined,
    );
  }, [from]);

  const submit = async () => {
    setError(null);
    if (files.length === 0 && oldEvidence.length === 0) return setError("至少交一张证据图片");
    if (mode === "voice" && !voice) return setError("先按住说话，录一段讲解");
    if (mode === "text" && (n < DAILY_TEXT_MIN || n > DAILY_TEXT_MAX)) return setError(`文字讲解要 ${DAILY_TEXT_MIN} 到 ${DAILY_TEXT_MAX} 个字`);
    if (!noAi && !aiNote.trim()) return setError("说一句你是怎么用 AI 的");
    setBusy(true);
    try {
      const ids: string[] = files.length === 0 ? [...oldEvidence] : [];
      for (const f of files) ids.push((await uploader.upload(f, { purpose: "image" })).fileId);
      const explain = mode === "voice" ? { kind: "voice" as const, fileId: (await uploader.upload(voice!.blob, { purpose: "audio", durationSec: voice!.durationMs / 1000 })).fileId } : { kind: "text" as const, text };
      const r = await request<Result>("POST", "/v1/daily/submissions", {
        templateId: tpl.id,
        evidenceFileIds: ids,
        explain,
        ...(noAi ? { noAi: true } : { aiNote }),
      });
      nav(`/daily/${r.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={tpl.name} right={<ReadAloud text={tpl.prompt} />} />
      <p className="subtitle">{tpl.prompt}</p>

      <div className="field-label">证据：{tpl.evidence}</div>
      <FilePicker label="选图片或拍照" accept="image/*" multiple max={9} files={files} onChange={setFiles} />
      {oldEvidence.length > 0 && files.length === 0 && <p className="hint">没有选新图片时，沿用上次的 {oldEvidence.length} 张证据图片。</p>}

      <div className="field-label">讲解</div>
      <div className="hint">
        {EXPLAIN_HINTS.map((h, i) => (
          <div key={h}>
            {i === 0 ? "①" : "②"} {h}
          </div>
        ))}
      </div>
      {mode === "voice" ? (
        <VoiceRecorder maxSeconds={90} onChange={setVoice} onUseText={() => setMode("text")} />
      ) : (
        <>
          <TextArea className="text-input" placeholder="写 50–150 个字" value={text} onChange={setText} rows={5} maxLength={DAILY_TEXT_MAX} showCount />
          <button type="button" onClick={() => setMode("voice")} style={{ border: "none", background: "none", color: "var(--ochre)", marginTop: 6 }}>
            改成说话
          </button>
        </>
      )}

      <div className="field-label">你是怎么用 AI 的？</div>
      {!noAi && <Input className="text-input" placeholder="一句话就好" value={aiNote} onChange={setAiNote} />}
      {tpl.noAiAllowed && (
        <Checkbox checked={noAi} onChange={setNoAi} style={{ marginTop: 10 }}>
          没用 AI
        </Checkbox>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--vermilion)" }}>
          {error}
        </p>
      )}
      <Button color="primary" className="big-button" block loading={busy} style={{ marginTop: 22 }} onClick={() => void submit()}>
        交上去
      </Button>
    </div>
  );
}

/** C3: the result. */
export function DailyResult() {
  const { id = "" } = useParams();
  const r = useLoad(() => request<Result>("GET", `/v1/daily/submissions/${id}`), [id]);
  if (!r.data) return <div className="page">{r.error ?? "正在加载……"}</div>;
  const d = r.data;
  return (
    <div className="page">
      <PageHeader title="审核结果" />
      {(d.status === "reviewing" || d.status === "error") && (
        <Empty title="土地公正在看……">
          结果出来会告诉你。
          <div style={{ marginTop: 12 }}>
            <Button onClick={r.reload}>刷新</Button>
          </div>
        </Empty>
      )}
      {d.status === "passed" && (
        <>
          <div className="panel">
            <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700 }}>{d.card?.title}</div>
            <div className="hint">{d.card?.tag}</div>
            <p>{d.card?.summary}</p>
            {d.card && <Link to={`/journal/cards/${d.card.id}`}>在修行日志里看这张卡片</Link>}
          </div>
          <div className="panel">
            <p>{d.feedbackGood}</p>
            <p>{d.feedbackBetter}</p>
          </div>
          <p>{d.counted ? `本组粮草 +${d.grain}` : d.counted === false ? "今天已计满，这次记进修行日志" : "已经记进修行日志"}</p>
        </>
      )}
      {d.status === "failed" && (
        <>
          <div className="panel">
            <div style={{ fontWeight: 600 }}>还差一点</div>
            <p>{d.failReason}</p>
          </div>
          <Link to={`/daily/new/${d.templateId}?from=${d.id}`}>
            <Button color="primary" className="big-button" block style={{ marginTop: 16 }}>
              改一改再交
            </Button>
          </Link>
        </>
      )}
      <Link to="/" style={{ display: "block", marginTop: 16 }}>
        回到首页
      </Link>
    </div>
  );
}
