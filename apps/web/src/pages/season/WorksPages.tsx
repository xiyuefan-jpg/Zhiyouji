/**
 * 作品工坊 (PRD part 5 E4, §3.3; E7 results): every work the team has to
 * hand in, each with a countdown; the material box every member adds to; the
 * leader or deputy assembles and submits (a new version each time, the last
 * one counts); after settlement, every team's score and the team's own
 * dimensions and comments.
 */

import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Checkbox, Selector, TextArea, Toast } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { ApiError, request } from "../../api";
import { shortTime } from "../../format";
import { Empty, PageHeader } from "../../components/ui";
import { ticketUploader } from "../../platform/upload";
import { seasonApi } from "../../seasonApi";
import { useLoad } from "./useSeason";

interface Slot {
  slot: string;
  kind: "contest" | "war" | "line" | "main";
  deadline: number;
  open: boolean;
  role?: "attacker" | "defender";
  stage?: "opening" | "rebuttal";
  submitted: { version: number; at: string; by: string } | null;
}

interface Material {
  id: string;
  text: string | null;
  addedBy: string;
  file: { id: string; kind: string; filename: string | null } | null;
}

interface Result {
  settled: boolean;
  scores?: { name: string; score: number | null; mine: boolean }[];
  mine?: { score: number; basis: string; comment: string | null; dims: { name: string; max: number; score: number | null; reason: string | null }[] } | null;
}

const uploader = ticketUploader("/v1/season", request);

export function slotTitle(s: Pick<Slot, "kind" | "slot" | "role" | "stage">): string {
  if (s.kind === "contest") return `区域争夺（${s.role === "defender" ? "守方" : "进攻方"}）${s.stage === "opening" ? " · 立论" : s.stage === "rebuttal" ? " · 驳论" : ""}`;
  if (s.kind === "war") return `第 ${s.slot.split(":")[1]} 周周战争`;
  if (s.kind === "line") return "大团战 · 战线作品";
  return "大团战 · 主战场";
}

interface Version {
  id: string;
  version: number;
  submittedBy: string;
  submittedAt: string;
  mediaKind: string;
  fileIds: string[];
  text: string | null;
  members: string[];
}

const MEDIA_TEXT: Record<string, string> = { text: "文字", images: "图文", video: "视频", audio: "音频" };

const BASIS = { human: "人工复核", ai_timeout: "超时，按 AI 分结算", admin: "管理员裁定" } as Record<string, string>;

export function WorksList() {
  const data = useLoad(() => request<{ slots: Slot[] }>("GET", "/v1/season/works"));
  return (
    <div className="page">
      <PageHeader title="作品工坊" />
      {data.error && <div role="alert">{data.error}</div>}
      {data.data && data.data.slots.length === 0 && <Empty title="现在没有要交的作品">发起或被进攻、周战争配对以后，作品会出现在这里。</Empty>}
      {data.data?.slots.map((s) => (
        <Link key={s.slot} to={`/team/works/${encodeURIComponent(s.slot)}`} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{slotTitle(s)}</div>
            <div className="hint">
              {s.open ? `${shortTime(new Date(s.deadline).toISOString())} 截止` : "已截止"}
              {s.submitted ? ` · 已交第 ${s.submitted.version} 版` : " · 还没交"}
            </div>
          </div>
          <RightOutline />
        </Link>
      ))}
    </div>
  );
}

export function WorkSlot() {
  const slot = decodeURIComponent(useParams().slot ?? "");
  const me = useLoad(() => seasonApi.me());
  const slots = useLoad(() => request<{ slots: Slot[] }>("GET", "/v1/season/works"));
  const mats = useLoad(() => request<{ materials: Material[] }>("GET", `/v1/season/works/${encodeURIComponent(slot)}/materials`), [slot]);
  const result = useLoad(() => request<Result>("GET", `/v1/season/works/${encodeURIComponent(slot)}/result`), [slot]);
  const versions = useLoad(() => request<{ works: Version[] }>("GET", `/v1/season/works/${encodeURIComponent(slot)}/versions`), [slot]);
  const contestId = slot.startsWith("contest:") ? slot.split(":")[1]! : null;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaKind, setMediaKind] = useState<"text" | "images" | "video" | "audio">("text");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const s = slots.data?.slots.find((x) => x.slot === slot);
  const playing = me.data?.status === "playing" ? me.data : null;

  const nickname = (id: string) => playing?.members.find((x) => x.childId === id)?.nickname ?? "已注销";
  const fail = (e: unknown) => Toast.show({ content: e instanceof ApiError ? e.message : String((e as Error).message ?? e) });

  const addText = async () => {
    if (!note.trim()) return;
    try {
      await request("POST", `/v1/season/works/${encodeURIComponent(slot)}/materials`, { text: note });
      setNote("");
      mats.reload();
    } catch (e) {
      fail(e);
    }
  };

  const addFile = async (f: File) => {
    const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : f.type === "application/pdf" ? "pdf" : "image";
    setBusy(true);
    try {
      const { fileId } = await uploader.upload(f, { purpose: kind });
      await request("POST", `/v1/season/works/${encodeURIComponent(slot)}/materials`, { fileId });
      mats.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await request<{ work: { version: number } }>("POST", `/v1/season/works/${encodeURIComponent(slot)}`, { mediaKind, fileIds: picked, text, members });
      Toast.show({ content: `交上去了（第 ${r.work.version} 版）` });
      slots.reload();
      versions.reload();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={s ? slotTitle(s) : "作品"} />
      {s && (
        <p className="subtitle">
          {s.open ? `${shortTime(new Date(s.deadline).toISOString())} 截止` : "已截止"}
          {s.submitted ? ` · 已交第 ${s.submitted.version} 版（以最后一次为准）` : ""}
        </p>
      )}

      {contestId && (
        <Link to={`/season/contests/${contestId}`} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="grow">题目和争夺详情{s?.stage ? "（辩论的持方、对方立论）" : ""}</span>
          <RightOutline />
        </Link>
      )}

      {result.data?.settled && (
        <>
          <h2 className="section-title">结果</h2>
          <div className="panel">
            {result.data.scores?.map((x) => (
              <div key={x.name} className="row" style={{ fontWeight: x.mine ? 700 : 400 }}>
                <span className="grow">{x.name}</span>
                <span>{x.score ?? "没交"}</span>
              </div>
            ))}
          </div>
          {result.data.mine && (
            <div className="panel">
              <div className="hint">{BASIS[result.data.mine.basis] ?? result.data.mine.basis}</div>
              {result.data.mine.dims.map((d) => (
                <div key={d.name} className="row">
                  <span className="grow">{d.name}</span>
                  <span>
                    {d.score ?? "—"} / {d.max}
                  </span>
                </div>
              ))}
              {result.data.mine.comment && <p>{result.data.mine.comment}</p>}
            </div>
          )}
        </>
      )}

      <h2 className="section-title">素材箱</h2>
      <div className="panel">
        {mats.data?.materials.length === 0 && <div className="hint">还没有素材，所有组员都可以往里放。</div>}
        {mats.data?.materials.map((m) => (
          <div key={m.id} style={{ padding: "4px 0" }}>
            {m.file ? `📎 ${m.file.filename ?? m.file.kind}` : m.text}
          </div>
        ))}
      </div>
      {s?.open && (
        <>
          <TextArea className="text-input" placeholder="写下想法或文字素材" value={note} onChange={setNote} rows={2} />
          <div className="row" style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => void addText()}>
              放进素材箱
            </Button>
            <input type="file" aria-label="上传素材文件" accept="image/*,video/*,audio/*,application/pdf" onChange={(e) => e.target.files?.[0] && void addFile(e.target.files[0])} />
          </div>
        </>
      )}

      {s?.open && playing?.canAct && (
        <>
          <h2 className="section-title">组装并提交</h2>
          <div className="field-label">形式</div>
          <Selector
            columns={4}
            value={[mediaKind]}
            onChange={(v) => v[0] && setMediaKind(v[0] as typeof mediaKind)}
            options={[
              { label: "文字", value: "text" },
              { label: "图文", value: "images" },
              { label: "视频", value: "video" },
              { label: "音频", value: "audio" },
            ]}
          />
          {mediaKind !== "text" && (
            <>
              <div className="field-label">从素材箱里选主体</div>
              {mats.data?.materials
                .filter((m) => m.file)
                .map((m) => (
                  <Checkbox key={m.id} checked={picked.includes(m.file!.id)} onChange={(c) => setPicked(c ? [...picked, m.file!.id] : picked.filter((x) => x !== m.file!.id))} style={{ display: "block", margin: "6px 0" }}>
                    {m.file!.filename ?? m.file!.kind}
                  </Checkbox>
                ))}
            </>
          )}
          <div className="field-label">文字说明{mediaKind === "text" ? "（作品正文）" : ""}</div>
          <TextArea className="text-input" placeholder="作品的文字" value={text} onChange={setText} rows={4} />
          <div className="field-label">参与的组员（署名）</div>
          {playing.members
            .filter((m) => m.active)
            .map((m) => (
              <Checkbox key={m.childId} checked={members.includes(m.childId)} onChange={(c) => setMembers(c ? [...members, m.childId] : members.filter((x) => x !== m.childId))} style={{ display: "block", margin: "6px 0" }}>
                {m.nickname}
              </Checkbox>
            ))}
          <Button color="primary" className="big-button" block loading={busy} style={{ marginTop: 18 }} onClick={() => void submit()}>
            提交
          </Button>
        </>
      )}
      {s?.open && playing && !playing.canAct && <p className="hint">素材放好以后，请组长或副组长组装提交。</p>}

      {versions.data && versions.data.works.length > 0 && (
        <>
          <h2 className="section-title">交过的版本（以最后一版为准）</h2>
          {versions.data.works.map((w) => (
            <details key={w.id} className="panel">
              <summary style={{ cursor: "pointer" }}>
                第 {w.version} 版 · {shortTime(w.submittedAt)} · {MEDIA_TEXT[w.mediaKind] ?? w.mediaKind}
                {w.submittedBy ? ` · ${nickname(w.submittedBy)}交的` : ""}
              </summary>
              {w.text && <p style={{ whiteSpace: "pre-wrap" }}>{w.text}</p>}
              {w.fileIds.length > 0 && <div className="hint">{w.fileIds.length} 个文件</div>}
              <div className="hint">署名：{w.members.map(nickname).join("、") || "—"}</div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
