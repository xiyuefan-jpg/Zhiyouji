/**
 * - B2 赛季日历: every event of the season by day, today highlighted; tap an
 *   event to go to its page;
 * - 公告: what the organisers announced (all / this season / this server);
 * - G4 导出或删除数据: the parent exports a child's data (a JSON file) or asks
 *   to delete a child or the whole family (carried out after 7 days, can be
 *   withdrawn until then).
 */

import { Link, useNavigate, useParams } from "react-router";
import { Button, Dialog, Toast } from "antd-mobile";
import { ApiError, request } from "../api";
import { shortTime } from "../format";
import { Empty, PageHeader } from "../components/ui";
import { useMe } from "../session";
import { useLoad } from "./season/useSeason";

// ---- 赛季日历 (B2) ---------------------------------------------------------------------------------------

interface CalendarData {
  status: string;
  today?: number;
  days: { day: number; date: string; events: { at: number; label: string; link: string | null; done: boolean }[] }[];
}

export function SeasonCalendarPage() {
  const cal = useLoad(() => request<CalendarData>("GET", "/v1/season/calendar"));
  const nav = useNavigate();
  const c = cal.data;
  return (
    <div className="page">
      <PageHeader title="赛季日历" />
      {c && c.status !== "playing" && <Empty title="仅赛季玩家可用">分组公布以后，这里列出赛季里每一天的安排。</Empty>}
      {c?.days.map((d) => (
        <div key={d.day} className="panel" style={{ borderColor: d.day === c.today ? "var(--vermilion)" : undefined }} aria-current={d.day === c.today ? "date" : undefined}>
          <div style={{ fontWeight: 700 }}>
            第 {d.day} 天 · {Number(d.date.slice(5, 7))}月{Number(d.date.slice(8))}日{d.day === c.today ? "（今天）" : ""}
          </div>
          {d.events.map((e, i) => (
            <button
              key={i}
              type="button"
              disabled={!e.link}
              onClick={() => e.link && nav(e.link)}
              className="row"
              style={{ width: "100%", border: "none", background: "none", padding: "4px 0", font: "inherit", color: "inherit", opacity: e.done ? 0.55 : 1, textAlign: "left" }}
            >
              <span className="hint" style={{ width: 48 }}>
                {shortTime(new Date(e.at).toISOString()).split(" ")[1]}
              </span>
              <span className="grow">{e.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- 公告 ----------------------------------------------------------------------------------------------

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishAt: string;
}

export function AnnouncementsPage() {
  const data = useLoad(() => request<{ announcements: Announcement[] }>("GET", "/v1/announcements"));
  return (
    <div className="page">
      <PageHeader title="公告" />
      {data.data?.announcements.length === 0 && <Empty title="还没有公告" />}
      {data.data?.announcements.map((a) => (
        <Link key={a.id} to={`/announcements/${a.id}`} className="panel" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div style={{ fontWeight: 600 }}>{a.title}</div>
          <div className="hint">{shortTime(a.publishAt)}</div>
        </Link>
      ))}
    </div>
  );
}

export function AnnouncementPage() {
  const { id = "" } = useParams();
  const data = useLoad(() => request<{ announcements: Announcement[] }>("GET", "/v1/announcements"));
  const a = data.data?.announcements.find((x) => x.id === id);
  return (
    <div className="page">
      <PageHeader title="公告" />
      {data.data && !a && <Empty title="这条公告已经撤回或不存在" />}
      {a && (
        <div className="panel">
          <div style={{ fontWeight: 700, fontSize: 18 }}>{a.title}</div>
          <div className="hint">{shortTime(a.publishAt)}</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>
        </div>
      )}
    </div>
  );
}

// ---- 导出或删除数据 (G4) -----------------------------------------------------------------------------------

interface DataRequest {
  id: string;
  kind: "export" | "delete";
  childId: string | null;
  status: "pending" | "done" | "cancelled";
  requestedAt: string;
  dueAt: string;
  doneAt: string | null;
}

export function DataRights() {
  const me = useMe();
  const list = useLoad(() => request<{ requests: DataRequest[] }>("GET", "/v1/data-requests"));
  const name = (id: string | null) => (id ? (me.children.find((c) => c.id === id)?.nickname ?? "已注销") : "整个家庭");
  const fail = (e: unknown) => Toast.show({ content: e instanceof ApiError ? e.message : String(e) });

  const exportChild = async (childId: string) => {
    try {
      const r = await request<{ request: DataRequest }>("POST", "/v1/data-requests", { kind: "export", childId });
      const d = await request<{ url: string }>("GET", `/v1/data-requests/${r.request.id}/download`);
      list.reload();
      await Dialog.alert({
        content: (
          <div>
            <p>{name(childId)}的数据已经整理好了（一个 JSON 文件），链接很快会过期：</p>
            <a href={d.url} target="_blank" rel="noreferrer">
              下载
            </a>
          </div>
        ),
        confirmText: "好的",
      });
    } catch (e) {
      fail(e);
    }
  };

  const deleteData = async (childId: string | null) => {
    const ok = await Dialog.confirm({
      content: `删除${name(childId)}的数据？申请后等 7 天才执行，这 7 天里可以撤回。删除后昵称换成"已注销"，上传的文件会删掉，小组的账本和名次保留。`,
      confirmText: "申请删除",
      cancelText: "再想想",
    });
    if (!ok) return;
    try {
      await request("POST", "/v1/data-requests", { kind: "delete", childId });
      list.reload();
    } catch (e) {
      fail(e);
    }
  };

  const cancel = async (id: string) => {
    try {
      await request("POST", `/v1/data-requests/${id}/cancel`);
      Toast.show({ content: "已撤回" });
      list.reload();
    } catch (e) {
      fail(e);
    }
  };

  const pendingDelete = list.data?.requests.filter((r) => r.kind === "delete" && r.status === "pending") ?? [];
  return (
    <>
      <div className="field-label">导出或删除数据（家长操作）</div>
      {pendingDelete.map((r) => (
        <div key={r.id} className="panel" style={{ borderColor: "var(--vermilion)" }}>
          <div>
            已申请删除{name(r.childId)}的数据，{shortTime(r.dueAt)} 执行。
          </div>
          <Button size="small" style={{ marginTop: 8 }} onClick={() => void cancel(r.id)}>
            撤回申请
          </Button>
        </div>
      ))}
      {me.children.map((c) => (
        <div key={c.id} className="panel row">
          <span className="grow">{c.nickname}</span>
          <Button size="small" onClick={() => void exportChild(c.id)}>
            导出
          </Button>
          <Button size="small" disabled={pendingDelete.some((r) => r.childId === c.id || r.childId === null)} onClick={() => void deleteData(c.id)}>
            删除
          </Button>
        </div>
      ))}
      <Button block className="quiet-button" disabled={pendingDelete.some((r) => r.childId === null)} onClick={() => void deleteData(null)} style={{ marginTop: 8 }}>
        删除整个家庭的数据
      </Button>
    </>
  );
}
