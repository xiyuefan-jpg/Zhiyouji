/**
 * More team pages (PRD part 5):
 * - E7 争夺详情: the prompt and audience, the countdown, the teams, the
 *   debate (side and stage, the other side's opening), the result;
 * - E3 移交、接任: hand the leader or deputy seat to a member (who accepts),
 *   answer a hand-over, the deputy takes over when the leader has been away;
 * - D4 偏好提交: blind auction (bid + land order), starter items, D8 center
 *   lands, rare items — editable until the deadline.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Dialog, Input, Selector, Toast } from "antd-mobile";
import { DownOutline, UpOutline } from "antd-mobile-icons";
import { countdown } from "../../format";
import { Empty, PageHeader, ReadAloud } from "../../components/ui";
import { seasonApi, type ContestOutcome, type Member, type RoundName, type SeasonMe } from "../../seasonApi";
import { errText, ROLE_TEXT, SeasonGate } from "./SeasonPages";
import { useLoad, useSeasonMe } from "./useSeason";

type Playing = Extract<SeasonMe, { status: "playing" }>;

// ---- 争夺详情 (E7) -------------------------------------------------------------------------------------

export function outcomeLine(o: ContestOutcome | null, names: (id: string) => string): string | null {
  if (!o) return null;
  if (o.kind === "captured") return `${names(o.winner)}拿下了这块地`;
  if (o.kind === "defended") return "守方守住了这块地";
  if (o.kind === "cancelled") return o.by === "xiuli" ? "守方用袖里乾坤取消了这场争夺" : "这场争夺被管理员取消了";
  return "这场争夺没有分出胜负，地还是原来的主人";
}

const SIDE_TEXT = { pro: "正方", con: "反方" } as const;

export function ContestPage() {
  const { id = "" } = useParams();
  const me = useSeasonMe();
  const c = useLoad(() => seasonApi.contest(id), [id]);
  const debate = useLoad(() => seasonApi.debate(id), [id]);
  const map = useLoad(() => seasonApi.map());
  const [busy, setBusy] = useState(false);
  const land = map.data?.lands.find((l) => l.id === c.data?.landId);
  const teamName = (tid: string) => map.data?.teams.find((t) => t.id === tid)?.name ?? "";
  const now = Date.now();

  const choose = async (side: "pro" | "con") => {
    const ok = await Dialog.confirm({ content: `本组选${SIDE_TEXT[side]}？选了以后不能改。` });
    if (!ok) return;
    setBusy(true);
    try {
      await seasonApi.chooseSide(id, side);
      debate.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={land ? `${land.name} · 争夺` : "争夺详情"} />
      {c.error && <div role="alert">{c.error}</div>}
      {c.data && me.data?.status === "playing" && (
        <>
          <div className="panel">
            {c.data.status === "active" ? (
              <div style={{ color: "var(--vermilion)" }}>作品截止：{countdown(c.data.deadline, now)}</div>
            ) : (
              <div style={{ fontWeight: 600 }}>{outcomeLine(c.data.outcome, teamName) ?? "已结束"}</div>
            )}
            {c.data.status === "active" && now < c.data.joinDeadline && <div className="hint">别的组还能加入进攻：{countdown(c.data.joinDeadline, now)}</div>}
            <div style={{ marginTop: 6 }}>守方：{c.data.defender.name}</div>
            <div>进攻方：{c.data.attackers.map((a) => a.name).join("、")}</div>
          </div>

          <h2 className="section-title">题目</h2>
          {c.data.prompt ? (
            <div className="panel">
              <div className="row">
                <div className="grow" style={{ fontWeight: 700 }}>
                  {c.data.prompt.title}
                </div>
                <ReadAloud text={`${c.data.prompt.title}。${c.data.prompt.body}`} />
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{c.data.prompt.body}</p>
              {c.data.prompt.audience && <div className="hint">讲给：{c.data.prompt.audience}</div>}
            </div>
          ) : (
            <div className="hint">题目从这块地的题库里抽取（编号 {c.data.landId}）。</div>
          )}

          {debate.data?.debate && <DebatePanel d={debate.data} isDefender={c.data.defender.id === me.data.team.id} canAct={me.data.canAct} busy={busy} onChoose={(s) => void choose(s)} />}

          {c.data.involved && (
            <>
              <h2 className="section-title">本组的作品</h2>
              {debate.data?.debate && (
                <Link to={`/season/works/${encodeURIComponent(`contest:${id}:open`)}`} className="panel row" style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="grow">立论</span>
                  <span className="hint">{countdown(Date.parse(debate.data.openingDeadline), now)}</span>
                </Link>
              )}
              <Link to={`/season/works/${encodeURIComponent(`contest:${id}`)}`} className="panel row" style={{ color: "inherit", textDecoration: "none" }}>
                <span className="grow">{debate.data?.debate ? "驳论" : "作品"}</span>
                <span className="hint">{c.data.status === "active" ? "去作品工坊" : "看分数和评语"}</span>
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DebatePanel({ d, isDefender, canAct, busy, onChoose }: { d: Extract<Awaited<ReturnType<typeof seasonApi.debate>>, { debate: true }>; isDefender: boolean; canAct: boolean; busy: boolean; onChoose: (s: "pro" | "con") => void }) {
  const now = Date.now();
  const stage = d.stage === "opening" ? "立论阶段" : d.stage === "rebuttal" ? "驳论阶段" : "已截止";
  return (
    <>
      <h2 className="section-title">辩论</h2>
      <div className="panel">
        <div>
          {stage}
          {d.mySide ? ` · 本组是${SIDE_TEXT[d.mySide]}${d.sideBy === "system" ? "（守方没选，系统随机）" : ""}` : " · 守方还没选持方"}
        </div>
        {!d.mySide && <div className="hint">守方选持方：{countdown(Date.parse(d.sideDeadline), now)}</div>}
        {d.noDefender && <p className="hint">守方没交立论：进攻方请自己列出对方最可能说的 2 个论点，再逐条反驳。</p>}
        {!d.mySide && isDefender && canAct && now < Date.parse(d.sideDeadline) && (
          <div className="row" style={{ marginTop: 10 }}>
            <Button color="primary" disabled={busy} onClick={() => onChoose("pro")}>
              我们选正方
            </Button>
            <Button disabled={busy} onClick={() => onChoose("con")}>
              我们选反方
            </Button>
          </div>
        )}
        {!d.mySide && isDefender && !canAct && <p className="hint">请组长或副组长选持方。</p>}
      </div>
      {d.openings.length > 0 && (
        <>
          <div className="field-label">对方的立论</div>
          {d.openings.map((o) => (
            <div key={o.teamId} className="panel">
              <div style={{ fontWeight: 600 }}>{o.team}</div>
              {o.text && <p style={{ whiteSpace: "pre-wrap" }}>{o.text}</p>}
              {o.files.map((f) => (
                <div key={f.id}>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    打开{f.kind === "video" ? "视频" : f.kind === "audio" ? "音频" : f.kind === "pdf" ? "文件" : "图片"}
                  </a>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ---- 移交、接任 (E3) -------------------------------------------------------------------------------------

export function RolesPanel({ m, onChange }: { m: Playing; onChange: () => void }) {
  const tr = useLoad(() => seasonApi.transfers(), [m.role]);
  const [giving, setGiving] = useState<"leader" | "deputy" | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const nick = (id: string) => m.members.find((x) => x.childId === id)?.nickname ?? "";
  const mineOut = tr.data?.transfers.filter((t) => t.from === m.members.find((x) => x.me)?.childId) ?? [];
  const forMe = tr.data?.transfers.filter((t) => t.forMe) ?? [];
  if (!m.active || m.season.status === "ended") return null;

  const answer = async (id: string, accept: boolean) => {
    try {
      await seasonApi.answerTransfer(id, accept);
      Toast.show({ content: accept ? "接过来了" : "已婉拒" });
      tr.reload();
      onChange();
    } catch (e) {
      Toast.show({ content: errText(e) });
    }
  };
  const offer = async () => {
    if (!giving || !to) return;
    try {
      await seasonApi.offerRole(giving, to);
      Toast.show({ content: `已发给${nick(to)}，等对方接受` });
      setGiving(null);
      setTo(null);
      tr.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    }
  };
  const takeOver = async () => {
    const ok = await Dialog.confirm({ content: "组长 3 天没来过时，副组长可以接任组长。现在接任？" });
    if (!ok) return;
    try {
      await seasonApi.takeOver();
      Toast.show({ content: "你现在是组长了" });
      onChange();
    } catch (e) {
      Toast.show({ content: errText(e) });
    }
  };

  const candidates: Member[] = m.members.filter((x) => x.active && !x.me && (giving === "leader" ? true : x.role !== "leader"));
  return (
    <>
      {forMe.map((t) => (
        <div key={t.id} className="panel" style={{ borderColor: "var(--vermilion)" }}>
          <div>
            {nick(t.from)}想把{ROLE_TEXT[t.role]}交给你。
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Button color="primary" onClick={() => void answer(t.id, true)}>
              接受
            </Button>
            <Button onClick={() => void answer(t.id, false)}>婉拒</Button>
          </div>
        </div>
      ))}
      {mineOut.map((t) => (
        <div key={t.id} className="panel hint">
          已把{ROLE_TEXT[t.role]}移交给{nick(t.to)}，等对方接受。
        </div>
      ))}
      {m.role !== "member" && (
        <div className="panel">
          {!giving ? (
            <div className="row">
              <Button size="small" onClick={() => setGiving(m.role === "leader" ? "leader" : "deputy")}>
                移交{ROLE_TEXT[m.role]}
              </Button>
              {m.role === "deputy" && (
                <Button size="small" onClick={() => void takeOver()}>
                  接任组长
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="field-label">把{ROLE_TEXT[giving]}交给谁？对方接受以后才生效。</div>
              {candidates.length === 0 ? <div className="hint">没有可以移交的组员。</div> : <Selector columns={2} options={candidates.map((x) => ({ label: x.nickname, value: x.childId }))} value={to ? [to] : []} onChange={(v) => setTo(v[0] ?? null)} />}
              <div className="row" style={{ marginTop: 10 }}>
                <Button color="primary" size="small" disabled={!to} onClick={() => void offer()}>
                  发给对方
                </Button>
                <Button size="small" onClick={() => setGiving(null)}>
                  算了
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---- 偏好提交 (D4, E10 灵品) ---------------------------------------------------------------------------

const ROUND_TEXT: Record<RoundName, { title: string; what: string }> = {
  blind_auction: { title: "盲拍：边缘地", what: "出一个价，再把想要的边缘地按顺序排好。出价高的组先挑。" },
  starter_items: { title: "开营法宝", what: "把想要的凡品按顺序排好，每组分到一件。" },
  center_round: { title: "中心地分配", what: "把想要的中心地按顺序排好，排名靠后的组先挑。" },
  rare_round: { title: "灵品分配", what: "把想要的灵品按顺序排好，排名靠后的组先挑。" },
};

export const ROUNDS: RoundName[] = ["blind_auction", "starter_items", "center_round", "rare_round"];

export function RoundPage() {
  const round = (useParams().round ?? "") as RoundName;
  const me = useSeasonMe();
  const view = useLoad(() => seasonApi.round(round), [round]);
  const map = useLoad(() => seasonApi.map());
  const cat = useLoad(() => seasonApi.catalogue());
  const team = useLoad(() => seasonApi.team());
  const [prefs, setPrefs] = useState<string[]>([]);
  const [bid, setBid] = useState("0");
  const [busy, setBusy] = useState(false);
  const info = ROUND_TEXT[round];

  useEffect(() => {
    const s = view.data?.submission;
    if (s) {
      setPrefs(s.prefs);
      setBid(String(s.bid ?? 0));
    }
  }, [view.data]);

  if (!info)
    return (
      <div className="page">
        <PageHeader title="偏好" />
        <Empty title="没有这一项" />
      </div>
    );

  const options: { id: string; name: string }[] =
    round === "blind_auction" || round === "center_round"
      ? (map.data?.lands ?? []).filter((l) => l.kind === (round === "blind_auction" ? "edge" : "center") && !l.owner).map((l) => ({ id: l.id, name: l.name }))
      : (cat.data?.items ?? []).filter((i) => (round === "starter_items" ? i.tier === "common" && !i.bigBattle : i.tier === "rare")).map((i) => ({ id: i.id, name: i.name }));
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? map.data?.lands.find((l) => l.id === id)?.name ?? cat.data?.items.find((i) => i.id === id)?.name ?? id;
  const move = (i: number, d: -1 | 1) => {
    const next = [...prefs];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setPrefs(next);
  };

  const submit = async () => {
    const b = round === "blind_auction" ? Number(bid) : undefined;
    if (b !== undefined && (!Number.isInteger(b) || b < 0)) {
      Toast.show({ content: "出价要是 0 或正整数" });
      return;
    }
    if (prefs.length === 0) {
      Toast.show({ content: "至少排一个" });
      return;
    }
    if (b !== undefined && b > 0) {
      const ok = await Dialog.confirm({ content: `出价 ${b} 粮草？拍到了才扣，截止前可以改。` });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await seasonApi.submitRound(round, { bid: b, prefs });
      Toast.show({ content: "交上去了，截止前还可以改" });
      view.reload();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={info.title} />
      <SeasonGate me={me.data} title={info.title}>
        {(m) => {
          const v = view.data;
          const editable = !!v?.open && m.canAct && m.active;
          return (
            <>
              <p className="subtitle">{info.what}</p>
              {v && (
                <div className="panel">
                  {v.closed ? (
                    <div>已截止。分配结果在战报里。</div>
                  ) : v.open ? (
                    <div style={{ color: "var(--vermilion)" }}>截止：{v.deadline ? countdown(Date.parse(v.deadline)) : ""}</div>
                  ) : (
                    <div>还没开始{v.opensAt ? `，${countdown(Date.parse(v.opensAt)).replace("还剩", "还有").replace("）", "）开放")}` : ""}</div>
                  )}
                  {v.submission ? (
                    <div className="hint">
                      本组已提交{v.submission.bid !== null ? `：出价 ${v.submission.bid}` : ""}；{v.submission.prefs.map(nameOf).join(" > ")}
                    </div>
                  ) : (
                    <div className="hint">本组还没提交{v.closed ? "，系统按默认分配" : ""}。</div>
                  )}
                </div>
              )}
              {!m.canAct && <p className="hint">请组长或副组长提交。</p>}
              {editable && (
                <>
                  {round === "blind_auction" && (
                    <>
                      <div className="field-label">出价（粮草；本组现有 {team.data?.spendableGrain ?? "…"}）</div>
                      <Input className="text-input" type="number" aria-label="出价" value={bid} onChange={setBid} min={0} />
                    </>
                  )}
                  <div className="field-label">我们的顺序（最想要的放最上面）</div>
                  <div className="panel">
                    {prefs.length === 0 && <div className="hint">从下面点选加进来。</div>}
                    {prefs.map((p, i) => (
                      <div key={p} className="row" style={{ padding: "4px 0" }}>
                        <span style={{ width: 22 }}>{i + 1}</span>
                        <span className="grow">{nameOf(p)}</span>
                        <button type="button" aria-label={`${nameOf(p)}上移`} onClick={() => move(i, -1)} style={{ border: "none", background: "none" }}>
                          <UpOutline />
                        </button>
                        <button type="button" aria-label={`${nameOf(p)}下移`} onClick={() => move(i, 1)} style={{ border: "none", background: "none" }}>
                          <DownOutline />
                        </button>
                        <button type="button" aria-label={`去掉${nameOf(p)}`} onClick={() => setPrefs(prefs.filter((x) => x !== p))} style={{ border: "none", background: "none", color: "var(--vermilion)" }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="field-label">可以选的</div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {options
                      .filter((o) => !prefs.includes(o.id))
                      .map((o) => (
                        <Button key={o.id} size="small" onClick={() => setPrefs([...prefs, o.id])}>
                          + {o.name}
                        </Button>
                      ))}
                  </div>
                  <Button color="primary" block className="big-button" style={{ marginTop: 18 }} loading={busy} onClick={() => void submit()}>
                    {v?.submission ? "改好了，重新提交" : "提交"}
                  </Button>
                </>
              )}
            </>
          );
        }}
      </SeasonGate>
    </div>
  );
}
