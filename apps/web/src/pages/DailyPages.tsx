/**
 * 每日任务 (PRD part 5 C1–C3, §3.1): choose a template, hand in evidence
 * pictures, an explanation and one line on how AI was used, then the result.
 * The explanation is written here (50–150 characters); recording a voice
 * explanation comes with the recorder page.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Checkbox, Input, TextArea } from "antd-mobile";
import { DAILY_TEMPLATES, DAILY_TEXT_MAX, DAILY_TEXT_MIN, EXPLAIN_HINTS } from "@zhiyouji/shared";
import { ApiError, request } from "../api";
import { Empty, PageHeader, ReadAloud, Seal } from "../components/ui";
import { ticketUploader } from "../platform/upload";
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
  const [text, setText] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [noAi, setNoAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = [...text].length;

  const submit = async () => {
    setError(null);
    if (files.length === 0) return setError("至少交一张证据图片");
    if (n < DAILY_TEXT_MIN || n > DAILY_TEXT_MAX) return setError(`文字讲解要 ${DAILY_TEXT_MIN} 到 ${DAILY_TEXT_MAX} 个字`);
    if (!noAi && !aiNote.trim()) return setError("说一句你是怎么用 AI 的");
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of files) ids.push((await uploader.upload(f, { purpose: "image" })).fileId);
      const r = await request<Result>("POST", "/v1/daily/submissions", {
        templateId: tpl.id,
        evidenceFileIds: ids,
        explain: { kind: "text", text },
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
      <input
        type="file"
        accept="image/*"
        multiple
        aria-label="选择证据图片"
        onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 9))}
      />
      {files.length > 0 && <div className="hint">已选 {files.length} 张</div>}

      <div className="field-label">讲解</div>
      <div className="hint">
        {EXPLAIN_HINTS.map((h, i) => (
          <div key={h}>
            {i === 0 ? "①" : "②"} {h}
          </div>
        ))}
      </div>
      <TextArea className="text-input" placeholder="写 50–150 个字" value={text} onChange={setText} rows={5} maxLength={DAILY_TEXT_MAX} showCount />

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
          <Link to={`/daily/new/${d.templateId}`}>
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
