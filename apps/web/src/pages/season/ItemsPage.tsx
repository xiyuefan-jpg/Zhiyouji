/**
 * 法宝囊 (PRD part 5 E5, §3.4): the team's items and the effects running now;
 * the catalogue (when, target, effect, with this season's numbers); using an
 * item: choose the target, see the punch-down note for a lower-ranked team,
 * confirm (says whether it is broadcast), and the result — including
 * "被挡下了" when the target's 辟火罩 or 照妖镜 caught it.
 */

import { useState } from "react";
import { Button, Dialog, Selector, Toast } from "antd-mobile";
import { request } from "../../api";
import { countdown } from "../../format";
import { Empty, PageHeader, Seal } from "../../components/ui";
import { seasonApi, type CatalogueItem, type ItemTarget, type UseItemBody, type UseItemResult } from "../../seasonApi";
import { errText, SeasonGate } from "./SeasonPages";
import { useLoad, useSeasonMe } from "./useSeason";

export const TIER_TEXT: Record<string, string> = { common: "凡品", rare: "灵品", epic: "仙品" };

const TARGET_TEXT: Record<ItemTarget, string> = {
  none: "本组",
  team: "选一个组",
  own_land: "本组的一块地",
  contest: "一场进攻本组地块的争夺",
  week: "一周的周战争",
  line: "一条战线",
  passive: "持有就生效，不用手动使用",
};

const SOURCE_TEXT: Record<string, string> = {
  starter: "开营法宝",
  chest: "败者宝箱",
  shop: "商店",
  rare_round: "灵品分配",
  epic_auction: "竞价",
  admin: "管理员发放",
  copy: "太虚幻镜复制",
};

export function outcomeText(o: UseItemResult["used"]["outcomes"][number]): string {
  if (o.outcome === "blocked") return `被${o.team}的辟火罩挡下了`;
  if (o.outcome === "reflected") return `被${o.team}的照妖镜反弹回来了`;
  return `命中了${o.team}`;
}

export function ItemsPage() {
  const me = useSeasonMe();
  const team = useLoad(() => seasonApi.teamFull());
  const cat = useLoad(() => seasonApi.catalogue());
  const [open, setOpen] = useState<{ itemId: string; uid?: string } | null>(null);
  const byId = new Map((cat.data?.items ?? []).map((i) => [i.id, i]));

  return (
    <div className="page">
      <PageHeader title="法宝囊" />
      <SeasonGate me={me.data} title="法宝囊">
        {(m) => (
          <>
            {team.error && <div role="alert">{team.error}</div>}
            <h2 className="section-title">本组的法宝</h2>
            <p className="hint" style={{ marginTop: -4 }}>点一下看效果{m.canAct ? "和使用" : "；使用要组长或副组长来"}。别的组看不到你们有什么法宝，用了才会广播。</p>
            {team.data && team.data.items.length === 0 && <Empty title="还没有法宝">开营法宝、周战争的败者宝箱、商店和竞价都能得到法宝。</Empty>}
            {team.data?.items.map((i) => (
              <button
                key={i.uid}
                type="button"
                className="panel row"
                style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", borderColor: open?.uid === i.uid ? "var(--ochre)" : undefined }}
                onClick={() => setOpen(open?.uid === i.uid ? null : { itemId: i.itemId, uid: i.uid })}
              >
                <Seal text={i.name.slice(0, 1)} size={36} tilt={0} outline={i.passive} />
                <span className="grow">
                  <span style={{ fontWeight: 600 }}>{i.name}</span>
                  <span className="hint">
                    {" "}
                    · {TIER_TEXT[i.tier] ?? i.tier}
                    {i.passive ? " · 持有就生效" : ""}
                    {SOURCE_TEXT[i.source] ? ` · ${SOURCE_TEXT[i.source]}` : ""}
                  </span>
                </span>
              </button>
            ))}
            {open?.uid && byId.get(open.itemId) && team.data && (
              <ItemDetail
                item={byId.get(open.itemId)!}
                uid={open.uid}
                canAct={m.canAct && m.active}
                copies={cat.data!.taixuCopies ? (byId.get(cat.data!.taixuCopies) ?? null) : null}
                punchDown={cat.data!.punchDownFactor}
                onUsed={() => {
                  setOpen(null);
                  team.reload();
                  cat.reload();
                }}
              />
            )}

            <h2 className="section-title">正在生效</h2>
            {team.data && <Effects effects={team.data.effects} myTeam={team.data.id} />}

            <h2 className="section-title">法宝图鉴</h2>
            {(["common", "rare", "epic"] as const).map((tier) => (
              <div key={tier}>
                <div className="field-label">{TIER_TEXT[tier]}</div>
                <div className="panel">
                  {cat.data?.items
                    .filter((i) => i.tier === tier)
                    .map((i) => (
                      <details key={i.id} style={{ padding: "4px 0" }}>
                        <summary style={{ cursor: "pointer" }}>{i.name}</summary>
                        <Guide item={i} />
                      </details>
                    ))}
                </div>
              </div>
            ))}
          </>
        )}
      </SeasonGate>
    </div>
  );
}

function Guide({ item }: { item: CatalogueItem }) {
  return (
    <div className="hint" style={{ margin: "4px 0 8px" }}>
      <div>使用时机：{item.when}</div>
      <div>目标：{TARGET_TEXT[item.target]}</div>
      <div style={{ color: "var(--ink)" }}>效果：{item.effect}</div>
    </div>
  );
}

const EFFECT_TEXT: Record<string, string> = {
  huanhun: "还魂金丹",
  dianhua: "点化之术",
  jiuzhuan: "九转兵劫印",
  shengsi: "生死簿",
  bagua: "八卦炉",
  sanmei: "三昧真火",
  yujing: "玉净瓶",
  danao: "大闹天宫",
};

function Effects({ effects, myTeam }: { effects: { kind: string; victim?: string; beneficiary?: string; landId?: string; until?: number; week?: number }[]; myTeam: string }) {
  if (effects.length === 0) return <div className="hint">现在没有生效的法宝。</div>;
  return (
    <div className="panel">
      {effects.map((e, i) => {
        const name = EFFECT_TEXT[e.kind] ?? e.kind;
        let what = name;
        if (e.kind === "sanmei") what = e.victim === myTeam ? `${name}：${e.landId} 的产出被别的组拿走` : `${name}：拿走别的组 ${e.landId} 的产出`;
        else if (e.landId) what = `${name}（${e.landId}）`;
        else if (e.week) what = `${name}（第 ${e.week} 周周战争）`;
        return (
          <div key={i} className="row" style={{ padding: "4px 0" }}>
            <span className="grow">{what}</span>
            {e.until && <span className="hint">{countdown(e.until)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function ItemDetail({ item, uid, canAct, copies, punchDown, onUsed }: { item: CatalogueItem; uid: string; canAct: boolean; copies: CatalogueItem | null; punchDown: number; onUsed: () => void }) {
  // 太虚幻镜 takes the target of the item it would copy.
  const acting = item.id === "taixu" ? copies : item;
  const target: ItemTarget = item.id === "taixu" ? (copies ? (copies.passive || copies.bigBattle ? "none" : copies.target) : "none") : item.target;
  const needsData = target === "team" || target === "own_land" || target === "contest" || target === "line";
  const data = useLoad(
    () =>
      needsData
        ? Promise.all([seasonApi.ranking(), seasonApi.teamFull(), seasonApi.map(), target === "line" ? request<{ formed: boolean; lineValues?: number[]; myCamp?: string | null; final?: Record<string, string[]> | null }>("GET", "/v1/season/big-battle") : Promise.resolve(null)])
        : Promise.resolve(null),
    [item.id, target],
  );
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ranking, team, map, bb] = data.data ?? [null, null, null, null];
  const landName = (id: string) => map?.lands.find((l) => l.id === id)?.name ?? id;
  const myRank = ranking?.ranking.find((r) => r.mine)?.rank ?? null;
  let options: { label: string; value: string }[] = [];
  if (target === "team" && ranking) options = ranking.ranking.filter((r) => !r.mine).map((r) => ({ label: `第 ${r.rank} 名 ${r.name}`, value: r.teamId }));
  if (target === "own_land" && team) options = team.lands.map((l) => ({ label: landName(l), value: l }));
  if (target === "contest" && team) options = team.contests.filter((c) => c.role === "defender" && c.status === "active").map((c) => ({ label: `${landName(c.landId)}的争夺`, value: c.id }));
  if (target === "line" && bb?.lineValues) options = bb.lineValues.map((v, i) => ({ label: `第 ${i + 1} 条线（${v} 分）`, value: String(i) }));
  const picked = ranking?.ranking.find((r) => r.teamId === pick);
  const lower = acting?.negative && target === "team" && picked && myRank !== null && picked.rank > myRank;

  const use = async () => {
    if (needsData && !pick) {
      Toast.show({ content: "先选一个目标" });
      return;
    }
    const ok = await Dialog.confirm({
      content: (
        <div>
          <p>
            使用<b>{item.name}</b>
            {item.id === "taixu" && copies ? `（复制${copies.name}）` : ""}
            {pick ? `，目标：${options.find((o) => o.value === pick)?.label ?? ""}` : ""}？
          </p>
          <p>{acting?.effect}</p>
          {lower && <p>对方排名比你们低，效果 × {punchDown}。</p>}
          <p className="hint">{item.broadcast ? "用了以后会全服广播。" : "只有本组知道。"}</p>
        </div>
      ),
    });
    if (!ok) return;
    const body: UseItemBody = { itemId: item.id, uid };
    if (target === "team") body.targetTeamId = pick!;
    if (target === "own_land") body.landId = pick!;
    if (target === "contest") body.contestId = pick!;
    if (target === "line") body.line = Number(pick);
    setBusy(true);
    try {
      const r = await seasonApi.useItem(body);
      const lines = [r.used.copied ? `太虚幻镜复制了${r.used.copied.name}。` : `用了${item.name}。`, ...r.used.outcomes.map((o) => outcomeText(o) + "。")];
      await Dialog.alert({ content: lines.join("\n"), confirmText: "知道了" });
      onUsed();
    } catch (e) {
      Toast.show({ content: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ borderColor: "var(--ochre)" }} aria-label={`${item.name}详情`}>
      <div style={{ fontWeight: 700 }}>
        {item.name} · {TIER_TEXT[item.tier]}
      </div>
      <Guide item={item} />
      {item.id === "taixu" && <p className="hint">{copies ? `现在用会复制：${copies.name}。${copies.effect}` : "现在还没有可以复制的法宝。"}</p>}
      {item.target === "passive" ? null : !canAct ? (
        <p className="hint">请组长或副组长操作。</p>
      ) : (
        <>
          {target === "week" && <p className="hint">会用在还没开始的最近一周的周战争（周五早间公布之前用，就是本周）。</p>}
          {needsData && (
            <>
              <div className="field-label">选{TARGET_TEXT[target].replace(/^选/, "")}</div>
              {options.length === 0 && data.data ? <div className="hint">现在没有可以选的目标。</div> : <Selector columns={1} options={options} value={pick ? [pick] : []} onChange={(v) => setPick(v[0] ?? null)} />}
              {lower && <p style={{ color: "var(--vermilion)" }}>对方排名比你们低，效果 × {punchDown}。</p>}
            </>
          )}
          <Button color="primary" block className="big-button" style={{ marginTop: 12 }} loading={busy} disabled={item.id === "taixu" && !copies} onClick={() => void use()}>
            使用
          </Button>
        </>
      )}
    </div>
  );
}
