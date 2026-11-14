/**
 * Season pages (PRD part 5 D1, D2, D3, E1, E3, E6, F1–F3): the map, a land
 * with attack / join / buy, the team page with claiming roles, the ledger, and
 * the report tab's reports, broadcasts and ranking.
 *
 * Children who are not season players see what the season is, never prices or
 * how to sign up (part 5 §5).
 */

import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Dialog, Tabs, Toast } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { ApiError, request, serverNow } from "../../api";
import { countdown, shortTime } from "../../format";
import { Avatar, Empty, PageHeader, Seal } from "../../components/ui";
import { points, seasonApi, type FeedLine, type LandView, type Quote, type SeasonMe } from "../../seasonApi";
import { useLoad, useSeasonMe } from "./useSeason";
import { FeaturedWatch, WatchMap } from "../WatchPages";
import { RolesPanel } from "./TeamPages";
import { TeamRanking } from "../WatchPages";

export const ROLE_TEXT = { leader: "组长", deputy: "副组长", member: "组员" } as const;

export function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : String(e);
}

/** Wraps a season page: not a player yet / waiting for the groups / playing. */
export function SeasonGate({ me, title, children }: { me: SeasonMe | null; title: string; children: (m: Extract<SeasonMe, { status: "playing" }>) => ReactNode }) {
  if (!me) return <div className="hint">正在加载……</div>;
  if (me.status === "none")
    return (
      <>
        <h1 className="title">{title}</h1>
        <Empty title="仅赛季玩家可用">赛季里，小组之间用知识争夺地盘：讲明白一个知识，就能守住或拿下一块地。</Empty>
      </>
    );
  if (me.status === "waiting")
    return (
      <>
        <h1 className="title">{title}</h1>
        <Empty title="等待分组公布">「{me.season.name}」开营日（{me.season.opening.slice(5).replace("-", "月")}日）晚上公布分组。</Empty>
      </>
    );
  return <>{children(me)}</>;
}

// ---- 地图 (D1) --------------------------------------------------------------------------------------

export function SeasonMap() {
  const me = useSeasonMe();
  const map = useLoad(() => (me.data?.status === "playing" ? seasonApi.map() : Promise.resolve(null)), [me.data?.status]);
  // free users (and children waiting for the grouping): the read-only watch map (part 5 §1)
  if (me.data && me.data.status !== "playing")
    return (
      <>
        <h1 className="title">地图</h1>
        {me.data.status === "waiting" && <p className="hint">「{me.data.season.name}」开营日晚上公布分组，之后这里是你们服的地图。</p>}
        <FeaturedWatch>{(s) => <WatchMap serverId={s.id} />}</FeaturedWatch>
      </>
    );
  return (
    <SeasonGate me={me.data} title="地图">
      {(m) => (
        <>
          <h1 className="title">地图</h1>
          <p className="subtitle">
            {m.server.name} · 第 {m.season.day} 天{m.season.paused ? " · 赛季暂停中" : ""}
          </p>
          {map.error && <div role="alert">{map.error}</div>}
          {map.data && (
            <>
              <LandList title="中心地（产出 2）" lands={map.data.lands.filter((l) => l.kind === "center")} />
              <LandList title="边缘地（产出 1）" lands={map.data.lands.filter((l) => l.kind === "edge")} />
            </>
          )}
        </>
      )}
    </SeasonGate>
  );
}

function LandList({ title, lands }: { title: string; lands: LandView[] }) {
  return (
    <>
      <h2 className="section-title">{title}</h2>
      {lands.map((l) => (
        <Link key={l.id} to={`/map/${l.id}`} className="panel row" style={{ textDecoration: "none", color: "inherit", borderColor: l.mine ? "var(--ochre)" : undefined }} aria-label={`${l.name}，${l.owner ? l.owner.name : "无主"}`}>
          <Seal text={l.name.slice(0, 1)} size={40} tilt={0} outline={!l.mine} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {l.name}
              {l.mine && <span className="hint">（本组）</span>}
            </div>
            {l.subject && <div className="hint">{l.subject}{/辩论/.test(l.questionType ?? "") ? " · 辩论" : ""}</div>}
            <div className="hint">
              {l.owner ? `主人：${l.owner.name}` : "还没有主人"}
              {l.zeroed ? " · 产出被生死簿归零" : ""}
            </div>
            {l.contest && <div style={{ color: "var(--vermilion)", fontSize: 14 }}>争夺中 · {countdown(l.contest.deadline)}</div>}
          </div>
          <RightOutline />
        </Link>
      ))}
    </>
  );
}

// ---- 地块详情、发起或加入进攻 (D2, D3) -----------------------------------------------------------------

/** "基础 30 + 本组同时进行 1 场 15 + 持有 2 块地 20 = 65；讨伐令 ×0.7 → 46" (§3.2). */
export function costEquation(q: Pick<Quote, "base" | "cost" | "exile" | "crusade" | "parts" | "factors">): string {
  const sum = q.parts && q.parts.length > 1 ? `${q.parts.map((x) => `${x.label} ${x.amount}`).join(" + ")} = ${q.base}` : `基础 ${q.base}`;
  const factors = q.factors ?? [...(q.exile ? [{ label: "流亡令", factor: 0.5 }] : []), ...(q.crusade ? [{ label: "讨伐令", factor: 0.7 }] : [])];
  return factors.length ? `${sum}；${factors.map((f) => `${f.label} ×${f.factor}`).join("，")}` : sum;
}

export function LandPage() {
  const { landId = "" } = useParams();
  const nav = useNavigate();
  const me = useSeasonMe();
  const map = useLoad(() => seasonApi.map(), [landId]);
  const land = map.data?.lands.find((l) => l.id === landId);
  const [busy, setBusy] = useState(false);

  const act = async (kind: "attack" | "join" | "buy") => {
    if (!land) return;
    try {
      if (kind === "buy") {
        const team = await seasonApi.team();
        const grain = team.spendableGrain;
        const ok = await Dialog.confirm({
          content: (
            <div>
              <p>
                买下{land.name}：<b>{land.price ?? "?"} 粮草</b>
              </p>
              {land.price != null && (
                <p>
                  本组现有 {grain}，之后剩 {grain - land.price}。
                </p>
              )}
              <p className="hint">中心地的价格每天往下降；买下以后每天产出 {land.output} 分。</p>
            </div>
          ),
        });
        if (!ok) return;
        setBusy(true);
        await seasonApi.buyCenter(land.id);
        Toast.show({ content: `买下了${land.name}` });
      } else {
        const q = await seasonApi.quote(land.id);
        const parts = costEquation(q);
        const ok = await Dialog.confirm({
          content: (
            <div>
              <p>费用：{parts} → <b>{q.cost} 粮草</b></p>
              <p>本组现有 {q.grain}，之后剩 {q.grain - q.cost}。</p>
              <p className="hint">
                题目将从这块地的题库里随机抽取。
                {q.deadline ? `作品 ${shortTime(new Date(q.deadline).toISOString())} 截止。` : ""}
                {kind === "attack" && q.joinDeadline ? `别的组可以在 ${shortTime(new Date(q.joinDeadline).toISOString())} 之前加入。` : ""}
              </p>
              <p>花 {q.cost} 粮草{kind === "attack" ? "发起进攻" : "加入进攻"}？</p>
            </div>
          ),
        });
        if (!ok) return;
        setBusy(true);
        if (kind === "attack") {
          // §3.2 steps 4–5: the prompt card is revealed on the contest page
          const r = await seasonApi.attack(land.id);
          Toast.show({ content: "已发起进攻，题目翻开了" });
          nav(`/season/contests/${r.contest.id}`);
          return;
        }
        await seasonApi.join(land.contest!.id);
        Toast.show({ content: "已加入进攻" });
        nav(`/season/contests/${land.contest!.id}`);
        return;
      }
      map.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={land?.name ?? "地块"} />
      {!land || me.data?.status !== "playing" ? (
        <div className="hint">正在加载……</div>
      ) : (
        <>
          <div className="panel">
            {(land.subject || land.questionType) && (
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{[land.subject, land.questionType].filter(Boolean).join(" · ")}</div>
            )}
            <div>{land.kind === "center" ? "中心地" : "边缘地"} · 每天产出 {land.output} 分</div>
            <div>
              主人：{land.owner ? land.owner.name : "还没有主人"}
              {land.owner && land.ownedSince ? <span className="hint">（{shortTime(new Date(land.ownedSince).toISOString())} 起）</span> : null}
            </div>
            {land.effects.length > 0 && <div className="hint">身上的法宝效果：{land.effects.map((e) => e.name ?? e.kind).join("、")}</div>}
            {land.owner && !land.mine && !land.contest && (
              <div className="hint" style={{ marginTop: 6 }}>
                进攻时会从这块地的题库里随机抽一道题，两边的作品都要讲给题目里的那个人听；守方交作品就是迎战，不花粮草。
              </div>
            )}
            {land.contest && (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: "var(--vermilion)" }}>
                  争夺中，作品截止：{countdown(land.contest.deadline)}
                </div>
                <div className="hint">进攻方：{land.contest.attackers.map((a) => a?.name).join("、")}</div>
                <Link to={`/season/contests/${land.contest.id}`}>争夺详情（题目）</Link>
              </div>
            )}
          </div>
          <LandHistory landId={land.id} />
          {!me.data.canAct && <p className="hint">请组长或副组长操作。</p>}
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {land.owner && !land.mine && !land.contest && (
              <Button color="primary" className="big-button" disabled={!me.data.canAct || busy} onClick={() => void act("attack")}>
                发起进攻
              </Button>
            )}
            {land.contest && !land.mine && !land.contest.involved && serverNow() < land.contest.joinDeadline && (
              <Button color="primary" className="big-button" disabled={!me.data.canAct || busy} onClick={() => void act("join")}>
                加入进攻
              </Button>
            )}
            {!land.owner && land.kind === "center" && (
              <Button color="primary" className="big-button" disabled={!me.data.canAct || busy} onClick={() => void act("buy")}>
                购买
              </Button>
            )}
            <Button className="quiet-button big-button" onClick={() => nav("/map")}>
              回到地图
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const HOW: Record<string, string> = { auction: "盲拍拿到", center_round: "中心地购买", bought: "买下", captured: "进攻夺下", rejudged: "改判后归还", admin: "老师调整" };

/** 归属历史 (D2): who held the land and how it changed hands, newest first. */
function LandHistory({ landId }: { landId: string }) {
  const h = useLoad(() => request<{ history: { at: number; from: { name: string } | null; to: { name: string } | null; how: string; contestId: string | null }[] }>("GET", `/v1/season/lands/${landId}/history`), [landId]);
  if (!h.data || h.data.history.length === 0) return null;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>归属历史</div>
      {h.data.history.map((x, i) => (
        <div key={i} className="row">
          <span className="grow">
            {x.to ? x.to.name : "没有主人"}
            <span className="hint">
              {" "}
              · {HOW[x.how] ?? x.how}
              {x.from && x.how !== "rejudged" ? `（从${x.from.name}手里）` : ""}
            </span>
          </span>
          <span className="hint">{shortTime(new Date(x.at).toISOString())}</span>
        </div>
      ))}
    </div>
  );
}

// ---- 小组 (E1, E3) ------------------------------------------------------------------------------------

/** 本组微信群二维码 (E1, round 29): the admin creates the group and uploads the code; only this team sees it. */
function TeamQr() {
  const qr = useLoad(() => request<{ team: { url: string; uploadedAt: string } | null }>("GET", "/v1/season/qr"));
  if (!qr.data) return null;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600 }}>本组微信群</div>
      {qr.data.team ? (
        <>
          <img src={qr.data.team.url} alt="本组微信群二维码" style={{ width: 200, height: 200, objectFit: "contain", display: "block", margin: "10px auto" }} />
          <div className="hint" style={{ textAlign: "center" }}>
            长按图片识别二维码进群（{shortTime(qr.data.team.uploadedAt)} 更新；微信群二维码 7 天会过期，过期了请找老师）
          </div>
        </>
      ) : (
        <div className="hint" style={{ marginTop: 4 }}>老师还没上传本组的微信群二维码，建好群后会放在这里。</div>
      )}
    </div>
  );
}

export function SeasonTeam() {
  const me = useSeasonMe();
  const team = useLoad(() => seasonApi.team());
  const feed = useLoad(() => seasonApi.teamFeed());
  const claim = async (role: "leader" | "deputy") => {
    try {
      await seasonApi.claim(role);
      Toast.show({ content: `你现在是${ROLE_TEXT[role]}了` });
      me.reload();
      feed.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
      me.reload();
    }
  };
  return (
    <SeasonGate me={me.data} title="小组">
      {(m) => {
        const leader = m.members.find((x) => x.role === "leader");
        const deputy = m.members.find((x) => x.role === "deputy");
        return (
          <>
            <h1 className="title">{m.team.name}</h1>
            <p className="subtitle">
              我是{ROLE_TEXT[m.role]}
              {!m.active ? "（已退赛，只能查看）" : ""}
            </p>
            {(m.season.status === "ended" || m.season.status === "archived") && (
              <Link to="/season-review" className="panel row" style={{ textDecoration: "none", color: "inherit", marginBottom: 12, borderColor: "var(--vermilion)" }}>
                <span className="grow">
                  <b>
                    赛季结束了{team.data?.rank ? `：本组最终第 ${team.data.rank} 名` : ""}
                    {team.data?.scholarshipYuan ? `，奖学金 ${team.data.scholarshipYuan} 元` : ""}
                  </b>
                  <br />
                  <span className="hint">剩下的粮草已经折成团队分。看看这一季你带走了什么。</span>
                </span>
                <RightOutline />
              </Link>
            )}
            {team.data && (
              <div className="panel row" style={{ justifyContent: "space-around", textAlign: "center" }}>
                <Stat label="名次" value={team.data.rank ? `第 ${team.data.rank}` : "—"} />
                <Stat label="团队分" value={points(team.data.points)} />
                <Stat
                  label="粮草"
                  value={String(team.data.spendableGrain)}
                  sub={m.season.status === "ended" || m.season.status === "archived" ? "已折成分" : team.data.frozenGrain ? `冻结 ${team.data.frozenGrain}` : undefined}
                />
                <Stat label="地" value={`${team.data.lands.length} 块`} />
              </div>
            )}
            {m.active && m.season.status !== "ended" && (!leader || !deputy) && m.role === "member" && (
              <div className="panel" style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 10 }}>{!leader ? "还没有组长，先到先得。" : "还没有副组长，先到先得。"}</div>
                <div className="row">
                  {!leader && (
                    <Button color="primary" onClick={() => void claim("leader")}>
                      认领组长
                    </Button>
                  )}
                  {!deputy && (
                    <Button onClick={() => void claim("deputy")}>认领副组长</Button>
                  )}
                </div>
              </div>
            )}
            <TeamQr />
            <RolesPanel m={m} onChange={me.reload} />
            <h2 className="section-title">组员</h2>
            <div className="panel">
              {m.members.map((x) => (
                <div key={x.childId} className="row" style={{ padding: "6px 0", opacity: x.active ? 1 : 0.5 }}>
                  <Avatar id={x.avatar} size={36} />
                  <div className="grow">
                    {x.nickname}
                    {x.me ? "（我）" : ""}
                  </div>
                  <span className="hint">
                    {x.gradeLabel}
                    {x.role !== "member" ? ` · ${ROLE_TEXT[x.role]}` : ""}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              {TEAM_LINKS.filter((l) => !l.show || !m.season.days || l.show(m.season.day, m.season.days)).map((l) => (
                <Link key={l.to} to={l.to} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="grow">{l.title}</span>
                  <RightOutline />
                </Link>
              ))}
            </div>
            <h2 className="section-title">组内动态</h2>
            <FeedList lines={feed.data?.lines ?? null} empty="还没有动态" />
          </>
        );
      }}
    </SeasonGate>
  );
}

/** Team page entries; the shop only around D15–D17 and the big battle from week 5 (part 5 §4). */
type Days = { shopOpen: number; shopClose: number; bigBattle: number; end: number };
const TEAM_LINKS: { to: string; title: string; show?: (day: number, d: Days) => boolean }[] = [
  { to: "/team/works", title: "作品工坊" },
  { to: "/season/items", title: "法宝囊" },
  { to: "/season/wars", title: "周战争" },
  { to: "/season/supply", title: "军需任务" },
  { to: "/season/shop", title: "商店", show: (day, d) => day >= d.shopOpen - 1 && day <= d.shopClose },
  { to: "/season/big-battle", title: "大团战", show: (day, d) => day >= d.bigBattle - 1 },
  { to: "/team/ledger", title: "粮草和团队分明细" },
  { to: "/season/calendar", title: "赛季日历" },
];

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="hint">{label}</div>
      <div style={{ fontFamily: "var(--serif)", fontWeight: 700, fontSize: 20 }}>{value}</div>
      {sub && <div className="hint" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

export function FeedList({ lines, empty }: { lines: FeedLine[] | null; empty: string }) {
  if (!lines) return <div className="hint">正在加载……</div>;
  if (lines.length === 0) return <Empty title={empty} />;
  return (
    <div className="panel">
      {lines.map((l, i) => (
        <div key={`${l.at}-${i}`} style={{ padding: "6px 0" }}>
          <div>{l.text}</div>
          <div className="hint" style={{ fontSize: 12 }}>
            {shortTime(new Date(l.at).toISOString())}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- 粮草和团队分明细 (E6) --------------------------------------------------------------------------------

const SOURCE_TEXT: Record<string, string> = {
  opening: "开营",
  daily_task: "每日任务",
  supply: "军需任务",
  attack: "进攻",
  join: "加入进攻",
  auction_bid: "盲拍出价",
  center_land: "买中心地",
  shop: "商店",
  epic_auction: "竞价成交",
  refund: "退还",
  reversal: "冲正",
  admin: "管理员调整",
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
};

export function LedgerPage() {
  const [cur, setCur] = useState<"points" | "grain">("points");
  const data = useLoad(() => seasonApi.ledger(cur), [cur]);
  return (
    <div className="page">
      <PageHeader title="明细" />
      <Tabs activeKey={cur} onChange={(k) => setCur(k as "points" | "grain")}>
        <Tabs.Tab key="points" title="团队分" />
        <Tabs.Tab key="grain" title="粮草" />
      </Tabs>
      {data.data && (
        <>
          <p>现在：{cur === "points" ? points(data.data.balance) : data.data.balance}</p>
          <div className="panel">
            {data.data.entries.map((e) => (
              <div key={e.id} className="row" style={{ padding: "6px 0" }}>
                <div className="grow">
                  <div>{SOURCE_TEXT[e.source] ?? e.source}</div>
                  {e.detail && <div className="hint">{e.detail}</div>}
                  <div className="hint" style={{ fontSize: 12 }}>
                    {shortTime(new Date(e.at).toISOString())}
                  </div>
                </div>
                <div style={{ fontWeight: 600 }}>{(e.amount > 0 ? "+" : "") + (cur === "points" ? points(e.amount) : e.amount)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- 战报、全服广播、排行榜 (F1–F3) -------------------------------------------------------------------------

/** "↑2" / "↓1" / "—" (F1, F3 "名次变化"). */
export function rankChange(change: number | null | undefined): string {
  if (change === null || change === undefined) return "";
  if (change > 0) return `↑${change}`;
  if (change < 0) return `↓${-change}`;
  return "—";
}

export function ReportsList() {
  const me = useSeasonMe();
  const list = useLoad(() => seasonApi.reports());
  const [open, setOpen] = useState<string | null>(null);
  const detail = useLoad(() => (open ? seasonApi.report(open) : Promise.resolve(null)), [open]);
  if (me.data?.status !== "playing") return <Empty title="还没有战报">赛季开始后，每天早、中、晚三次公布战报：争夺结果、周战争、法宝使用和排名变化。</Empty>;
  if (!list.data) return <div className="hint">正在加载……</div>;
  if (list.data.reports.length === 0) return <Empty title="还没有战报">每天早、中、晚三次公布。</Empty>;
  return (
    <>
      {list.data.reports.map((r) => (
        <div key={r.id} className="panel">
          <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} style={{ border: "none", background: "none", padding: 0, width: "100%", textAlign: "left", fontWeight: 600, color: "inherit" }}>
            {r.title}
          </button>
          {open === r.id && detail.data && (
            <div style={{ marginTop: 8 }}>
              {detail.data.lines.length === 0 ? (
                <div className="hint">这一期没有新消息。</div>
              ) : (
                (detail.data.sections ?? [{ title: "", lines: detail.data.lines }]).map((sec) => (
                  <div key={sec.title} style={{ marginBottom: 8 }}>
                    {sec.title && <div style={{ fontWeight: 600, color: "var(--ochre)" }}>{sec.title}</div>}
                    {sec.lines.map((l, i) => (
                      <div key={i}>· {l.text}</div>
                    ))}
                  </div>
                ))
              )}
              {detail.data.ranking.length > 0 && (
                <div style={{ marginTop: 8 }} aria-label="排名变化">
                  <div style={{ fontWeight: 600, color: "var(--ochre)" }}>排名变化</div>
                  {detail.data.ranking.map((x) => (
                    <div key={x.name} className="row" style={{ fontWeight: x.mine ? 700 : 400 }}>
                      <span style={{ width: 32 }}>{x.rank}</span>
                      <span className="grow">{x.name}</span>
                      <span>{points(x.points)}</span>
                      <span style={{ width: 44, textAlign: "right" }}>{rankChange(x.change)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function BroadcastList() {
  const me = useSeasonMe();
  const data = useLoad(() => seasonApi.broadcasts());
  if (me.data?.status !== "playing") return <Empty title="还没有广播">谁发起了进攻、谁用了法宝、谁买下了中心地，会实时出现在这里。</Empty>;
  return <FeedList lines={data.data?.lines ?? null} empty="还没有广播" />;
}

export function RankingList() {
  const me = useSeasonMe();
  const data = useLoad(() => seasonApi.ranking());
  if (me.data?.status !== "playing") return <Empty title="还没有排行榜">赛季开始后，这里显示本服各组的团队分和名次。</Empty>;
  return (
    <>
      {data.data?.final && <p className="hint">赛季结束了，这是最终排名；每组的奖学金按名次和团队分来分（奖池 {data.data.final.poolYuan} 元）。</p>}
      <TeamRanking serverId={me.data.server.id} rows={data.data?.ranking ?? null} mine={me.data.team.id} />
      <Link to={`/watch/${me.data.server.id}/showcase`} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
        <span className="grow">作品展</span>
        <RightOutline />
      </Link>
    </>
  );
}
