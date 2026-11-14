import { serverNow } from "../api";
/**
 * 修行日志 (PRD part 5 C4–C9) and 赛季回顾 (G6, §4.1):
 * - C4 日历: one month, days with cards marked; tap a day for its cards;
 * - C5 领域: the 15 subjects with card counts, then sub-fields and cards;
 * - C6 搜索: by keyword;
 * - C7 卡片详情: title, summary, the child's own explanation (voice can be
 *   played back), evidence pictures, the subject tag;
 * - C8 周小结、月报告; C9 修行境界 (under construction);
 * - G6 赛季回顾: "这一季我带走了什么".
 */

import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, SearchBar, Tabs } from "antd-mobile";
import { LeftOutline, RightOutline } from "antd-mobile-icons";
import { request } from "../api";
import { Empty, PageHeader, ReadAloud, Seal } from "../components/ui";
import { useLoad } from "./season/useSeason";

interface Card {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  difficulty: number | null;
  day: string;
}

interface Summary {
  id: string;
  kind: "week" | "month";
  period: string;
  content: { text: string; from: string; to: string; cards: number; subjects: Record<string, number>; aboveGrade: number };
  createdAt: string;
}

const link = { textDecoration: "none", color: "inherit" } as const;

const TABS = [
  { key: "calendar", title: "日历" },
  { key: "subjects", title: "领域" },
  { key: "search", title: "搜索" },
  { key: "summaries", title: "小结" },
];

/** "2027-03" for the Beijing month of a time. */
export function beijingMonth(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = y * 12 + (m - 1) + by;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

/** The month grid: leading blanks (Monday first) then 1…last day. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first + 6) % 7;
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
}

export function Journal() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "calendar";
  return (
    <div className="page">
      <PageHeader title="修行日志" right={<Link to="/daily">+ 修行</Link>} />
      <Tabs activeKey={tab} onChange={(k) => setParams({ tab: k }, { replace: true })}>
        {TABS.map((t) => (
          <Tabs.Tab key={t.key} title={t.title} />
        ))}
      </Tabs>
      <div style={{ marginTop: 14 }}>
        {tab === "calendar" && <CalendarView />}
        {tab === "subjects" && <SubjectsView />}
        {tab === "search" && <SearchView />}
        {tab === "summaries" && <SummariesView />}
      </div>
    </div>
  );
}

function CardList({ cards, empty }: { cards: Card[] | null; empty?: string }) {
  if (!cards) return <div className="hint">正在加载……</div>;
  if (cards.length === 0)
    return (
      <Empty title={empty ?? "还没有知识卡片"}>
        <Link to="/daily">去做今天的每日任务吧</Link>
      </Empty>
    );
  return (
    <>
      {cards.map((c) => (
        <Link key={c.id} to={`/journal/cards/${c.id}`} className="panel row" style={link}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <div className="hint">
              {c.day.slice(5).replace("-", "月")}日{c.tag ? ` · ${c.tag.replace("/", " · ")}` : ""}
            </div>
          </div>
          <RightOutline />
        </Link>
      ))}
    </>
  );
}

function CalendarView() {
  const [month, setMonth] = useState(() => beijingMonth(serverNow()));
  const [day, setDay] = useState<string | null>(null);
  const cal = useLoad(() => request<{ month: string; days: Record<string, Card[]> }>("GET", `/v1/journal/calendar?month=${month}`), [month]);
  const days = cal.data?.days ?? {};
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" aria-label="上个月" onClick={() => (setMonth(shiftMonth(month, -1)), setDay(null))} style={{ border: "none", background: "none" }}>
          <LeftOutline />
        </button>
        <span style={{ fontWeight: 600 }}>
          {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
        </span>
        <button type="button" aria-label="下个月" onClick={() => (setMonth(shiftMonth(month, 1)), setDay(null))} style={{ border: "none", background: "none" }}>
          <RightOutline />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 8, textAlign: "center" }}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
          <div key={w} className="hint">
            {w}
          </div>
        ))}
        {monthGrid(month).map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              aria-label={`${Number(d.slice(8))}日${days[d] ? `，${days[d]!.length} 张卡片` : ""}`}
              onClick={() => setDay(d)}
              style={{
                border: day === d ? "2px solid var(--ochre)" : "1px solid var(--line)",
                background: days[d] ? "var(--earth)" : "var(--paper-light)",
                borderRadius: 6,
                padding: "6px 0",
                color: "var(--ink)",
                fontWeight: days[d] ? 700 : 400,
              }}
            >
              {Number(d.slice(8))}
              {days[d] && <div style={{ fontSize: 10 }}>{days[d]!.length} 张</div>}
            </button>
          ) : (
            <div key={`b${i}`} />
          ),
        )}
      </div>
      {day && (
        <div style={{ marginTop: 12 }}>
          <CardList cards={days[day] ?? []} empty="这一天没有知识卡片" />
        </div>
      )}
    </>
  );
}

function SubjectsView() {
  const data = useLoad(() => request<{ subjects: { name: string; cards: number; subfields: { name: string; cards: number }[] }[]; other: number; total: number }>("GET", "/v1/journal/subjects"));
  const [open, setOpen] = useState<string | null>(null);
  const cards = useLoad(() => (open ? request<{ cards: Card[] }>("GET", `/v1/journal/cards?tag=${encodeURIComponent(open)}`) : Promise.resolve(null)), [open]);
  if (!data.data) return <div className="hint">正在加载……</div>;
  if (open) {
    const s = data.data.subjects.find((x) => x.name === open);
    return (
      <>
        <Button size="small" onClick={() => setOpen(null)}>
          ← 全部领域
        </Button>
        <h2 className="section-title">{open}</h2>
        {s && s.subfields.some((f) => f.cards > 0) && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {s.subfields
              .filter((f) => f.cards > 0)
              .map((f) => `${f.name} ${f.cards}`)
              .join(" · ")}
          </div>
        )}
        <CardList cards={cards.data?.cards ?? null} />
      </>
    );
  }
  return (
    <>
      <p className="subtitle">一共 {data.data.total} 张知识卡片</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {data.data.subjects.map((s) => (
          <button key={s.name} type="button" className="panel" onClick={() => setOpen(s.name)} style={{ textAlign: "left", font: "inherit", color: "inherit", opacity: s.cards ? 1 : 0.6, margin: 0 }}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            <div className="hint">{s.cards} 张</div>
          </button>
        ))}
      </div>
    </>
  );
}

function SearchView() {
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const cards = useLoad(() => (q ? request<{ cards: Card[] }>("GET", `/v1/journal/cards?q=${encodeURIComponent(q)}`) : Promise.resolve(null)), [q]);
  return (
    <>
      <SearchBar placeholder="找以前的卡片" value={text} onChange={setText} onSearch={(v) => setQ(v.trim().slice(0, 40))} />
      <div style={{ marginTop: 12 }}>{q ? <CardList cards={cards.data?.cards ?? null} empty="没有找到" /> : <div className="hint">输入关键词，例如"大气压"。</div>}</div>
    </>
  );
}

function SummaryBody({ s }: { s: Summary }) {
  const subjects = Object.entries(s.content.subjects ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="row">
        <div className="grow" style={{ fontWeight: 700 }}>
          {s.kind === "week" ? "周小结" : "月报告"} · {s.period}
        </div>
        <ReadAloud text={s.content.text} />
      </div>
      <p style={{ whiteSpace: "pre-wrap" }}>{s.content.text}</p>
      <div className="hint">
        {s.content.cards} 张卡片{s.content.aboveGrade ? `，其中 ${s.content.aboveGrade} 张超出了你的年级` : ""}
        {subjects.length ? `；${subjects.map(([k, v]) => `${k} ${v}`).join("、")}` : ""}
      </div>
    </>
  );
}

function SummariesView() {
  const data = useLoad(() => request<{ summaries: Summary[] }>("GET", "/v1/journal/summaries"));
  if (!data.data) return <div className="hint">正在加载……</div>;
  if (data.data.summaries.length === 0) return <Empty title="还没有小结">每周一会给上周做过每日任务的你写一份周小结，每月 1 日写一份月报告。</Empty>;
  return (
    <>
      {data.data.summaries.map((s) => (
        <div key={s.id} className="panel">
          <SummaryBody s={s} />
        </div>
      ))}
    </>
  );
}

/** Message link /journal/summaries/:id. */
export function SummaryPage() {
  const { id = "" } = useParams();
  const data = useLoad(() => request<{ summaries: Summary[] }>("GET", "/v1/journal/summaries"));
  const s = data.data?.summaries.find((x) => x.id === id);
  return (
    <div className="page">
      <PageHeader title="小结" />
      {data.data && !s && <Empty title="找不到这份小结" />}
      {s && (
        <div className="panel">
          <SummaryBody s={s} />
        </div>
      )}
    </div>
  );
}

interface CardDetail extends Card {
  templateId: number;
  explainText: string | null;
  voice: { id: string; url: string } | null;
  evidence: { id: string; kind: string; url: string }[];
}

export function CardPage() {
  const { id = "" } = useParams();
  const c = useLoad(() => request<CardDetail>("GET", `/v1/journal/cards/${id}`), [id]);
  const d = c.data;
  return (
    <div className="page">
      <PageHeader title="知识卡片" />
      {c.error && <div role="alert">{c.error}</div>}
      {d && (
        <>
          <div className="panel">
            <div className="row">
              <div className="grow" style={{ fontWeight: 700, fontSize: 18 }}>
                {d.title}
              </div>
              <ReadAloud text={`${d.title}。${d.summary}`} />
            </div>
            <p>{d.summary}</p>
            <div className="hint">
              {d.day}
              {d.tag ? ` · ${d.tag.replace("/", " · ")}` : ""}
            </div>
          </div>
          <h2 className="section-title">我当时的讲解</h2>
          <div className="panel">
            {d.voice ? <audio controls src={d.voice.url} aria-label="我的讲解录音" style={{ width: "100%" }} /> : <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{d.explainText}</p>}
          </div>
          {d.evidence.length > 0 && (
            <>
              <h2 className="section-title">证据</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {d.evidence.map((e) => (
                  <a key={e.id} href={e.url} target="_blank" rel="noreferrer">
                    <img src={e.url} alt="证据图片" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }} />
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** C9 修行境界 — under construction (个人系统 0.4). */
export function RealmPage() {
  return (
    <div className="page">
      <PageHeader title="修行境界" />
      <Empty title="建设中" icon={<Seal text="境" size={52} tilt={3} outline />}>
        你从今天起的每一次修行都会被记录，系统开放时全部计入。
      </Empty>
    </div>
  );
}

// ---- 赛季回顾 (G6, §4.1) ---------------------------------------------------------------------------------

interface Review {
  id: string;
  season: string;
  releasedAt: string;
  content: {
    text: string;
    team: string;
    rank: number | null;
    highlights?: string[];
    map: Record<string, number>;
    hardest: { title: string; tag: string | null; crossing: number | null } | null;
    works: { kind: string; slot: string; title?: string | null; land?: string | null; subject?: string | null; result?: string | null }[];
    numbers: { dailyTasks: number; cards: number; works: number; aboveGrade: number };
  };
}

const WORK_KIND: Record<string, string> = { contest: "区域争夺", war: "周战争", line: "大团战战线", main: "大团战主战场" };

export function SeasonReviewPage() {
  const data = useLoad(() => request<{ reviews: Review[] }>("GET", "/v1/season-reviews"));
  return (
    <div className="page">
      <PageHeader title="赛季回顾" />
      {data.data?.reviews.length === 0 && <Empty title="还没有赛季回顾">赛季结束后，这里会告诉你：这一季你带走了什么。</Empty>}
      {data.data?.reviews.map((r) => {
        const subjects = Object.entries(r.content.map).sort((a, b) => b[1] - a[1]);
        return (
          <div key={r.id}>
            <h2 className="section-title">{r.season} · 这一季我带走了什么</h2>
            <div className="panel">
              <div className="row">
                <p className="grow" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                  {r.content.text}
                </p>
                <ReadAloud text={r.content.text} />
              </div>
            </div>
            <div className="field-label">我的探索地图</div>
            <div className="panel">{subjects.length ? `你探索了${subjects.map(([k, v]) => `${k}（${v} 次）`).join("、")}` : "这一季还没有知识卡片。"}</div>
            {r.content.hardest && (
              <>
                <div className="field-label">我讲明白过的最难的知识</div>
                <div className="panel">
                  {r.content.hardest.title}
                  {r.content.hardest.tag ? `（${r.content.hardest.tag.replace("/", " · ")}）` : ""}
                  {r.content.hardest.crossing && r.content.hardest.crossing > 0 ? `，比你的年级高 ${r.content.hardest.crossing} 级` : ""}
                </div>
              </>
            )}
            <div className="field-label">小组</div>
            <div className="panel">
              {r.content.team}
              {r.content.rank ? `，最终第 ${r.content.rank} 名` : ""}
              {r.content.highlights?.length ? <div className="hint">高光时刻：{r.content.highlights.join("、")}</div> : null}
            </div>
            {r.content.works.length > 0 && (
              <>
                <div className="field-label">我参与的作品</div>
                <div className="panel">
                  {r.content.works.map((w, i) => (
                    <div key={i} style={{ padding: "4px 0" }}>
                      <div>
                        {WORK_KIND[w.kind] ?? w.kind}
                        {w.land ? ` · ${w.land}` : ""}
                        {w.subject ? `（${w.subject}）` : ""}
                        {w.result ? <b> · {w.result}</b> : null}
                      </div>
                      {w.title && <div className="hint">{w.title}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="field-label">数字</div>
            <div className="panel">
              每日任务 {r.content.numbers.dailyTasks} 次 · 知识卡片 {r.content.numbers.cards} 张 · 团队作品 {r.content.numbers.works} 件
              {r.content.numbers.aboveGrade ? ` · 超出年级的知识 ${r.content.numbers.aboveGrade} 张` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
