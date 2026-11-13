/**
 * 异步辩论 on the debate lands (朱紫国、车迟国; PRD part 3 §10.4; content
 * library 4.2):
 * - within 12 hours of the attack the defender picks pro or con (else the
 *   system picks at random); every attacker takes the other side;
 * - 立论 (opening) is due day 2 21:00 — work slot `contest:<id>:open`;
 * - then each side gets the other side's openings, and the 驳论 (rebuttal) is
 *   due day 3 21:00 — the contest's normal slot `contest:<id>`;
 * - if the defender handed in no opening, the attackers instead list the 2
 *   arguments the other side would most likely make and rebut them;
 * - both stages are scored together (rubric B): the reviewer sees the opening
 *   next to the rebuttal.
 */

import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { debates, files, lands, landTemplates, works, type Db } from "@zhiyouji/db";
import { contestTimes, createRng, seedFromString, type SeasonState } from "@zhiyouji/engine";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { Notifier } from "../notify/notifier.js";
import type { SeasonStore } from "../seasonStore.js";
import type { ObjectStorage } from "../storage.js";
import { refuse, type PlayCtx } from "./play.js";

export const DEBATE_LANDS = ["朱紫国", "车迟国"];
export type Side = "pro" | "con";
const SIDE_TEXT: Record<Side, string> = { pro: "正方", con: "反方" };

export class Debates {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier: Notifier,
    private readonly storage: ObjectStorage,
  ) {}

  /** Opening deadlines of the server's debates (for the work slots). */
  async openingDeadlines(serverId: string): Promise<Map<string, { openingDeadline: number }>> {
    const rows = await this.db.select().from(debates).where(eq(debates.serverId, serverId));
    return new Map(rows.map((r) => [r.contestId, { openingDeadline: +r.openingDeadline }]));
  }

  private async isDebateLand(serverId: string, landId: string): Promise<boolean> {
    const [l] = await this.db.select().from(lands).where(and(eq(lands.serverId, serverId), eq(lands.code, landId)));
    if (!l) return false;
    if (DEBATE_LANDS.includes(l.name)) return true;
    if (!l.templateId) return false;
    const [t] = await this.db.select().from(landTemplates).where(eq(landTemplates.id, l.templateId));
    return !!t?.questionType.includes("辩论");
  }

  /** Called for every contest_started notice. */
  async onContestStarted(serverId: string, st: SeasonState, contestId: string): Promise<void> {
    const c = st.contests[contestId];
    if (!c || !(await this.isDebateLand(serverId, c.landId))) return;
    const t = contestTimes(c.startedAt, st.params);
    await this.db
      .insert(debates)
      .values({ serverId, contestId, sideDeadline: new Date(t.debateSideDeadline), openingDeadline: new Date(t.debateOpeningDeadline) })
      .onConflictDoNothing();
  }

  private async row(serverId: string, contestId: string) {
    const [d] = await this.db.select().from(debates).where(and(eq(debates.serverId, serverId), eq(debates.contestId, contestId)));
    return d ?? null;
  }

  async chooseSide(ctx: PlayCtx, contestId: string, side: Side) {
    const st = await this.store.state(ctx.serverId);
    const c = st.contests[contestId];
    if (!c) refuse("unknown_contest");
    const d = await this.row(ctx.serverId, contestId);
    if (!d) fail(404, "not_debate");
    if (c!.defender !== ctx.teamId) refuse("not_defender");
    const t = st.teams[ctx.teamId]!;
    if (t.leader !== ctx.childId && t.deputy !== ctx.childId) refuse("not_leader");
    if (d!.defenderSide) fail(409, "side_chosen");
    if (+this.clock.now() >= +d!.sideDeadline) refuse("too_late");
    await this.db.update(debates).set({ defenderSide: side, sideBy: "defender", sideAt: this.clock.now() }).where(eq(debates.id, d!.id));
    await this.tellSides(ctx.serverId, st, contestId, side);
    return this.view(ctx, contestId);
  }

  private async tellSides(serverId: string, st: SeasonState, contestId: string, side: Side) {
    const c = st.contests[contestId]!;
    const members = (teamId: string) => st.teams[teamId]?.members.filter((m) => m.active).map((m) => m.childId) ?? [];
    const other: Side = side === "pro" ? "con" : "pro";
    await this.notifier.notify({ kind: "system", childIds: members(c.defender), serverId, title: "辩论持方定了", body: `你们是${SIDE_TEXT[side]}。`, link: `/season/contests/${contestId}`, dedupeKey: `debate_side:${serverId}:${contestId}` });
    await this.notifier.notify({
      kind: "system",
      childIds: c.attackers.flatMap((a) => members(a.teamId)),
      serverId,
      title: "辩论持方定了",
      body: `你们是${SIDE_TEXT[other]}。`,
      link: `/season/contests/${contestId}`,
      dedupeKey: `debate_side:${serverId}:${contestId}`,
    });
  }

  /** Worker: random sides after 12 hours; openings shared after the opening deadline. */
  async runDue(serverId: string): Promise<number> {
    const now = this.clock.now();
    const st = await this.store.state(serverId);
    let n = 0;
    const late = await this.db
      .select()
      .from(debates)
      .where(and(eq(debates.serverId, serverId), isNull(debates.defenderSide), lte(debates.sideDeadline, now)));
    for (const d of late) {
      if (st.contests[d.contestId]?.status !== "active") continue;
      const side = createRng(seedFromString(`${st.seed}|debate|${d.contestId}`)).pick<Side>(["pro", "con"]);
      await this.db.update(debates).set({ defenderSide: side, sideBy: "system", sideAt: now }).where(eq(debates.id, d.id));
      await this.tellSides(serverId, st, d.contestId, side);
      n++;
    }
    const due = await this.db
      .select()
      .from(debates)
      .where(and(eq(debates.serverId, serverId), isNull(debates.openingsSharedAt), lte(debates.openingDeadline, now)));
    for (const d of due) {
      const c = st.contests[d.contestId];
      if (!c) continue;
      const opened = await this.db
        .select({ teamId: works.teamId })
        .from(works)
        .where(and(eq(works.serverId, serverId), eq(works.slot, `contest:${d.contestId}:open`)));
      const noDefender = !opened.some((o) => o.teamId === c.defender);
      await this.db.update(debates).set({ openingsSharedAt: now, noDefender }).where(eq(debates.id, d.id));
      const kids = [c.defender, ...c.attackers.map((a) => a.teamId)].flatMap((t) => st.teams[t]?.members.filter((m) => m.active).map((m) => m.childId) ?? []);
      await this.notifier.notify({
        kind: "system",
        childIds: kids,
        serverId,
        title: "驳论开始了",
        body: noDefender
          ? "守方没有交立论。请列出对方最可能说的 2 个论点，并逐个反驳。"
          : "对方的立论已经发给你们了。驳论必须点名回应对方至少 2 个论点。",
        link: `/season/contests/${d.contestId}`,
        dedupeKey: `debate_open:${serverId}:${d.contestId}`,
      });
      n++;
    }
    return n;
  }

  /** The team's side, the stage, and (after the opening deadline) the other side's openings. */
  async view(ctx: PlayCtx, contestId: string) {
    const st = await this.store.state(ctx.serverId);
    const c = st.contests[contestId];
    if (!c) refuse("unknown_contest");
    const d = await this.row(ctx.serverId, contestId);
    if (!d) return { debate: false as const };
    const now = +this.clock.now();
    const mineIsDefender = c!.defender === ctx.teamId;
    const involved = mineIsDefender || c!.attackers.some((a) => a.teamId === ctx.teamId);
    const mySide: Side | null = d.defenderSide ? (mineIsDefender ? (d.defenderSide as Side) : d.defenderSide === "pro" ? "con" : "pro") : null;
    let openings: { teamId: string; team: string; text: string | null; files: { id: string; kind: string; url: string }[] }[] = [];
    if (involved && d.openingsSharedAt) {
      const others = mineIsDefender ? c!.attackers.map((a) => a.teamId) : [c!.defender];
      const rows = await this.db
        .select()
        .from(works)
        .where(and(eq(works.serverId, ctx.serverId), eq(works.slot, `contest:${contestId}:open`), inArray(works.teamId, others)));
      const last = new Map<string, (typeof rows)[number]>();
      for (const r of rows.sort((a, b) => a.version - b.version)) last.set(r.teamId, r);
      openings = await Promise.all(
        [...last.values()].map(async (w) => {
          const ids = (w.fileIds as string[]) ?? [];
          const fs = ids.length ? await this.db.select().from(files).where(inArray(files.id, ids)) : [];
          return {
            teamId: w.teamId,
            team: st.teams[w.teamId]?.name ?? "",
            text: w.text,
            files: await Promise.all(fs.map(async (f) => ({ id: f.id, kind: f.kind, url: await this.storage.downloadUrl(f.storageKey, now) }))),
          };
        }),
      );
    }
    return {
      debate: true as const,
      mySide,
      sideBy: d.sideBy,
      sideDeadline: d.sideDeadline.toISOString(),
      openingDeadline: d.openingDeadline.toISOString(),
      deadline: new Date(c!.deadline).toISOString(),
      stage: now < +d.openingDeadline ? ("opening" as const) : now < c!.deadline ? ("rebuttal" as const) : ("closed" as const),
      noDefender: d.noDefender,
      openings,
    };
  }
}
