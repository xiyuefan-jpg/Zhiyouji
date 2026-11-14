/**
 * A whole season through the server with a simulated clock (PRD part 9 §1
 * step 4: "用模拟时钟能把一个赛季从头跑到尾"): 32 children, bot leaders and
 * members acting through the same services the API uses, the worker ticking
 * every 2 hours, nobody reviewing (every work settles on the AI score at the
 * time limit), the admin confirming the final settlement.
 */

import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { children, families, grainLedger, pointsLedger, reports, seasons } from "@zhiyouji/db";
import { balanceOf, checkLedger, createRng, grainOf, pointsOf, seasonDayOf, spendableGrain, quoteAttack, type Rng } from "@zhiyouji/engine";
import { Worker, type PlayCtx } from "../src/index.js";
import { bj, setup } from "./helpers.js";

const ADMIN = "admin:test";
const OPENING = "2027-02-07";
const HOUR = 3_600_000;
const TEXT = "我今天用AI学了大气压。原来我以为空气没有重量，后来懂了空气也有重量会压在我们身上。我自己想到的例子是用吸管喝饮料，其实是外面的大气把饮料压进嘴里。";

/** Three seasons in a row (PRD part 9 §2: 加速模拟赛季连续 3 次账本平衡、不需要人工干预). */
const SEEDS = [99, 7, 2031];

describe("a whole season through the server (part 9 §1 step 4)", () => {
  it.each(SEEDS)("seed %i: runs D0 → final settlement with bots, ticks and AI-timeout settlements; the ledger balances", async (seed) => {
    const t = await setup(bj("2027-02-01", 10));
    const s = t.services;
    const kids: string[] = [];
    for (let i = 0; i < 32; i++) {
      const [f] = await t.db.insert(families).values({ phone: `1370000${String(1000 + i)}`, consentVersion: t.cfg.policyVersion, consentAt: new Date() }).returning();
      const [c] = await t.db.insert(children).values({ familyId: f!.id, nickname: `孩子${i}`, grade: 1 + (i % 10) }).returning();
      kids.push(c!.id);
    }
    // big-battle prompts: lines in import order, then the main battlefield (content library §7)
    await s.bank.importMany(
      [
        ...[10, 15, 20, 25].map((v, i) => ({ category: "battle_line" as const, title: `战线${i + 1}`, body: `第 ${i + 1} 条线（${v} 分）的题`, rubric: i === 1 ? "D" : null, status: "enabled" as const })),
        { category: "battle_main" as const, title: "主战场", body: "把四条线整合成一份计划", status: "enabled" as const },
      ],
      ADMIN,
    );
    const season = await s.seasons.create({ name: "S3", opening: OPENING, seed }, ADMIN);
    await s.seasons.openEnrollment(season.id, ADMIN);
    await s.seasons.enroll(season.id, kids.map((childId) => ({ childId })), ADMIN);
    await s.seasons.generateGrouping(season.id, ADMIN);
    const lands = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "C1", "C2", "C3", "C4"];
    const prompts = Object.fromEntries(lands.map((l) => [l, Array.from({ length: 12 }, (_, i) => `${l}-q${i}`)]));
    const conf = await s.seasons.confirmGrouping(season.id, { prompts, landNames: { E7: "朱紫国" } }, ADMIN);
    const serverId = conf.servers[0]!.serverId;
    const worker = new Worker(t.db, s.scheduler, s.smsDispatcher, s.notifier, s.reports, s.reminders, s.scoring, s.dataRights, s.daily, s.supply, s.debates, s.ops);
    const rng: Rng = createRng(seed + 1928);
    const ctxOf = async (childId: string): Promise<PlayCtx> => s.play.ctx(childId);
    const leaderCtx = async (teamId: string): Promise<PlayCtx | null> => {
      const st = await s.store.state(serverId);
      const l = st.teams[teamId]!.leader;
      return l ? ctxOf(l) : null;
    };
    const quiet = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return true;
      } catch {
        return false; // refused by the rules (not enough grain, window closed…) — bots just move on
      }
    };
    const stats = { attacks: 0, daily: 0, works: 0, supply: 0 };

    const end = bj("2027-03-14", 12); // D35
    for (let at = +bj(OPENING, 18); at <= +end; at += 2 * HOUR) {
      t.clock.set(at);
      await worker.tick();
      const st = await s.store.state(serverId);
      const day = seasonDayOf(OPENING, at);
      const hour = new Date(at + 8 * HOUR).getUTCHours();
      const status = (await s.seasons.season(season.id)).status;
      if (!["running", "big_battle"].includes(status)) continue;
      const teamIds = st.teamOrder;

      // D0 evening: the first member of each team claims the leader seat
      if (day === 0 && hour === 20)
        for (const id of teamIds) await quiet(async () => s.play.claimRole(await ctxOf(st.teams[id]!.members[0]!.childId), "leader"));
      // rounds
      if (day === 1 && hour === 10)
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          if (c) await quiet(() => s.play.submitRound(c, "blind_auction", { bid: rng.int(30), prefs: rng.shuffle(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]) }));
        }
      if (day === 2 && hour === 10)
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          if (c) await quiet(() => s.play.submitRound(c, "starter_items", { prefs: rng.shuffle(["huanhun", "yujing", "jianbi", "bihuo", "taixu"]) }));
        }
      if (day === 8 && hour === 10)
        for (const id of teamIds.slice(0, 4)) {
          const c = await leaderCtx(id);
          if (c) await quiet(() => s.play.submitRound(c, "center_round", { prefs: rng.shuffle(["C1", "C2", "C3", "C4"]) }));
        }
      if (day === 15 && hour === 10)
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          if (c) await quiet(() => s.play.submitRound(c, "rare_round", { prefs: ["dianhua", "jiuzhuan"] }));
        }
      if (day === 15 && hour === 20) {
        const rich = [...teamIds].sort((a, b) => spendableGrain(st, b) - spendableGrain(st, a))[0]!;
        const c = await leaderCtx(rich);
        const item = st.shop.auctions[0]?.itemId;
        if (c && item && spendableGrain(st, rich) >= st.params.items.epicStartPrice) await quiet(() => s.play.bidEpic(c, item, st.params.items.epicStartPrice));
      }
      // daily tasks: some children every morning
      if (hour === 10 && day >= 1 && day <= 33)
        for (const k of kids.filter(() => rng.next() < 0.15)) {
          const child = (await t.db.select().from(children).where(eq(children.id, k)))[0]!;
          const up = await s.daily.requestUpload(child, { kind: "image", contentType: "image/jpeg", size: 3 });
          await s.storage.put((await t.db.query.files.findFirst({ where: (f, { eq: e }) => e(f.id, up.fileId) }))!.storageKey, Buffer.from("jpg"), "image/jpeg");
          await s.daily.completeUpload(child, up.fileId);
          if (await quiet(() => s.daily.submit(child, { templateId: 1, evidenceFileIds: [up.fileId], explain: { kind: "text", text: TEXT }, aiNote: "问了 AI" }))) stats.daily++;
        }
      // one attack a day by a random team that can afford it
      if (hour === 12 && day >= 2 && day <= 25) {
        const id = rng.pick(teamIds);
        const c = await leaderCtx(id);
        const targets = st.landOrder.filter((l) => st.lands[l]!.owner && st.lands[l]!.owner !== id && !Object.values(st.contests).some((x) => x.landId === l && x.status === "active"));
        if (c && targets.length) {
          const land = rng.pick(targets);
          if (quoteAttack(st, id, st.lands[land]!.owner!, at).cost <= spendableGrain(st, id) && (await quiet(() => s.play.startContest(c, land)))) stats.attacks++;
        }
      }
      // every leader hands in whatever work is open and not yet handed in (debate: opening, then rebuttal)
      if (hour === 14 || hour === 20)
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          if (!c) continue;
          for (const slot of (await s.works.slots(c)).slots.filter((x) => x.open && !x.submitted)) {
            if (slot.kind === "contest" && st.contests[slot.slot.split(":")[1]!]?.defender === id && rng.next() < 0.3) continue; // some defenders do not answer
            if (await quiet(() => s.works.submit(c, slot.slot, { mediaKind: "text", text: `${slot.slot} 的作品`, fileIds: [], members: [c.childId] }))) stats.works++;
          }
        }
      // gift-week cards (Thursday evening), supply tasks (members and summary)
      if (hour === 20 && st.params.war.giftWeeks.some((w) => st.wars[w] && !st.wars[w]!.settled))
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          for (const w of st.params.war.giftWeeks) {
            if (!c || !st.wars[w]) continue;
            const v = await s.warWords.view(c, w).catch(() => null);
            if (v && !v.chosen && v.offered[0]) await quiet(() => s.warWords.choose(c, w, v.offered[0]!.id));
          }
        }
      if (hour === 10 || hour === 16) {
        for (const k of kids.filter(() => rng.next() < 0.3)) {
          const c = await ctxOf(k).catch(() => null);
          if (!c) continue;
          for (const task of (await s.supply.list(c)).tasks.filter((x) => x.open && !x.mine))
            if (await quiet(() => s.supply.submitEntry(c, task.supplyId, { text: "我的那一份", fileIds: [] }))) stats.supply++;
        }
        for (const id of teamIds) {
          const c = await leaderCtx(id);
          if (!c) continue;
          for (const task of (await s.supply.list(c)).tasks.filter((x) => x.open && !x.summary)) await quiet(() => s.supply.submitSummary(c, task.supplyId, { text: "小组总结", fileIds: [] }));
        }
      }
      // big battle line-ups (D29 evening)
      if (day === 29 && hour === 18 && st.bigBattle)
        for (const camp of ["a", "b"] as const) {
          const teams = st.bigBattle.camps[camp];
          const c = await leaderCtx(teams[0]!);
          if (c) await quiet(() => s.play.submitLines(c, rng.shuffle(teams)));
        }
    }

    // everything settled on AI scores at the time limits; the admin confirms the final settlement
    let st = await s.store.state(serverId);
    expect(st.bigBattle?.settled).toBe(true);
    // the big battle page: each line's task, the rules, the results
    const anyLeader = (await leaderCtx(st.teamOrder[0]!))!;
    const bbv = await s.play.bigBattle(anyLeader);
    expect(bbv.formed && bbv.lineTasks.map((x) => x?.title)).toEqual(["战线1", "战线2", "战线3", "战线4"]);
    expect(bbv.formed && bbv.stakes).toContain("同分时双方各得一半");
    expect(bbv.formed && bbv.result?.lines.length).toBe(4);
    // the workshop task of a line work follows the team's line (and that prompt's rubric)
    const line = st.bigBattle!.final!.a.indexOf(st.bigBattle!.camps.a[0]!);
    const lineTask = await s.works.task(await leaderCtx(st.bigBattle!.camps.a[0]!).then((c) => c!), "line");
    expect(lineTask.task?.title).toBe(`战线${line + 1}`);
    expect(lineTask.rubric.id).toBe(line === 1 ? "D" : "C");
    // 终局结算预览: the same ranking and scholarship the confirmation then publishes
    const pv = await s.control.finalPreview(serverId, 10000);
    expect(pv.done).toBe(false);
    expect(pv.teams.reduce((a, x) => a + x.yuan, 0)).toBe(10000);
    expect(pv.teams.every((x) => Object.values(x.bySource).reduce((a, b) => a + b, 0) === x.points)).toBe(true);
    const fin = await s.control.finalize(serverId, 10000, ADMIN);
    expect(fin.final!.ranking.map((r) => [r.teamId, r.points])).toEqual(pv.teams.map((x) => [x.teamId, x.points]));
    expect(fin.final!.scholarship.map((r) => r.yuan)).toEqual(pv.teams.map((x) => x.yuan));
    expect((await s.control.finalPreview(serverId, 0)).done).toBe(true);
    // the next publication time after the season ended still puts the final settlement into a report
    t.clock.set(+bj("2027-03-15", 20));
    await worker.tick();
    const after = (await t.db.select().from(reports).where(eq(reports.serverId, serverId)).orderBy(asc(reports.publishAt))).filter((r) => +r.publishAt > +end);
    expect(after.length).toBeGreaterThan(0);
    const reader = await ctxOf(kids[0]!);
    expect((await s.reports.get(reader, after[0]!.id)).lines.some((l: { text: string }) => l.text.startsWith("终局结算公布了：第 1 名"))).toBe(true);
    expect(fin.seasonEnded).toBe(true);
    st = await s.store.state(serverId);
    expect((await t.db.select().from(seasons).where(eq(seasons.id, season.id)))[0]!.status).toBe("ended");
    expect(st.final!.scholarship.reduce((a, b) => a + b.yuan, 0)).toBe(10000);

    // the invariants (part 9 §2)
    expect(checkLedger(st.ledger)).toEqual([]);
    for (const id of st.teamOrder) expect(grainOf(st, id)).toBeGreaterThanOrEqual(0);
    // the database ledgers (what exports and the admin console read) add up to the engine's balances
    const sum = (rows: { teamId: string; amount: number }[], id: string) => rows.filter((r) => r.teamId === id).reduce((a, r) => a + r.amount, 0);
    const gRows = await t.db.select().from(grainLedger).where(eq(grainLedger.serverId, serverId));
    const pRows = await t.db.select().from(pointsLedger).where(eq(pointsLedger.serverId, serverId));
    expect(gRows.length + pRows.length).toBe(st.ledger.length);
    for (const id of st.teamOrder) {
      expect(sum(gRows, id)).toBe(grainOf(st, id));
      expect(sum(pRows, id)).toBe(pointsOf(st, id));
    }
    expect(Object.values(st.contests).every((c) => c.status !== "active")).toBe(true);
    expect(Object.values(st.wars).every((w) => w.settled)).toBe(true);
    expect(st.settledDays.length).toBe(st.params.time.seasonDays);
    expect(st.done.filter((d) => d.startsWith("supply:")).length).toBe(8);
    // the database alone rebuilds the same state
    s.store.evict(serverId);
    const rebuilt = await s.store.state(serverId);
    expect(rebuilt).toEqual(st);
    // three reports a day
    const reps = await t.db.select().from(reports).where(eq(reports.serverId, serverId));
    expect(reps.length).toBeGreaterThanOrEqual(3 * 34);
    expect(stats.attacks).toBeGreaterThan(10);
    expect(stats.daily).toBeGreaterThan(50);
    expect(stats.works).toBeGreaterThan(20);
    expect(stats.supply).toBeGreaterThan(20);
    // 赛季回顾: generated, previewed, released
    expect((await s.summaries.generateSeasonReviews(season.id)).generated).toBe(32);
    const preview = (await s.summaries.previewSeasonReviews(season.id)).reviews;
    expect(preview.every((r) => r.releasedAt === null)).toBe(true);
    expect((await s.summaries.seasonReviewsOf(kids[0]!)).reviews).toEqual([]);
    expect((await s.summaries.releaseSeasonReviews(season.id)).released).toBe(32);
    const mine = (await s.summaries.seasonReviewsOf(kids[0]!)).reviews[0]!.content as { rank: number; numbers: { works: number } };
    expect(mine.rank).toBeGreaterThan(0);
    // 我参与的作品 (once per work, with its task and how it turned out) and the team's highlights
    type Rv = { highlights: string[]; works: { slot: string; title: string | null; result: string | null }[]; numbers: { works: number } };
    const all = await Promise.all(kids.map(async (k) => (await s.summaries.seasonReviewsOf(k)).reviews[0]!.content as Rv));
    const ws = all.flatMap((r) => r.works);
    expect(ws.length).toBeGreaterThan(0);
    expect(all.every((r) => new Set(r.works.map((w) => w.slot.replace(/:open$/, ""))).size === r.works.length && r.numbers.works === r.works.length)).toBe(true);
    expect(ws.filter((w) => !w.slot.startsWith("contest:")).every((w) => w.title)).toBe(true); // (this test's contest prompts are bare ids)
    expect(ws.filter((w) => w.result).length).toBeGreaterThan(ws.length / 2);
    expect(all.some((r) => r.highlights.length > 0)).toBe(true);
    const total = st.teamOrder.reduce((n, id) => n + balanceOf(st.ledger, id, "points"), 0);
    expect(total).toBeGreaterThan(0);
    await t.close();
  }, 300_000);
});
