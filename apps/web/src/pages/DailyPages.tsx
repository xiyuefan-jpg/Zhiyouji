import { FilePicker } from "../components/FilePicker";
/**
 * 每日任务 (PRD part 5 C1–C3, §3.1): choose a template, hand in evidence
 * pictures, an explanation and one line on how AI was used, then the result.
 * The explanation is spoken (hold to talk, up to 90 seconds) or written
 * (50–150 characters); the child's default comes from the profile.
 */

import { useEffect, useRef, useState } from "react";
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
import { RETRY_WAITS_MS, clearDraft, isTransient, loadDraftBlobs, loadDraftText, newClientKey, saveDraftBlobs, saveDraftText } from "../platform/drafts";

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
  // "改一改再交": start from the last hand-in (its text, AI line and evidence pictures)
  const [search] = useSearchParams();
  const from = search.get("from");
  // §3.1 "内容先存在手机上": what was not handed in last time comes back (not when re-doing a hand-in)
  const [draft] = useState(() => (from ? null : loadDraftText(child.id, tpl.id)));
  const clientKey = useRef(draft?.clientKey ?? newClientKey());
  const [mode, setMode] = useState<"voice" | "text">(draft?.mode ?? (child.explainPref === "text" ? "text" : "voice"));
  const [voice, setVoice] = useState<Recording | null>(null);
  const [voiceRestored, setVoiceRestored] = useState<Recording | null>(null);
  const [text, setText] = useState(draft?.text ?? "");
  const [aiNote, setAiNote] = useState(draft?.aiNote ?? "");
  const [noAi, setNoAi] = useState(draft?.noAi ?? false);
  const [restored, setRestored] = useState(!!draft && !!(draft.text || draft.aiNote));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<number>(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploaded = useRef(new Map<Blob, string>());
  const n = [...text].length;
  useEffect(() => {
    if (from) return;
    let live = true;
    void loadDraftBlobs(child.id, tpl.id).then((b) => {
      if (!live || !b) return;
      if (b.files.length) setFiles(b.files.map((f) => new File([f.blob], f.name, { type: f.type })));
      if (b.voice) {
        setVoice(b.voice);
        setVoiceRestored(b.voice);
      }
      if (b.files.length || b.voice) setRestored(true);
    });
    return () => {
      live = false;
    };
  }, [child.id, tpl.id, from]);
  useEffect(() => {
    if (text || aiNote || noAi) saveDraftText(child.id, tpl.id, { clientKey: clientKey.current, mode, text, aiNote, noAi });
  }, [child.id, tpl.id, mode, text, aiNote, noAi]);
  useEffect(() => {
    if (files.length || voice) void saveDraftBlobs(child.id, tpl.id, { files: files.map((f) => ({ name: f.name, type: f.type, blob: f })), voice });
  }, [child.id, tpl.id, files, voice]);
  useEffect(() => () => void (retryTimer.current && clearTimeout(retryTimer.current)), []);
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

  // a picture or recording already uploaded is not uploaded again when the hand-in is retried
  const upload = async (b: Blob, opts: Parameters<typeof uploader.upload>[1]) => {
    const known = uploaded.current.get(b);
    if (known) return known;
    const id = (await uploader.upload(b, opts)).fileId;
    uploaded.current.set(b, id);
    return id;
  };
  const submitRef = useRef<() => Promise<void>>(async () => undefined);
  const submit = async () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    setError(null);
    if (files.length === 0 && oldEvidence.length === 0) return setError("至少交一张证据图片");
    if (mode === "voice" && !voice) return setError("先按住说话，录一段讲解");
    if (mode === "text" && (n < DAILY_TEXT_MIN || n > DAILY_TEXT_MAX)) return setError(`文字讲解要 ${DAILY_TEXT_MIN} 到 ${DAILY_TEXT_MAX} 个字`);
    if (!noAi && !aiNote.trim()) return setError("说一句你是怎么用 AI 的");
    setBusy(true);
    try {
      const ids: string[] = files.length === 0 ? [...oldEvidence] : [];
      for (const f of files) ids.push(await upload(f, { purpose: "image" }));
      const explain = mode === "voice" ? { kind: "voice" as const, fileId: await upload(voice!.blob, { purpose: "audio", durationSec: voice!.durationMs / 1000 }) } : { kind: "text" as const, text };
      const r = await request<Result>("POST", "/v1/daily/submissions", {
        templateId: tpl.id,
        evidenceFileIds: ids,
        explain,
        ...(noAi ? { noAi: true } : { aiNote }),
        clientKey: clientKey.current,
      });
      await clearDraft(child.id, tpl.id);
      nav(`/daily/${r.id}`, { replace: true });
    } catch (e) {
      if (isTransient(e)) {
        // §3.1 自动重传: everything stays on the phone; try again by itself (and as soon as the network is back)
        const next = retry + 1;
        setRetry(next);
        retryTimer.current = setTimeout(() => void submitRef.current(), RETRY_WAITS_MS[Math.min(next - 1, RETRY_WAITS_MS.length - 1)]);
      } else {
        setRetry(0);
        setError(e instanceof ApiError ? e.message : String((e as Error).message ?? e));
      }
    } finally {
      setBusy(false);
    }
  };
  submitRef.current = submit;
  useEffect(() => {
    if (!retry) return;
    const back = () => void submitRef.current();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [retry]);

  return (
    <div className="page">
      <PageHeader title={tpl.name} right={<ReadAloud text={tpl.prompt} />} />
      <p className="subtitle">{tpl.prompt}</p>

      {restored && <p className="hint">上次没交上去的内容已经恢复了，可以接着改，也可以直接交。</p>}
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
        <VoiceRecorder key={voiceRestored ? "restored" : "new"} initial={voiceRestored} maxSeconds={90} onChange={setVoice} onUseText={() => setMode("text")} />
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
      {retry > 0 && !error && (
        <p role="status" style={{ color: "var(--ochre)" }}>
          网络不好，还没交上去。内容已经存在手机上，不会丢，会自动重新交（第 {retry} 次）；网络好了也可以直接再点"交上去"。
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
