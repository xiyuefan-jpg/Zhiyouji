/**
 * DEMO ONLY (never imported by main.ts): bot children, leaders and members
 * acting through the same services the API uses, so a demo season has other
 * teams that bid, attack, hand in works and do daily tasks. Ported from the
 * whole-season test (test/fullSeason.test.ts). Teams listed in `humanTeams`
 * are left to the people trying the site, except their bot members' own
 * daily tasks and supply parts.
 */

import { eq } from "drizzle-orm";
import { children, type Db } from "@zhiyouji/db";
import { createRng, quoteAttack, seasonDayOf, spendableGrain, type Rng } from "@zhiyouji/engine";
import type { Services } from "../http/app.js";
import type { PlayCtx } from "../season/play.js";

const DAILY_TEXT =
  "我今天用AI学了大气压。原来我以为空气没有重量，后来懂了空气也有重量会压在我们身上。我自己想到的例子是用吸管喝饮料，其实是外面的大气把饮料压进嘴里。";

export class Bots {
  private readonly rng: Rng;

  constructor(
    private readonly db: Db,
    private readonly s: Services,
    private readonly opening: string,
    private readonly botChildIds: Set<string>,
    seed = 2027,
  ) {
    this.rng = createRng(seed);
  }

  private async quiet(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch {
      return false; // refused by the rules — bots just move on
    }
  }

  /** One bot pass at time `at` (call every 2 hours of simulated time). */
  async step(serverId: string, seasonStatus: string, at: number, humanTeams: Set<string>): Promise<void> {
    if (!["running", "big_battle"].includes(seasonStatus)) return;
    const { s, rng } = this;
    const st = await s.store.state(serverId);
    const day = seasonDayOf(this.opening, at);
    const hour = new Date(at + 8 * 3_600_000).getUTCHours();
    const botTeams = st.teamOrder.filter((id) => !humanTeams.has(id));
    const ctxOf = (childId: string): Promise<PlayCtx> => s.play.ctx(childId);
    const leaderCtx = async (teamId: string): Promise<PlayCtx | null> => {
      const l = (await s.store.state(serverId)).teams[teamId]!.leader;
      return l && this.botChildIds.has(l) ? ctxOf(l) : null;
    };

    if (day === 0 && hour >= 20 && hour < 22)
      for (const id of botTeams) await this.quiet(async () => s.play.claimRole(await ctxOf(st.teams[id]!.members[0]!.childId), "leader"));
    if (day === 1 && hour >= 10 && hour < 12)
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        if (c) await this.quiet(() => s.play.submitRound(c, "blind_auction", { bid: rng.int(30), prefs: rng.shuffle(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]) }));
      }
    if (day === 2 && hour >= 10 && hour < 12)
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        if (c) await this.quiet(() => s.play.submitRound(c, "starter_items", { prefs: rng.shuffle(["huanhun", "yujing", "jianbi", "bihuo", "taixu"]) }));
      }
    if (day === 8 && hour >= 10 && hour < 12)
      for (const id of botTeams.slice(0, 3)) {
        const c = await leaderCtx(id);
        if (c) await this.quiet(() => s.play.submitRound(c, "center_round", { prefs: rng.shuffle(["C1", "C2", "C3", "C4"]) }));
      }
    if (day === 15 && hour >= 10 && hour < 12)
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        if (c) await this.quiet(() => s.play.submitRound(c, "rare_round", { prefs: ["dianhua", "jiuzhuan"] }));
      }
    // daily tasks: some bot children every morning
    if (hour >= 10 && hour < 12 && day >= 1 && day <= 33)
      for (const k of [...this.botChildIds].filter(() => rng.next() < 0.15)) {
        const child = (await this.db.select().from(children).where(eq(children.id, k)))[0];
        if (!child) continue;
        await this.quiet(async () => {
          const up = await s.daily.requestUpload(child, { kind: "image", contentType: "image/jpeg", size: 3 });
          const file = await this.db.query.files.findFirst({ where: (f, { eq: e }) => e(f.id, up.fileId) });
          await s.storage.put(file!.storageKey, Buffer.from("jpg"), "image/jpeg");
          await s.daily.completeUpload(child, up.fileId);
          await s.daily.submit(child, { templateId: 1, evidenceFileIds: [up.fileId], explain: { kind: "text", text: DAILY_TEXT }, aiNote: "问了 AI" });
        });
      }
    // one attack a day by a bot team that can afford it
    if (hour >= 12 && hour < 14 && day >= 2 && day <= 25) {
      const id = botTeams.length ? rng.pick(botTeams) : null;
      const c = id ? await leaderCtx(id) : null;
      if (id && c) {
        const targets = st.landOrder.filter(
          (l) => st.lands[l]!.owner && st.lands[l]!.owner !== id && !Object.values(st.contests).some((x) => x.landId === l && x.status === "active"),
        );
        if (targets.length) {
          const land = rng.pick(targets);
          if (quoteAttack(st, id, st.lands[land]!.owner!, at).cost <= spendableGrain(st, id)) await this.quiet(() => s.play.startContest(c, land));
        }
      }
    }
    // bot leaders hand in whatever work is open (some defenders do not answer)
    if ((hour >= 14 && hour < 16) || (hour >= 20 && hour < 22))
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        if (!c) continue;
        for (const slot of (await s.works.slots(c)).slots.filter((x) => x.open && !x.submitted)) {
          if (slot.kind === "contest" && st.contests[slot.slot.split(":")[1]!]?.defender === id && rng.next() < 0.3) continue;
          await this.quiet(() => s.works.submit(c, slot.slot, { mediaKind: "text", text: `（机器人小组的作品）${slot.slot}`, fileIds: [], members: [c.childId] }));
        }
      }
    // gift-week cards, supply parts and summaries, big-battle lines
    if (hour >= 20 && hour < 22)
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        for (const w of st.params.war.giftWeeks) {
          if (!c || !st.wars[w] || st.wars[w]!.settled) continue;
          const v = await s.warWords.view(c, w).catch(() => null);
          if (v && !v.chosen && v.offered[0]) await this.quiet(() => s.warWords.choose(c, w, v.offered[0]!.id));
        }
      }
    if ((hour >= 10 && hour < 12) || (hour >= 16 && hour < 18)) {
      for (const k of [...this.botChildIds].filter(() => rng.next() < 0.3)) {
        const c = await ctxOf(k).catch(() => null);
        if (!c) continue;
        for (const task of (await s.supply.list(c)).tasks.filter((x) => x.open && !x.mine))
          await this.quiet(() => s.supply.submitEntry(c, task.supplyId, { text: "我的那一份（机器人）", fileIds: [] }));
      }
      for (const id of botTeams) {
        const c = await leaderCtx(id);
        if (!c) continue;
        for (const task of (await s.supply.list(c)).tasks.filter((x) => x.open && !x.summary))
          await this.quiet(() => s.supply.submitSummary(c, task.supplyId, { text: "小组总结（机器人）", fileIds: [] }));
      }
    }
    if (day === 29 && hour >= 18 && hour < 20 && st.bigBattle)
      for (const camp of ["a", "b"] as const) {
        const teams = st.bigBattle.camps[camp];
        const lead = teams.find((t) => !humanTeams.has(t));
        const c = lead ? await leaderCtx(lead) : null;
        if (c) await this.quiet(() => s.play.submitLines(c, rng.shuffle(teams)));
      }
  }
}
