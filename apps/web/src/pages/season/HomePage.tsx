/**
 * 首页 body (PRD part 5 §4): for season players — 战况 (rank, points and the
 * 24-hour change, grain, lands, contests; being attacked in red), quick
 * entries with badges, 今天要做的事 sorted by deadline (组长待办 included for
 * leaders and deputies), the next publication with the latest report, and
 * the calendar strip. Everyone else: 去修行 and the daily task.
 */

import { Link } from "react-router";
import { Badge } from "antd-mobile";
import { CheckCircleFill, RightOutline } from "antd-mobile-icons";
import { request } from "../../api";
import { countdown, shortTime } from "../../format";
import { Empty, Seal } from "../../components/ui";
import { points } from "../../seasonApi";
import { useLoad } from "./useSeason";

interface TodoItem {
  kind: string;
  title: string;
  deadline: number | null;
  done: boolean;
  leaderOnly: boolean;
  link: string;
}

type HomeData =
  | { status: "none" | "waiting"; todo: TodoItem[] }
  | {
      status: "playing";
      season: { day: number; week: number; days: number; paused: boolean };
      battle: {
        rank: number | null;
        points: number;
        pointsChange: number;
        grain: number;
        spendableGrain: number;
        frozenGrain: number;
        lands: { id: string; name: string }[];
        contests: { id: string; land: string; role: "attacker" | "defender"; text: string; deadline: number; urgent: boolean }[];
      };
      counts: { dailyCounted: number; dailyCap: number; worksPending: number };
      entries: { shop: boolean; bigBattle: boolean };
      todo: TodoItem[];
      nextPublication: number;
      latestReport: { id: string; title: string; lines: string[] } | null;
      upcoming: { at: number; label: string }[];
    };

const link = { textDecoration: "none", color: "inherit" } as const;

export function HomeBody() {
  const home = useLoad(() => request<HomeData>("GET", "/v1/home"));
  const h = home.data;
  if (!h) return home.error ? <div role="alert">{home.error}</div> : <div className="hint">正在加载……</div>;
  if (h.status !== "playing")
    return (
      <>
        <Link to="/daily" className="panel row" style={{ ...link, marginTop: 18 }}>
          <Seal text="修" size={40} tilt={-3} />
          <span className="grow" style={{ fontWeight: 600 }}>
            去修行
          </span>
          <RightOutline />
        </Link>
        <div className="row" style={{ marginTop: 12, justifyContent: "space-around" }}>
          {[
            { to: "/journal", label: "修行日志", glyph: "日" },
            { to: "/watch", label: "观战", glyph: "观" },
          ].map((e) => (
            <Link key={e.to} to={e.to} style={{ ...link, textAlign: "center", fontSize: 13 }}>
              <Seal text={e.glyph} size={44} tilt={0} />
              <div style={{ marginTop: 4 }}>{e.label}</div>
            </Link>
          ))}
        </div>
        <TodoList items={h.todo} />
      </>
    );

  const b = h.battle;
  const entries = [
    { to: "/daily", label: "修行", glyph: "修", badge: `${h.counts.dailyCounted}/${h.counts.dailyCap}` },
    { to: "/team/works", label: "作品工坊", glyph: "作", badge: h.counts.worksPending ? String(h.counts.worksPending) : "" },
    { to: "/season/wars", label: "周战争", glyph: "战", badge: "" },
    { to: "/season/supply", label: "军需任务", glyph: "军", badge: "" },
    { to: "/season/items", label: "法宝囊", glyph: "宝", badge: "" },
    ...(h.entries.shop ? [{ to: "/season/shop", label: "商店", glyph: "商", badge: "" }] : []),
    ...(h.entries.bigBattle ? [{ to: "/season/big-battle", label: "大团战", glyph: "团", badge: "" }] : []),
  ];
  return (
    <>
      <Link to="/map" className="panel" style={{ ...link, display: "block", marginTop: 18 }} aria-label="战况">
        <div className="row" style={{ justifyContent: "space-around", textAlign: "center" }}>
          <div>
            <div className="hint">名次</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{b.rank ? `第 ${b.rank}` : "—"}</div>
          </div>
          <div>
            <div className="hint">团队分</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{points(b.points)}</div>
            {b.pointsChange !== 0 && (
              <div className="hint" style={{ fontSize: 12 }}>
                24 小时 {b.pointsChange > 0 ? "+" : ""}
                {points(b.pointsChange)}
              </div>
            )}
          </div>
          <div>
            <div className="hint">粮草</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{b.spendableGrain}</div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {b.lands.length ? `持有：${b.lands.map((l) => l.name).join("、")}` : "还没有地"}
        </div>
        {b.contests.map((c) => (
          <div key={c.id} style={{ marginTop: 6, color: c.urgent ? "var(--vermilion)" : undefined, fontWeight: c.urgent ? 700 : 400 }}>
            {c.urgent ? "⚠ " : ""}
            {c.text}，{countdown(c.deadline)}
          </div>
        ))}
      </Link>

      <div className="row" style={{ marginTop: 12, justifyContent: "space-between", flexWrap: "wrap", rowGap: 10 }}>
        {entries.map((e) => (
          <Link key={e.to} to={e.to} style={{ ...link, textAlign: "center", fontSize: 13 }}>
            <Badge content={e.badge || null}>
              <Seal text={e.glyph} size={44} tilt={0} />
            </Badge>
            <div style={{ marginTop: 4 }}>{e.label}</div>
          </Link>
        ))}
      </div>

      <TodoList items={h.todo} />

      <h2 className="section-title">下一次公布</h2>
      <div className="panel">
        <div>{countdown(h.nextPublication)}</div>
        {h.latestReport && (
          <Link to="/report?tab=reports" style={link}>
            <div className="hint" style={{ marginTop: 6 }}>
              {h.latestReport.title}
            </div>
            {h.latestReport.lines.map((l, i) => (
              <div key={i} style={{ fontSize: 14 }}>
                · {l}
              </div>
            ))}
          </Link>
        )}
      </div>

      <h2 className="section-title">
        <Link to="/season/calendar" style={link}>
          赛季日历 · 第 {h.season.day} 天{h.season.paused ? "（暂停中）" : ""} ›
        </Link>
      </h2>
      <div className="panel">
        {h.upcoming.length === 0 && <div className="hint">接下来没有安排。</div>}
        {h.upcoming.map((u) => (
          <div key={`${u.at}-${u.label}`} className="row">
            <span className="grow">{u.label}</span>
            <span className="hint">{shortTime(new Date(u.at).toISOString())}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <>
      <h2 className="section-title">今天要做的事</h2>
      {items.length === 0 ? (
        <div className="panel">
          <Empty title="今天还没有要做的事" icon={<Seal text="闲" size={48} tilt={3} outline />} />
        </div>
      ) : (
        <div className="panel">
          {items.map((t, i) => (
            <Link key={`${t.kind}-${i}`} to={t.link} className="row" style={{ ...link, padding: "6px 0", opacity: t.done ? 0.55 : 1 }}>
              {t.done ? <CheckCircleFill color="var(--ochre)" aria-label="已完成" /> : <span style={{ width: 14, height: 14, border: "1px solid var(--earth)", borderRadius: 7, display: "inline-block" }} />}
              <span className="grow">
                {t.title}
                {t.leaderOnly && <span className="hint">（组长待办）</span>}
              </span>
              {t.deadline && !t.done && <span className="hint" style={{ fontSize: 12 }}>{countdown(t.deadline)}</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
