import type { RubricGuide } from "../../seasonApi";
import { TaskGuide } from "../../components/TaskGuide";
import { serverNow } from "../../api";
/**
 * The weekly and seasonal fights (PRD part 5):
 * - E8 周战争: the weeks, opponent, theme, constraint cards (choosing one to
 *   send in the gift weeks, §3.5, with the opponent's grade spread), the
 *   result and the loser's chest;
 * - E9 军需任务: the task, each member's own part, progress, the leader's
 *   summary, the result;
 * - E10 商店 and E11 仙品竞价: goods with prices and stock, buying with a
 *   confirmation, rare items via the preference round, auctions with the
 *   leading bid, countdown, +10 / +20 and the bid history;
 * - E12 大团战: camps, lines and values, the line board (leaders and
 *   deputies of the camp; last edited by), envoys, the published lines.
 */

import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Dialog, Input, Selector, TextArea, Toast } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { request } from "../../api";
import { countdown, shortTime } from "../../format";
import { Empty, PageHeader, ReadAloud } from "../../components/ui";
import { points, seasonApi } from "../../seasonApi";
import { TIER_TEXT } from "./ItemsPage";
import { errText, SeasonGate } from "./SeasonPages";
import { useLoad, useSeasonMe } from "./useSeason";

const link = { textDecoration: "none", color: "inherit" } as const;

// ---- 周战争 (E8) ---------------------------------------------------------------------------------------

interface WarWeek {
  week: number;
  pairedAt: number;
  opponent: { id: string; name: string } | null;
  bye: boolean;
  settled: boolean;
  result: { outcome: "win" | "lose" | "tie" | "bye"; points: number; chestItem: string | null } | null;
}

interface Card {
  id: string;
  kind: string;
  text: string;
}

interface WarView {
  week: number;
  theme: { title: string; task: string } | null;
  gift: boolean;
  giftDeadline: string | null;
  opponent: {
    id: string;
    name: string;
    grades: { grade: number; gradeLabel: string; count: number }[];
    /** From the questionnaire: how many members chose each play style (no names). */
    styles?: { style: string; text: string; count: number }[];
    /** The opponent's latest public works (作品展). */
    recentWorks?: { id: string; kind: string; submittedAt: string }[];
  } | null;
  bye: boolean;
  offered: Card[];
  chosen: Card | null;
  received: Card | null;
  settled: boolean;
  stakes?: string;
  deadline?: number;
  rubric?: RubricGuide;
  requirements?: string;
}

const OUTCOME_TEXT = { win: "赢了", lose: "输了", tie: "平局", bye: "轮空" } as const;

export function WarsPage() {
  const me = useSeasonMe();
  const wars = useLoad(() => request<{ weeks: WarWeek[] }>("GET", "/v1/season/wars"));
  return (
    <div className="page">
      <PageHeader title="周战争" />
      <SeasonGate me={me.data} title="周战争">
        {() => (
          <>
            {wars.data?.weeks.length === 0 && <Empty title="还没有周战争">每周四晚上配对对手，周五早上公布。</Empty>}
            {wars.data?.weeks.map((w) => (
              <Link key={w.week} to={`/season/wars/${w.week}`} className="panel row" style={link}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>第 {w.week} 周</div>
                  <div className="hint">
                    {w.bye ? "本周轮空" : w.opponent ? `对手：${w.opponent.name}` : "还没配对"}
                    {w.result ? ` · ${OUTCOME_TEXT[w.result.outcome]}（${w.result.points >= 0 ? "+" : ""}${points(w.result.points)}）` : ""}
                  </div>
                </div>
                <RightOutline />
              </Link>
            ))}
          </>
        )}
      </SeasonGate>
    </div>
  );
}

export function WarWeekPage() {
  const week = Number(useParams().week ?? 0);
  const me = useSeasonMe();
  const view = useLoad(() => request<WarView>("GET", `/v1/season/wars/${week}`), [week]);
  const list = useLoad(() => request<{ weeks: WarWeek[] }>("GET", "/v1/season/wars"));
  const cat = useLoad(() => seasonApi.catalogue());
  const [busy, setBusy] = useState(false);
  const result = list.data?.weeks.find((w) => w.week === week)?.result ?? null;
  const v = view.data;

  const choose = async (c: Card) => {
    const ok = await Dialog.confirm({ content: `把「${c.text}」送给对手？公布之前还可以改。` });
    if (!ok) return;
    setBusy(true);
    try {
      await request("POST", `/v1/season/wars/${week}/card`, { card: c.id });
      view.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={`第 ${week} 周周战争`} />
      {view.error && <div role="alert">{view.error}</div>}
      <SeasonGate me={me.data} title="周战争">
        {(m) =>
          v && (
            <>
              <div className="panel">
                {v.bye ? <div>本周轮空，不用交作品。</div> : <div>对手：{v.opponent?.name ?? "还没配对"}</div>}
                {v.opponent && v.opponent.grades.length > 0 && <div className="hint">对方的年级：{v.opponent.grades.map((g) => `${g.gradeLabel} ${g.count} 人`).join("、")}</div>}
                {v.opponent && !!v.opponent.styles?.length && <div className="hint">对方的游戏风格：{v.opponent.styles.map((x) => `${x.text} ${x.count} 人`).join("、")}</div>}
                {v.opponent && !!v.opponent.recentWorks?.length && (
                  <div className="hint">
                    对方最近的作品：
                    {v.opponent.recentWorks.map((w, i) => (
                      <Link key={w.id} to={`/watch/${m.server.id}/works/${w.id}`} style={{ marginRight: 8 }}>
                        作品 {i + 1}
                      </Link>
                    ))}
                  </div>
                )}
                {result && (
                  <div style={{ marginTop: 6, fontWeight: 600 }}>
                    {OUTCOME_TEXT[result.outcome]}，{result.points >= 0 ? "+" : ""}
                    {points(result.points)} 分{result.chestItem ? `；宝箱开出：${cat.data?.items.find((i) => i.id === result.chestItem)?.name ?? result.chestItem}` : ""}
                  </div>
                )}
              </div>
              {v.theme && (
                <>
                  <h2 className="section-title">本周主题</h2>
                  <div className="panel">
                    <div className="row">
                      <div className="grow" style={{ fontWeight: 700 }}>
                        {v.theme.title}
                      </div>
                      <ReadAloud text={`${v.theme.title}。${v.theme.task}`} />
                    </div>
                    <p>{v.theme.task}</p>
                    {v.deadline && !v.settled && <div style={{ color: "var(--vermilion)" }}>作品截止：{countdown(v.deadline)}</div>}
                  </div>
                </>
              )}
              {v.stakes && (
                <>
                  <h2 className="section-title">输赢怎么算</h2>
                  <div className="panel">{v.stakes}</div>
                </>
              )}
              <TaskGuide rubric={v.rubric} requirements={v.requirements} compact />
              <h2 className="section-title">词条</h2>
              <div className="panel">
                {v.received ? <div>本组要遵守的词条：{v.received.text}</div> : <div className="hint">{v.gift ? "周五早上公布对手送给你们的词条。" : "这一周的固定词条稍后公布。"}</div>}
              </div>
              {v.gift && !v.received && v.offered.length > 0 && (
                <>
                  <div className="field-label">
                    选一张送给对手{v.giftDeadline ? `（${countdown(Date.parse(v.giftDeadline))}）` : ""}——想想哪张对对方最难
                  </div>
                  {v.offered.map((c) => (
                    <div key={c.id} className="panel row" style={{ borderColor: v.chosen?.id === c.id ? "var(--ochre)" : undefined }}>
                      <span className="grow">
                        {c.text}
                        {v.chosen?.id === c.id ? "（已选）" : ""}
                      </span>
                      {m.canAct && v.chosen?.id !== c.id && (
                        <Button size="small" disabled={busy} onClick={() => void choose(c)}>
                          送这张
                        </Button>
                      )}
                    </div>
                  ))}
                  {!m.canAct && <p className="hint">请组长或副组长选词条。</p>}
                </>
              )}
              {!v.bye && (
                <Link to={`/season/works/${encodeURIComponent(`war:${week}`)}`} className="panel row" style={{ ...link, marginTop: 12 }}>
                  <span className="grow">{v.settled ? "看分数和评语" : "去作品工坊交作品"}</span>
                  <RightOutline />
                </Link>
              )}
            </>
          )
        }
      </SeasonGate>
    </div>
  );
}

// ---- 军需任务 (E9) -------------------------------------------------------------------------------------

interface SupplyTask {
  supplyId: string;
  week: number;
  title: string;
  perPerson: string;
  summaryTask: string;
  opensAt: string;
  deadline: string;
  open: boolean;
  progress: { submitted: number; members: number };
  mine: { text: string; at: string } | null;
  summary: { text: string; by: string; at: string } | null;
  result: { submittedMembers: number; quality: number; summary: number; grain: number | null; comment: string | null } | null;
}

export function SupplyPage() {
  const me = useSeasonMe();
  const data = useLoad(() => request<{ tasks: SupplyTask[] }>("GET", "/v1/season/supply"));
  return (
    <div className="page">
      <PageHeader title="军需任务" />
      <SeasonGate me={me.data} title="军需任务">
        {(m) => (
          <>
            {data.data?.tasks.length === 0 && <Empty title="还没有军需任务">军需任务每周发布，每个人交自己的那份，组长写小结，按全组的参与和质量发粮草。</Empty>}
            {data.data?.tasks.map((t) => <SupplyCard key={t.supplyId} t={t} canAct={m.canAct} active={m.active} onDone={data.reload} />)}
          </>
        )}
      </SeasonGate>
    </div>
  );
}

function SupplyCard({ t, canAct, active, onDone }: { t: SupplyTask; canAct: boolean; active: boolean; onDone: () => void }) {
  const [text, setText] = useState(t.mine?.text ?? "");
  const [sum, setSum] = useState(t.summary?.text ?? "");
  const [busy, setBusy] = useState(false);
  const send = async (kind: "entry" | "summary") => {
    const body = kind === "entry" ? text : sum;
    if (!body.trim()) {
      Toast.show({ content: "先写点内容" });
      return;
    }
    setBusy(true);
    try {
      await request("POST", `/v1/season/supply/${t.supplyId}/${kind}`, { text: body });
      Toast.show({ content: "交上去了，截止前还可以改" });
      onDone();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" aria-label={`军需任务 ${t.title}`}>
      <div className="row">
        <div className="grow" style={{ fontWeight: 700 }}>
          第 {t.week} 周 · {t.title}
        </div>
        <ReadAloud text={`${t.title}。每个人交：${t.perPerson}。组长小结：${t.summaryTask}`} />
      </div>
      <div className="hint">{t.open ? countdown(Date.parse(t.deadline)) : "已截止"}</div>
      <p>每个人交：{t.perPerson}</p>
      <p>组长小结：{t.summaryTask}</p>
      <div>
        已交 {t.progress.submitted}/{t.progress.members} 人{t.summary ? " · 小结已交" : ""}
      </div>
      {t.result && (
        <div style={{ marginTop: 8, fontWeight: 600 }}>
          结果：{t.result.grain !== null ? `+${t.result.grain} 粮草` : "没有粮草"}（参与 {t.result.submittedMembers} 人，质量 {t.result.quality}，小结 {t.result.summary}）
          {t.result.comment && <div className="hint" style={{ fontWeight: 400 }}>{t.result.comment}</div>}
        </div>
      )}
      {t.open && active && (
        <>
          <div className="field-label">我的那份{t.mine ? `（${shortTime(t.mine.at)} 交过，可以改）` : ""}</div>
          <TextArea className="text-input" placeholder={t.perPerson} value={text} onChange={setText} rows={3} aria-label="我的那份" />
          <Button size="small" style={{ marginTop: 6 }} disabled={busy} onClick={() => void send("entry")}>
            交我的那份
          </Button>
          {canAct && (
            <>
              <div className="field-label">小组小结（组长或副组长）</div>
              <TextArea className="text-input" placeholder={t.summaryTask} value={sum} onChange={setSum} rows={3} aria-label="小组小结" />
              <Button size="small" style={{ marginTop: 6 }} disabled={busy} onClick={() => void send("summary")}>
                交小结
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- 商店 (E10) and 仙品竞价 (E11) ------------------------------------------------------------------------

interface ShopView {
  opensAt: number;
  closesAt: number;
  open: boolean;
  rareRoundAt: number;
  rareRoundDone: boolean;
  epicStartAt: number;
  maxItems: number;
  maxEpic: number;
  antiSnipeMinutes: number;
  bought: string[];
  spendableGrain: number;
  frozenGrain: number;
  goods: { id: string; name: string; tier: "common" | "rare"; price: number; stock: number | null; mine: boolean }[];
  auctions: {
    itemId: string;
    name: string;
    startAt: number;
    endAt: number;
    extendedMinutes?: number;
    closed: boolean;
    minBid: number;
    leader: { teamId: string; name: string; amount: number; mine: boolean } | null;
    winner: { teamId: string; name: string } | null;
    bids: { team: string; amount: number; at: number; mine: boolean }[];
  }[];
}

export function ShopPage() {
  const me = useSeasonMe();
  const shop = useLoad(() => request<ShopView>("GET", "/v1/season/shop"));
  const cat = useLoad(() => seasonApi.catalogue());
  const [busy, setBusy] = useState(false);
  const s = shop.data;
  const effect = (id: string) => cat.data?.items.find((i) => i.id === id)?.effect ?? "";
  const tierOf = (id: string) => cat.data?.items.find((i) => i.id === id)?.tier;

  const buy = async (g: ShopView["goods"][number]) => {
    if (!s) return;
    const ok = await Dialog.confirm({ content: `花 ${g.price} 粮草买${g.name}？本组现有 ${s.spendableGrain}，之后剩 ${s.spendableGrain - g.price}。` });
    if (!ok) return;
    setBusy(true);
    try {
      await request("POST", "/v1/season/shop/buy", { itemId: g.id });
      Toast.show({ content: `买到了${g.name}` });
      shop.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="商店" />
      <SeasonGate me={me.data} title="商店">
        {(m) =>
          s && (
            <>
              <div className="panel">
                {s.open ? <div>商店开着：{countdown(s.closesAt)}</div> : serverNow() < s.opensAt ? <div>商店 {shortTime(new Date(s.opensAt).toISOString())} 开门</div> : <div>商店已经关门了</div>}
                <div className="hint">
                  本组能用的粮草 {s.spendableGrain}
                  {s.frozenGrain ? `（竞价冻结 ${s.frozenGrain}）` : ""} · 每组最多买 {s.maxItems} 件，仙品最多 {s.maxEpic} 件 · 已买 {s.bought.length} 件
                </div>
              </div>
              {!m.canAct && <p className="hint">请组长或副组长购买和出价。</p>}

              {(["common", "rare"] as const).map((tier) => (
                <div key={tier}>
                  <h2 className="section-title">
                    {TIER_TEXT[tier]}（{s.goods.find((g) => g.tier === tier)?.price ?? ""} 粮草）
                  </h2>
                  {tier === "rare" && !s.rareRoundDone && (
                    <Link to="/season/rounds/rare_round" className="panel row" style={link}>
                      <span className="grow">灵品先按偏好分配（{shortTime(new Date(s.rareRoundAt).toISOString())} 截止，排名靠后的组先挑），之后剩下的先到先得</span>
                      <RightOutline />
                    </Link>
                  )}
                  {s.goods
                    .filter((g) => g.tier === tier)
                    .map((g) => (
                      <div key={g.id} className="panel row">
                        <div className="grow">
                          <div style={{ fontWeight: 600 }}>
                            {g.name}
                            {g.stock !== null ? <span className="hint">（剩 {g.stock} 件）</span> : null}
                          </div>
                          <div className="hint">{effect(g.id)}</div>
                        </div>
                        {g.mine ? (
                          <span className="hint">已买</span>
                        ) : (
                          m.canAct &&
                          s.open &&
                          (() => {
                            const why =
                              g.stock !== null && !s.rareRoundDone
                                ? "分配后再买"
                                : g.stock === 0
                                  ? "卖完了"
                                  : s.bought.length >= s.maxItems
                                    ? `已买满 ${s.maxItems} 件`
                                    : g.price > s.spendableGrain
                                      ? "粮草不够"
                                      : null;
                            return (
                              <Button size="small" disabled={busy || why !== null} onClick={() => void buy(g)}>
                                {why ?? "买"}
                              </Button>
                            );
                          })()
                        )}
                      </div>
                    ))}
                </div>
              ))}

              <h2 className="section-title">仙品竞价</h2>
              {s.auctions.length === 0 ? (
                <div className="hint">仙品竞价 {shortTime(new Date(s.epicStartAt).toISOString())} 开始，每件 24 小时。</div>
              ) : (
                <>
                  <p className="hint" style={{ marginTop: -4 }}>每组最多拍得 {s.maxEpic} 件仙品，所以同一时间只能在一件上领先；被别人超过后，冻结的粮草自动回来，可以去拍别的。</p>
                  {s.auctions.map((a) => (
                    <Auction key={a.itemId} a={a} s={s} canAct={m.canAct} effect={effect(a.itemId)} hasEpic={s.bought.some((id) => tierOf(id) === "epic")} onDone={shop.reload} />
                  ))}
                </>
              )}
            </>
          )
        }
      </SeasonGate>
    </div>
  );
}

function Auction({ a, s, canAct, effect, hasEpic, onDone }: { a: ShopView["auctions"][number]; s: ShopView; canAct: boolean; effect: string; hasEpic: boolean; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const now = serverNow();
  const live = !a.closed && now >= a.startAt && now < a.endAt;
  const bid = async (n: number) => {
    if (!Number.isInteger(n) || n < next) {
      Toast.show({ content: `最少出 ${next}` });
      return;
    }
    if (n > s.spendableGrain) {
      Toast.show({ content: `本组能用的粮草只有 ${s.spendableGrain}` });
      return;
    }
    const ok = await Dialog.confirm({ content: `出价 ${n} 粮草竞拍${a.name}？出价后这部分粮草会被冻结，被别人超过时自动解冻。` });
    if (!ok) return;
    setBusy(true);
    try {
      await request("POST", "/v1/season/shop/bid", { itemId: a.itemId, amount: n });
      Toast.show({ content: "出价成功" });
      setAmount("");
      onDone();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const base = a.leader ? a.leader.amount : a.minBid - 10;
  const next = Math.max(a.minBid, base + 10);
  const leadingOther = s.auctions.find((x) => x.itemId !== a.itemId && !x.closed && x.leader?.mine);
  const blocked = hasEpic
    ? "本组已经有一件仙品了，不能再拍。"
    : leadingOther
      ? `本组正在${leadingOther.name}上领先，同一时间只能在一件仙品上领先。`
      : next > s.spendableGrain
        ? `本组能用的粮草 ${s.spendableGrain}，不够出 ${next}。`
        : null;
  return (
    <div className="panel" aria-label={`竞价 ${a.name}`}>
      <div style={{ fontWeight: 700 }}>{a.name}</div>
      <div className="hint">{effect}</div>
      {a.closed ? (
        <div style={{ marginTop: 6 }}>{a.winner ? `${a.winner.name}拍到了（${a.leader?.amount ?? ""} 粮草）` : "流拍了"}</div>
      ) : (
        <>
          <div style={{ marginTop: 6 }}>
            {a.leader ? `最高价 ${a.leader.amount}（${a.leader.mine ? "本组" : a.leader.name}）` : `起拍价 ${a.minBid}`}
          </div>
          <div style={{ color: "var(--vermilion)" }}>{now < a.startAt ? `${shortTime(new Date(a.startAt).toISOString())} 开始` : countdown(a.endAt, now)}</div>
          {!!a.extendedMinutes && <div style={{ color: "var(--vermilion)" }}>有人在最后时刻出价，已经延长了 {a.extendedMinutes} 分钟</div>}
          <div className="hint">最后 {s.antiSnipeMinutes} 分钟有人出价，会自动延长 {s.antiSnipeMinutes} 分钟。</div>
          {live && canAct && !a.leader?.mine && blocked && <div className="hint" style={{ marginTop: 8 }}>{blocked}</div>}
          {live && canAct && !a.leader?.mine && !blocked && (
            <>
              <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                <Button size="small" disabled={busy} onClick={() => void bid(next)}>
                  出 {next}
                </Button>
                {next + 10 <= s.spendableGrain && (
                  <Button size="small" disabled={busy} onClick={() => void bid(next + 10)}>
                    出 {next + 10}
                  </Button>
                )}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <Input className="text-input" type="number" aria-label={`${a.name}出价`} placeholder={`${next} 到 ${s.spendableGrain}`} value={amount} onChange={setAmount} />
                <Button size="small" disabled={busy || !amount} onClick={() => void bid(Number(amount))}>
                  出价
                </Button>
              </div>
            </>
          )}
          {a.leader?.mine && <div className="hint">本组领先，{a.leader.amount} 粮草被冻结。</div>}
        </>
      )}
      {a.bids.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="hint">出价记录（{a.bids.length}）</summary>
          {[...a.bids].reverse().map((b, i) => (
            <div key={i} className="hint">
              {shortTime(new Date(b.at).toISOString())} {b.mine ? "本组" : b.team} 出 {b.amount}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// ---- 大团战 (E12) --------------------------------------------------------------------------------------

type BigBattle =
  | { formed: false }
  | {
      formed: true;
      myCamp: "a" | "b" | null;
      camps: Record<"a" | "b", { id: string; name: string }[]>;
      lineValues: number[];
      linesDeadline: number;
      publishAt: number;
      battleDeadline: number;
      myLines: { lines: string[]; by: string | null; byName: string | null; at: number } | null;
      final: Record<"a" | "b", string[]> | null;
      flags: { beishui?: boolean; jiancheng?: boolean; qiankun?: boolean };
      settled: boolean;
      lineTasks?: ({ title: string; body: string } | null)[];
      mainTask?: { title: string; body: string } | null;
      stakes?: string;
      mainWin?: number;
      result?: {
        lines: { line: number; value: number; sides: { teamId: string; name: string; outcome: "win" | "lose" | "tie" | "none"; points: number; mine: boolean }[] }[];
        main: "a" | "b" | "tie";
      } | null;
    };

const CAMP_TEXT = { a: "甲阵营", b: "乙阵营" } as const;
const LINE_OUTCOME = { win: "赢", lose: "输", tie: "同分", none: "都没交" } as const;

export function BigBattlePage() {
  const me = useSeasonMe();
  const bb = useLoad(() => request<BigBattle>("GET", "/v1/season/big-battle"));
  const envoys = useLoad(() => request<{ camp: string | null; envoys: { childId: string; nickname: string; teamId: string; team: string }[] }>("GET", "/v1/season/big-battle/envoys"));
  const qr = useLoad(() => request<{ camp: { url: string } | null }>("GET", "/v1/season/qr"));
  const [board, setBoard] = useState<string[] | null>(null);
  const [envoy, setEnvoy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const b = bb.data;

  const saveLines = async (lines: string[]) => {
    if (lines.some((x) => !x) || new Set(lines).size !== lines.length) {
      Toast.show({ content: "每条线派一个组，不能重复" });
      return;
    }
    setBusy(true);
    try {
      await request("POST", "/v1/season/big-battle/lines", { lines });
      Toast.show({ content: "战线分配已保存" });
      setBoard(null);
      bb.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const addEnvoy = async () => {
    if (!envoy) return;
    try {
      await request("POST", "/v1/season/big-battle/envoys", { childId: envoy });
      setEnvoy(null);
      envoys.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    }
  };

  return (
    <div className="page">
      <PageHeader title="大团战" />
      <SeasonGate me={me.data} title="大团战">
        {(m) => {
          if (!b) return <div className="hint">正在加载……</div>;
          if (!b.formed) return <Empty title="大团战还没开始">第 5 周开始时，按排名分成两个阵营，各组派到不同的战线上比拼。</Empty>;
          const camp = b.myCamp;
          const name = (id: string) => [...b.camps.a, ...b.camps.b].find((t) => t.id === id)?.name ?? "";
          const mine = camp ? b.camps[camp] : [];
          const now = serverNow();
          const editable = !!camp && m.canAct && now < b.linesDeadline;
          const cur = board ?? b.myLines?.lines ?? b.lineValues.map(() => "");
          return (
            <>
              <div className="panel">
                {(["a", "b"] as const).map((c) => (
                  <div key={c} style={{ fontWeight: c === camp ? 700 : 400 }}>
                    {CAMP_TEXT[c]}
                    {c === camp ? "（本阵营）" : ""}：{b.camps[c].map((t) => t.name).join("、")}
                  </div>
                ))}
                {qr.data?.camp && (
                  <a href={qr.data.camp.url} target="_blank" rel="noreferrer">
                    阵营微信群二维码
                  </a>
                )}
              </div>

              {b.result && (
                <>
                  <h2 className="section-title">结果</h2>
                  <div className="panel">
                    {b.result.lines.map((l) => (
                      <div key={l.line} style={{ padding: "4px 0" }}>
                        <div className="hint">
                          第 {l.line + 1} 条线 · {l.value} 分
                        </div>
                        {l.sides.map((x) => (
                          <div key={x.teamId} className="row" style={{ fontWeight: x.mine ? 700 : 400 }}>
                            <span className="grow">{x.name}</span>
                            <span>
                              {LINE_OUTCOME[x.outcome]} {x.points > 0 ? "+" : ""}
                              {points(x.points)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div style={{ marginTop: 6, fontWeight: 600 }}>
                      主战场：{b.result.main === "tie" ? "同分，双方都不加分" : `${CAMP_TEXT[b.result.main]}赢了${b.result.main === camp ? "（本阵营）" : ""}，每组 +${b.mainWin ?? 12}`}
                    </div>
                  </div>
                </>
              )}

              {b.stakes && !b.result && (
                <>
                  <h2 className="section-title">怎么比</h2>
                  <div className="panel hint">{b.stakes}</div>
                </>
              )}

              <h2 className="section-title">战线</h2>
              {!b.final ? (
                <div className="hint">
                  {now < b.linesDeadline ? `战线分配：${countdown(b.linesDeadline, now)}；没分配的系统随机分配。` : `已截止，${shortTime(new Date(b.publishAt).toISOString())} 双方同时公布。`}
                </div>
              ) : (
                <div className="hint">
                  战线已公布。
                  {now < b.battleDeadline ? `作品 ${countdown(b.battleDeadline, now)}` : b.settled ? "" : "作品已截止，评分和复核完成后公布结果。"}
                </div>
              )}
              {b.myLines && !b.final && (
                <div className="hint">
                  最后修改：{b.myLines.byName ?? "—"}（{shortTime(new Date(b.myLines.at).toISOString())}）
                </div>
              )}
              <div className="panel">
                {b.lineValues.map((v, i) => (
                  <div key={i} style={{ padding: "6px 0" }}>
                    <div style={{ fontWeight: 600 }}>
                      第 {i + 1} 条线 · {v} 分
                    </div>
                    {b.lineTasks?.[i] && (
                      <div className="hint">
                        <b>{b.lineTasks[i]!.title}</b>：{b.lineTasks[i]!.body}
                      </div>
                    )}
                    {b.final ? (
                      <div>
                        {name(b.final.a[i] ?? "")} 对 {name(b.final.b[i] ?? "")}
                      </div>
                    ) : editable ? (
                      <Selector
                        columns={2}
                        options={mine.map((t) => ({ label: t.name, value: t.id }))}
                        value={cur[i] ? [cur[i]!] : []}
                        onChange={(val) => {
                          const next = [...cur];
                          const pick = val[0] ?? "";
                          const prev = next.indexOf(pick);
                          if (pick && prev >= 0 && prev !== i) next[prev] = next[i] ?? "";
                          next[i] = pick;
                          setBoard(next);
                        }}
                      />
                    ) : (
                      <div className="hint">{cur[i] ? name(cur[i]!) : "还没派"}</div>
                    )}
                  </div>
                ))}
              </div>
              {editable && (
                <Button color="primary" block className="big-button" loading={busy} onClick={() => void saveLines(cur)}>
                  保存战线分配
                </Button>
              )}
              {camp && !m.canAct && !b.final && <p className="hint">阵营里任何一位组长或副组长都可以分配战线。</p>}

              <h2 className="section-title">使者团（主战场）</h2>
              {b.mainTask && (
                <p className="hint" style={{ marginTop: -4 }}>
                  <b>{b.mainTask.title}</b>：{b.mainTask.body}
                </p>
              )}
              <div className="panel">
                {envoys.data?.envoys.length === 0 && <div className="hint">还没有使者。各组派代表，一起完成主战场作品。</div>}
                {envoys.data?.envoys.map((e) => (
                  <div key={e.childId}>
                    {e.nickname}（{e.team}）
                  </div>
                ))}
              </div>
              {m.canAct && camp && !b.settled && now < b.battleDeadline && (
                <>
                  <Selector columns={3} options={m.members.filter((x) => x.active).map((x) => ({ label: x.nickname, value: x.childId }))} value={envoy ? [envoy] : []} onChange={(v) => setEnvoy(v[0] ?? null)} />
                  <Button size="small" style={{ marginTop: 6 }} disabled={!envoy} onClick={() => void addEnvoy()}>
                    登记为使者
                  </Button>
                </>
              )}
              {b.final && camp && (
                <>
                  <Link to="/season/works/line" className="panel row" style={{ ...link, marginTop: 12 }}>
                    <span className="grow">本组的战线作品</span>
                    <RightOutline />
                  </Link>
                  <Link to={`/season/works/${encodeURIComponent(`main:${camp}`)}`} className="panel row" style={link}>
                    <span className="grow">主战场作品</span>
                    <RightOutline />
                  </Link>
                </>
              )}
            </>
          );
        }}
      </SeasonGate>
    </div>
  );
}
