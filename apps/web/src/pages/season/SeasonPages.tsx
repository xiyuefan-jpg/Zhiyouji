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
import { ApiError } from "../../api";
import { shortTime } from "../../format";
import { Avatar, Empty, PageHeader, Seal } from "../../components/ui";
import { points, seasonApi, type FeedLine, type LandView, type SeasonMe } from "../../seasonApi";
import { useLoad, useSeasonMe } from "./useSeason";
import { RolesPanel } from "./TeamPages";

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
  const map = useLoad(() => seasonApi.map());
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
            <div className="hint">
              {l.owner ? `主人：${l.owner.name}` : "还没有主人"}
              {l.zeroed ? " · 产出被生死簿归零" : ""}
            </div>
            {l.contest && <div style={{ color: "var(--vermilion)", fontSize: 14 }}>争夺中 · {shortTime(new Date(l.contest.deadline).toISOString())} 截止</div>}
          </div>
          <RightOutline />
        </Link>
      ))}
    </>
  );
}

// ---- 地块详情、发起或加入进攻 (D2, D3) -----------------------------------------------------------------

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
        const ok = await Dialog.confirm({ content: `用粮草买下${land.name}？` });
        if (!ok) return;
        setBusy(true);
        await seasonApi.buyCenter(land.id);
        Toast.show({ content: `买下了${land.name}` });
      } else {
        const q = await seasonApi.quote(land.id);
        const parts = [`基础 ${q.base}`, q.exile ? "流亡令 ×0.5" : "", q.crusade ? "讨伐令 ×0.7" : ""].filter(Boolean).join("，");
        const ok = await Dialog.confirm({
          content: (
            <div>
              <p>费用：{parts} → <b>{q.cost} 粮草</b></p>
              <p>本组现有 {q.grain}，之后剩 {q.grain - q.cost}。</p>
              <p className="hint">题目将从这块地的题库里随机抽取。截止时间是第 3 天晚上 9 点。</p>
              <p>花 {q.cost} 粮草{kind === "attack" ? "发起进攻" : "加入进攻"}？</p>
            </div>
          ),
        });
        if (!ok) return;
        setBusy(true);
        if (kind === "attack") await seasonApi.attack(land.id);
        else await seasonApi.join(land.contest!.id);
        Toast.show({ content: kind === "attack" ? "已发起进攻" : "已加入进攻" });
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
            <div>{land.kind === "center" ? "中心地" : "边缘地"} · 每天产出 {land.output} 分</div>
            <div>主人：{land.owner ? land.owner.name : "还没有主人"}</div>
            {land.effects.length > 0 && <div className="hint">身上的法宝效果：{land.effects.map((e) => e.kind).join("、")}</div>}
            {land.contest && (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: "var(--vermilion)" }}>争夺中，{shortTime(new Date(land.contest.deadline).toISOString())} 截止</div>
                <div className="hint">进攻方：{land.contest.attackers.map((a) => a?.name).join("、")}</div>
                <Link to={`/season/contests/${land.contest.id}`}>争夺详情（题目）</Link>
              </div>
            )}
          </div>
          {!me.data.canAct && <p className="hint">请组长或副组长操作。</p>}
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {land.owner && !land.mine && !land.contest && (
              <Button color="primary" className="big-button" disabled={!me.data.canAct || busy} onClick={() => void act("attack")}>
                发起进攻
              </Button>
            )}
            {land.contest && !land.mine && (
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

// ---- 小组 (E1, E3) ------------------------------------------------------------------------------------

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
            {team.data && (
              <div className="panel row" style={{ justifyContent: "space-around", textAlign: "center" }}>
                <Stat label="名次" value={team.data.rank ? `第 ${team.data.rank}` : "—"} />
                <Stat label="团队分" value={points(team.data.points)} />
                <Stat label="粮草" value={String(team.data.spendableGrain)} sub={team.data.frozenGrain ? `冻结 ${team.data.frozenGrain}` : undefined} />
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
            <div className="panel row" style={{ marginTop: 12 }}>
              <Link to="/team/works" className="grow" style={{ color: "inherit" }}>
                作品工坊
              </Link>
              <RightOutline />
            </div>
            <div className="panel row">
              <Link to="/season/items" className="grow" style={{ color: "inherit" }}>
                法宝囊
              </Link>
              <RightOutline />
            </div>
            <div className="panel row">
              <Link to="/team/ledger" className="grow" style={{ color: "inherit" }}>
                粮草和团队分明细
              </Link>
              <RightOutline />
            </div>
            <h2 className="section-title">组内动态</h2>
            <FeedList lines={feed.data?.lines ?? null} empty="还没有动态" />
          </>
        );
      }}
    </SeasonGate>
  );
}

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
              {detail.data.lines.length === 0 ? <div className="hint">这一期没有新消息。</div> : detail.data.lines.map((l, i) => <div key={i}>· {l.text}</div>)}
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
  if (!data.data) return <div className="hint">正在加载……</div>;
  return (
    <div className="panel">
      {data.data.ranking.map((r) => (
        <div key={r.teamId} className="row" style={{ padding: "6px 0", fontWeight: r.mine ? 700 : 400 }}>
          <span style={{ width: 28 }}>{r.rank}</span>
          <span className="grow">
            {r.name}
            {r.mine ? "（本组）" : ""}
          </span>
          <span className="hint">{r.lands} 块地</span>
          <span style={{ width: 56, textAlign: "right" }}>{points(r.points)}</span>
        </div>
      ))}
    </div>
  );
}
