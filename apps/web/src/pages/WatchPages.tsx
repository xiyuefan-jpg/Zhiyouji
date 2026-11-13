/**
 * 观战 (part 1 免费用户), F4 小组公开主页, F5 作品展.
 * - /watch: the servers that can be watched;
 * - /watch/:serverId: read-only map, ranking (tap a team for its public page)
 *   and broadcasts;
 * - /watch/:serverId/teams/:teamId: grade spread, lands, where the points came
 *   from, the weekly-war record, published works — no names, no items;
 * - /watch/:serverId/showcase: published works, filtered by kind, land or week;
 *   a work's page shows its text and files.
 * Season players reach their own server's pages from the ranking.
 */

import { useState } from "react";
import { Link, useParams } from "react-router";
import { Dialog, Selector, Tabs, TextArea, Toast } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { ApiError, request } from "../api";
import { shortTime } from "../format";
import { Empty, PageHeader } from "../components/ui";
import { points, type FeedLine, type LandView } from "../seasonApi";
import { useLoad } from "./season/useSeason";

const link = { textDecoration: "none", color: "inherit" } as const;

const SOURCE_TEXT: Record<string, string> = {
  territory: "领地收益",
  merit_capture: "夺地战功",
  merit_defend: "守地战功",
  war: "周战争",
  bye: "轮空",
  participation: "全员参与奖",
  big_battle_line: "大团战战线",
  big_battle_seize: "夺取产出",
  main_battlefield: "主战场",
  item_effect: "法宝效果",
  grain_conversion: "粮草折算",
  territory_transfer: "收益转移",
  admin: "管理员调整",
  reversal: "冲正",
};
const OUTCOME = { win: "胜", lose: "负", tie: "平", bye: "轮空" } as Record<string, string>;
const KIND = { contest: "区域争夺", war: "周战争", line: "大团战战线", main: "大团战主战场" } as Record<string, string>;

export function WatchServers() {
  const data = useLoad(() => request<{ servers: { id: string; name: string; season: string; status: string }[] }>("GET", "/v1/watch/servers"));
  return (
    <div className="page">
      <PageHeader title="观战" />
      {data.data?.servers.length === 0 && <Empty title="现在没有可以观战的赛季" />}
      {data.data?.servers.map((s) => (
        <Link key={s.id} to={`/watch/${s.id}`} className="panel row" style={link}>
          <span className="grow">
            {s.season} · {s.name}
            {s.status === "ended" ? <span className="hint">（已结束）</span> : null}
          </span>
          <RightOutline />
        </Link>
      ))}
    </div>
  );
}

export function WatchServer() {
  const { serverId = "" } = useParams();
  const [tab, setTab] = useState("ranking");
  const map = useLoad(() => request<{ lands: LandView[] }>("GET", `/v1/watch/${serverId}/map`), [serverId]);
  const rank = useLoad(() => request<{ ranking: { rank: number; teamId: string; name: string; points: number; lands: number }[] }>("GET", `/v1/watch/${serverId}/ranking`), [serverId]);
  const feed = useLoad(() => request<{ lines: FeedLine[] }>("GET", `/v1/watch/${serverId}/broadcasts`), [serverId]);
  return (
    <div className="page">
      <PageHeader title="观战" right={<Link to={`/watch/${serverId}/showcase`}>作品展</Link>} />
      {map.error && <div role="alert">{map.error}</div>}
      <Tabs activeKey={tab} onChange={setTab}>
        <Tabs.Tab key="ranking" title="排行榜" />
        <Tabs.Tab key="map" title="地图" />
        <Tabs.Tab key="broadcast" title="广播" />
      </Tabs>
      <div style={{ marginTop: 12 }}>
        {tab === "ranking" && <TeamRanking serverId={serverId} rows={rank.data?.ranking ?? null} />}
        {tab === "map" && (
          <div className="panel">
            {map.data?.lands.map((l) => (
              <div key={l.id} className="row" style={{ padding: "4px 0" }}>
                <span className="grow">
                  {l.name}
                  <span className="hint">（{l.kind === "center" ? "中心地" : "边缘地"}）</span>
                </span>
                <span className="hint">{l.owner?.name ?? "无主"}</span>
                {l.contest && <span style={{ color: "var(--vermilion)", marginLeft: 6 }}>争夺中</span>}
              </div>
            ))}
          </div>
        )}
        {tab === "broadcast" && (
          <div className="panel">
            {feed.data?.lines.length === 0 && <div className="hint">还没有广播。</div>}
            {feed.data?.lines.map((l, i) => (
              <div key={i} style={{ padding: "4px 0" }}>
                {l.text}
                <div className="hint" style={{ fontSize: 12 }}>
                  {shortTime(new Date(l.at).toISOString())}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ranking rows that open the team's public page (also used on the season's own ranking). */
export function TeamRanking({ serverId, rows, mine }: { serverId: string; rows: { rank: number; teamId: string; name: string; points: number; lands: number }[] | null; mine?: string }) {
  if (!rows) return <div className="hint">正在加载……</div>;
  return (
    <div className="panel">
      {rows.map((r) => (
        <Link key={r.teamId} to={`/watch/${serverId}/teams/${r.teamId}`} className="row" style={{ ...link, padding: "6px 0", fontWeight: r.teamId === mine ? 700 : 400 }}>
          <span style={{ width: 28 }}>{r.rank}</span>
          <span className="grow">
            {r.name}
            {r.teamId === mine ? "（本组）" : ""}
          </span>
          <span className="hint">{r.lands} 块地</span>
          <span style={{ width: 56, textAlign: "right" }}>{points(r.points)}</span>
        </Link>
      ))}
    </div>
  );
}

interface TeamPublic {
  id: string;
  name: string;
  rank: number | null;
  points: number;
  lands: { id: string; name: string }[];
  grades: { gradeLabel: string; count: number }[];
  pointsBySource: { source: string; amount: number }[];
  wars: { week: number; opponent: string | null; outcome: string; points: number }[];
  works: ShowWork[];
}

export function TeamPublicPage() {
  const { serverId = "", teamId = "" } = useParams();
  const t = useLoad(() => request<TeamPublic>("GET", `/v1/watch/${serverId}/teams/${teamId}`), [serverId, teamId]);
  const d = t.data;
  return (
    <div className="page">
      <PageHeader title={d?.name ?? "小组"} />
      {t.error && <div role="alert">{t.error}</div>}
      {d && (
        <>
          <div className="panel">
            <div>
              {d.rank ? `第 ${d.rank} 名 · ` : ""}团队分 {points(d.points)}
            </div>
            <div className="hint">组员年级：{d.grades.map((g) => `${g.gradeLabel} ${g.count} 人`).join("、") || "—"}</div>
            <div className="hint">持有的地：{d.lands.map((l) => l.name).join("、") || "还没有"}</div>
          </div>
          <div className="field-label">团队分从哪来</div>
          <div className="panel">
            {d.pointsBySource.length === 0 && <div className="hint">还没有团队分。</div>}
            {d.pointsBySource.map((p) => (
              <div key={p.source} className="row">
                <span className="grow">{SOURCE_TEXT[p.source] ?? p.source}</span>
                <span>
                  {p.amount > 0 ? "+" : ""}
                  {points(p.amount)}
                </span>
              </div>
            ))}
          </div>
          <div className="field-label">周战争战绩</div>
          <div className="panel">
            {d.wars.length === 0 && <div className="hint">还没有结果。</div>}
            {d.wars.map((w) => (
              <div key={w.week}>
                第 {w.week} 周：{OUTCOME[w.outcome] ?? w.outcome}
                {w.opponent ? `（对 ${w.opponent}）` : ""}
              </div>
            ))}
          </div>
          <div className="field-label">公开的作品</div>
          <WorkList serverId={serverId} works={d.works} />
        </>
      )}
    </div>
  );
}

interface ShowWork {
  id: string;
  kind: string;
  team: string;
  land: string | null;
  week: number | null;
  mediaKind: string;
  score: number | null;
  submittedAt: string;
}

function WorkList({ serverId, works }: { serverId: string; works: ShowWork[] }) {
  if (works.length === 0) return <Empty title="还没有公开的作品">作品结算、通过内容检查以后才会公开。</Empty>;
  return (
    <>
      {works.map((w) => (
        <Link key={w.id} to={`/watch/${serverId}/works/${w.id}`} className="panel row" style={link}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {w.team} · {KIND[w.kind] ?? w.kind}
              {w.land ? ` · ${w.land}` : w.week ? ` · 第 ${w.week} 周` : ""}
            </div>
            <div className="hint">{w.score !== null ? `${w.score} 分` : "—"}</div>
          </div>
          <RightOutline />
        </Link>
      ))}
    </>
  );
}

export function ShowcasePage() {
  const { serverId = "" } = useParams();
  const [kind, setKind] = useState<string>("");
  const q = kind ? `?kind=${kind}` : "";
  const data = useLoad(() => request<{ works: ShowWork[] }>("GET", `/v1/watch/${serverId}/showcase${q}`), [serverId, q]);
  return (
    <div className="page">
      <PageHeader title="作品展" />
      <Selector
        columns={4}
        options={[
          { label: "全部", value: "" },
          { label: "争夺", value: "contest" },
          { label: "周战争", value: "war" },
          { label: "大团战", value: "line" },
        ]}
        value={[kind]}
        onChange={(v) => setKind(v[0] ?? "")}
      />
      <div style={{ marginTop: 12 }}>{data.data ? <WorkList serverId={serverId} works={data.data.works} /> : <div className="hint">正在加载……</div>}</div>
    </div>
  );
}

/** 举报 (PRD part 8 §2.5): tell the organisers something in a public work is not right. */
function ReportButton({ serverId, workId }: { serverId: string; workId: string }) {
  const [done, setDone] = useState(false);
  const report = async () => {
    let reason = "";
    const ok = await Dialog.confirm({
      title: "举报这件作品",
      content: <TextArea placeholder="哪里不对？例如：有同学的真名、不适合的内容" onChange={(v) => (reason = v)} rows={3} maxLength={200} />,
      confirmText: "举报",
      cancelText: "算了",
    });
    if (!ok) return;
    if (!reason.trim()) return void Toast.show({ content: "写一句哪里不对" });
    try {
      await request("POST", `/v1/watch/${serverId}/showcase/${workId}/report`, { reason: reason.trim() });
      setDone(true);
      Toast.show({ content: "谢谢你，管理员会尽快查看" });
    } catch (e) {
      Toast.show({ content: e instanceof ApiError ? e.message : String(e) });
    }
  };
  return (
    <div style={{ textAlign: "right", marginBottom: 8 }}>
      {done ? (
        <span className="hint">已举报</span>
      ) : (
        <button type="button" onClick={() => void report()} style={{ border: "none", background: "none", color: "var(--ochre)", fontSize: 14 }}>
          举报
        </button>
      )}
    </div>
  );
}

export function ShowWorkPage() {
  const { serverId = "", workId = "" } = useParams();
  const w = useLoad(() => request<{ team: string; kind: string; mediaKind: string; text: string | null; aiNote: string | null; files: { id: string; kind: string; url: string }[] }>("GET", `/v1/watch/${serverId}/showcase/${workId}`), [workId]);
  const d = w.data;
  return (
    <div className="page">
      <PageHeader title="作品" />
      {w.error && <div role="alert">{w.error}</div>}
      {d && (
        <>
          <div className="panel">
            <div style={{ fontWeight: 700 }}>
              {d.team} · {KIND[d.kind] ?? d.kind}
            </div>
            {d.text && <p style={{ whiteSpace: "pre-wrap" }}>{d.text}</p>}
            {d.aiNote && <div className="hint">人机协作：{d.aiNote}</div>}
          </div>
          <ReportButton serverId={serverId} workId={workId} />
          {d.files.map((f) =>
            f.kind === "image" ? (
              <img key={f.id} src={f.url} alt="作品图片" style={{ width: "100%", borderRadius: 8, marginBottom: 8 }} />
            ) : f.kind === "video" ? (
              <video key={f.id} src={f.url} controls style={{ width: "100%", marginBottom: 8 }} />
            ) : f.kind === "audio" ? (
              <audio key={f.id} src={f.url} controls style={{ width: "100%", marginBottom: 8 }} />
            ) : (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                打开文件
              </a>
            ),
          )}
        </>
      )}
    </div>
  );
}
