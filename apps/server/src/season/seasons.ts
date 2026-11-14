/**
 * Season setup (PRD part 3 §2, §4; part 7 §2–§3): create a season (draft),
 * open enrollment, enable children who paid outside the app, generate the
 * grouping, adjust it, and confirm it. Confirming creates the servers, teams,
 * lands, the engine state with the opening grain, and the planned events; the
 * worker runs the season from then on.
 *
 * Every change is written to the operation log (part 4 §10).
 */

import { randomInt } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { children, dailySubmissions, families, gradeChanges, knowledgeCards, opLog, paramVersions, seasonPlayers, seasons, servers, surveyAnswers, teamMembers, teams, type Db } from "@zhiyouji/db";
import { DEFAULT_PARAMS, createRng, dayOfWeek, groupPlayers, type Player, type SeasonParams } from "@zhiyouji/engine";
import { GRADE_LABELS, SERVER_NAMES, TEAM_NAME_POOL, maskPhone, type SeasonCreate, type SeasonStatus } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import { fail } from "../http/errors.js";
import type { SeasonStore } from "../seasonStore.js";
import type { Notifier } from "../notify/notifier.js";
import type { QuestionBank } from "../content/questionBank.js";
import type { Survey } from "../accounts/survey.js";

export type SeasonRow = typeof seasons.$inferSelect;

export interface GroupingDraft {
  generatedAt: string;
  generatedBy: string;
  servers: { name: string; teams: { name: string; childIds: string[] }[] }[];
}

export interface GroupingView {
  locked: boolean;
  generatedAt: string;
  servers: {
    name: string;
    teams: {
      name: string;
      size: number;
      averageGrade: number;
      members: { childId: string; nickname: string; grade: number; gradeLabel: string; familyId: string }[];
    }[];
  }[];
  /** Children of one family placed in the same team (should be empty, part 3 §4). */
  siblingConflicts: { server: number; team: number; childIds: string[] }[];
}

/** States in which the season's setup can still be edited. */
const ENROLL_STATES: readonly SeasonStatus[] = ["enrolling"];
const GROUPING_STATES: readonly SeasonStatus[] = ["enrolling", "grouped"];

export class SeasonAdmin {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly notifier?: Notifier,
    private readonly bank?: QuestionBank,
    private readonly survey?: Survey,
  ) {}

  private async log(actor: string, action: string, object: string, before: unknown, after: unknown, reason?: string): Promise<void> {
    await this.db.insert(opLog).values({ actor, action, object, before: before ?? null, after: after ?? null, reason: reason ?? null, at: this.clock.now() });
  }

  // ---- seasons ---------------------------------------------------------------------

  async create(i: SeasonCreate, by: string): Promise<SeasonRow> {
    if (dayOfWeek(i.opening) !== 0) fail(400, "not_sunday");
    let params: SeasonParams = DEFAULT_PARAMS;
    if (i.copyParamsFrom) params = (await this.params(i.copyParamsFrom)).params;
    const seed = i.seed ?? randomInt(1, 2_147_483_646);
    return this.db.transaction(async (tx) => {
      const [season] = await tx.insert(seasons).values({ name: i.name, openingDate: i.opening, seed, status: "draft" }).returning();
      await tx.insert(paramVersions).values({
        seasonId: season!.id,
        version: 1,
        params,
        createdBy: by,
        note: i.copyParamsFrom ? `从赛季 ${i.copyParamsFrom} 复制` : "初始参数",
      });
      await tx.insert(opLog).values({ actor: by, action: "season_create", object: `season:${season!.id}`, after: { name: i.name, opening: i.opening }, at: this.clock.now() });
      return season!;
    });
  }

  async list(): Promise<SeasonRow[]> {
    return this.db.select().from(seasons).orderBy(desc(seasons.createdAt));
  }

  async season(id: string): Promise<SeasonRow> {
    const [s] = await this.db.select().from(seasons).where(eq(seasons.id, id));
    if (!s) fail(404, "season_not_found");
    return s!;
  }

  /** Current parameters of a season (latest version). */
  async params(seasonId: string): Promise<{ version: number; params: SeasonParams }> {
    const [row] = await this.db
      .select()
      .from(paramVersions)
      .where(eq(paramVersions.seasonId, seasonId))
      .orderBy(desc(paramVersions.version))
      .limit(1);
    if (!row) fail(404, "season_not_found");
    return { version: row!.version, params: row!.params as SeasonParams };
  }

  async servers(seasonId: string) {
    return this.db.select().from(servers).where(eq(servers.seasonId, seasonId)).orderBy(asc(servers.name));
  }

  async update(id: string, patch: { name?: string; opening?: string }, by: string): Promise<SeasonRow> {
    const s = await this.season(id);
    if (patch.opening !== undefined) {
      if (s.groupingLockedAt) fail(409, "grouping_locked");
      if (dayOfWeek(patch.opening) !== 0) fail(400, "not_sunday");
    }
    const set = { ...(patch.name ? { name: patch.name } : {}), ...(patch.opening ? { openingDate: patch.opening } : {}) };
    if (Object.keys(set).length === 0) return s;
    const [row] = await this.db.update(seasons).set(set).where(eq(seasons.id, id)).returning();
    await this.log(by, "season_update", `season:${id}`, { name: s.name, opening: s.openingDate }, patch);
    return row!;
  }

  private async setStatus(s: SeasonRow, from: readonly SeasonStatus[], to: SeasonStatus, by: string): Promise<SeasonRow> {
    if (!from.includes(s.status as SeasonStatus)) fail(409, "wrong_season_status", { status: s.status });
    const [row] = await this.db.update(seasons).set({ status: to }).where(eq(seasons.id, s.id)).returning();
    await this.log(by, "season_status", `season:${s.id}`, { status: s.status }, { status: to });
    return row!;
  }

  /** 草稿 → 报名中 (part 3 §2). */
  async openEnrollment(id: string, by: string): Promise<SeasonRow> {
    return this.setStatus(await this.season(id), ["draft"], "enrolling", by);
  }

  /** 已分组 (not yet confirmed) → back to 报名中 to enable more children; the draft grouping is dropped. */
  async reopenEnrollment(id: string, by: string): Promise<SeasonRow> {
    const s = await this.season(id);
    if (s.groupingLockedAt) fail(409, "grouping_locked");
    const row = await this.setStatus(s, ["grouped"], "enrolling", by);
    await this.db.update(seasons).set({ grouping: null }).where(eq(seasons.id, id));
    return { ...row, grouping: null };
  }

  // ---- children and enrollment (part 7 §3) --------------------------------------------

  /** 孩子查找: by parent phone (full or part) or nickname. */
  async searchChildren(q: string) {
    const digits = /^\d{3,11}$/.test(q);
    const rows = await this.db
      .select({ child: children, phone: families.phone })
      .from(children)
      .innerJoin(families, eq(children.familyId, families.id))
      .where(and(eq(children.status, "active"), digits ? ilike(families.phone, `%${q}%`) : ilike(children.nickname, `%${q}%`)))
      .orderBy(asc(children.createdAt))
      .limit(50);
    return rows.map((r) => ({
      childId: r.child.id,
      familyId: r.child.familyId,
      nickname: r.child.nickname,
      grade: r.child.grade,
      gradeLabel: GRADE_LABELS[r.child.grade] ?? String(r.child.grade),
      phone: r.phone,
      phoneMasked: maskPhone(r.phone),
      createdAt: r.child.createdAt.toISOString(),
    }));
  }

  /**
   * 孩子档案 (part 7 §3 孩子查找 "查看年级、注册时间、问卷、修行日志概况"): one
   * child for the admin — the family's other children, the grade history, the
   * seasons, the latest survey, and the journal in numbers with the latest cards.
   */
  async childProfile(childId: string) {
    const [row] = await this.db.select({ child: children, phone: families.phone }).from(children).innerJoin(families, eq(children.familyId, families.id)).where(eq(children.id, childId));
    if (!row || row.child.status !== "active") fail(404, "child_not_found");
    const c = row!.child;
    const siblings = await this.db.select({ id: children.id, nickname: children.nickname, grade: children.grade }).from(children).where(and(eq(children.familyId, c.familyId), eq(children.status, "active")));
    const grades = await this.db.select().from(gradeChanges).where(eq(gradeChanges.childId, childId)).orderBy(asc(gradeChanges.at));
    const played = await this.db
      .select({ seasonId: seasonPlayers.seasonId, name: seasons.name, status: seasonPlayers.status, paymentNote: seasonPlayers.paymentNote, enabledAt: seasonPlayers.enabledAt })
      .from(seasonPlayers)
      .innerJoin(seasons, eq(seasonPlayers.seasonId, seasons.id))
      .where(eq(seasonPlayers.childId, childId))
      .orderBy(asc(seasonPlayers.enabledAt));
    const teamRows = await this.db
      .select({ teamId: teams.id, team: teams.name, serverId: teams.serverId, server: servers.name, seasonId: servers.seasonId, active: teamMembers.active })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(servers, eq(teams.serverId, servers.id))
      .where(eq(teamMembers.childId, childId));
    const [survey] = await this.db.select().from(surveyAnswers).where(eq(surveyAnswers.childId, childId)).orderBy(desc(surveyAnswers.completedAt)).limit(1);
    const daily = await this.db.select({ status: dailySubmissions.status, day: dailySubmissions.day }).from(dailySubmissions).where(eq(dailySubmissions.childId, childId));
    const cards = await this.db.select().from(knowledgeCards).where(and(eq(knowledgeCards.childId, childId), eq(knowledgeCards.visible, true))).orderBy(desc(knowledgeCards.createdAt));
    const bySubject = new Map<string, number>();
    for (const k of cards) {
      const subject = k.tag?.split("/")[0] ?? "未分类";
      bySubject.set(subject, (bySubject.get(subject) ?? 0) + 1);
    }
    const curiosity = survey ? Object.entries(survey.curiosity as Record<string, number>).sort((a, b) => b[1] - a[1]) : [];
    return {
      child: {
        childId: c.id,
        nickname: c.nickname,
        grade: c.grade,
        gradeLabel: GRADE_LABELS[c.grade] ?? String(c.grade),
        explainPref: c.explainPref,
        createdAt: c.createdAt.toISOString(),
        lastActiveAt: c.lastActiveAt?.toISOString() ?? null,
        phoneMasked: maskPhone(row!.phone),
      },
      siblings: siblings.filter((x) => x.id !== c.id).map((x) => ({ childId: x.id, nickname: x.nickname, gradeLabel: GRADE_LABELS[x.grade] ?? String(x.grade) })),
      grades: grades.map((g) => ({ from: g.fromGrade, to: g.toGrade, source: g.source, at: g.at.toISOString() })),
      seasons: played.map((p) => {
        const t = teamRows.find((x) => x.seasonId === p.seasonId);
        return { ...p, enabledAt: p.enabledAt.toISOString(), server: t?.server ?? null, team: t?.team ?? null, teamId: t?.teamId ?? null };
      }),
      survey: survey ? { style: survey.style, topCuriosity: curiosity.slice(0, 3).map(([subject, score]) => ({ subject, score })), completedAt: survey.completedAt.toISOString() } : null,
      journal: {
        daily: { total: daily.length, passed: daily.filter((d) => d.status === "passed").length, days: new Set(daily.filter((d) => d.status === "passed").map((d) => String(d.day))).size },
        cards: cards.length,
        bySubject: [...bySubject.entries()].sort((a, b) => b[1] - a[1]).map(([subject, n]) => ({ subject, cards: n })),
        latest: cards.slice(0, 5).map((k) => ({ title: k.title, tag: k.tag, day: String(k.day) })),
      },
    };
  }

  /**
   * 表格批量开通, step 1 (part 7 §3): each row of the table (parent phone, the
   * child's nickname when the family has more than one child, payment note) →
   * which child it is. Nothing is enabled here; the admin checks the list and
   * enables the matched ones with `enroll`.
   */
  async matchTable(seasonId: string, rows: { phone: string; nickname?: string; paymentNote?: string }[]) {
    await this.season(seasonId);
    const phones = [...new Set(rows.map((r) => r.phone))];
    const found = phones.length
      ? await this.db
          .select({ child: children, phone: families.phone })
          .from(children)
          .innerJoin(families, eq(children.familyId, families.id))
          .where(and(inArray(families.phone, phones), eq(children.status, "active")))
      : [];
    const enrolled = new Set(
      found.length
        ? (
            await this.db
              .select({ c: seasonPlayers.childId })
              .from(seasonPlayers)
              .where(and(eq(seasonPlayers.seasonId, seasonId), eq(seasonPlayers.status, "enrolled"), inArray(seasonPlayers.childId, found.map((f) => f.child.id))))
          ).map((r) => r.c)
        : [],
    );
    return {
      rows: rows.map((r, i) => {
        const kids = found.filter((f) => f.phone === r.phone);
        const named = r.nickname ? kids.filter((k) => k.child.nickname === r.nickname) : kids;
        const base = { line: i + 1, phoneMasked: maskPhone(r.phone), nickname: r.nickname ?? null, paymentNote: r.paymentNote ?? null };
        if (kids.length === 0) return { ...base, status: "no_family" as const, candidates: [] };
        if (named.length !== 1)
          return { ...base, status: named.length === 0 ? ("no_child" as const) : ("ambiguous" as const), candidates: kids.map((k) => ({ childId: k.child.id, nickname: k.child.nickname, grade: k.child.grade })) };
        const c = named[0]!.child;
        return { ...base, status: enrolled.has(c.id) ? ("already" as const) : ("ok" as const), childId: c.id, childNickname: c.nickname, grade: c.grade, gradeLabel: GRADE_LABELS[c.grade] ?? String(c.grade), candidates: [] };
      }),
    };
  }

  /** 开通赛季资格 (one or a batch). Re-enabling a revoked child works; enabled children are reported, not duplicated. */
  async enroll(seasonId: string, players: { childId: string; paymentNote?: string }[], by: string) {
    const s = await this.season(seasonId);
    if (!ENROLL_STATES.includes(s.status as SeasonStatus)) fail(409, "wrong_season_status", { status: s.status });
    const ids = [...new Set(players.map((p) => p.childId))];
    const found = await this.db
      .select({ id: children.id })
      .from(children)
      .where(and(inArray(children.id, ids), eq(children.status, "active")));
    const ok = new Set(found.map((r) => r.id));
    const existing = await this.db
      .select()
      .from(seasonPlayers)
      .where(and(eq(seasonPlayers.seasonId, seasonId), inArray(seasonPlayers.childId, ids)));
    const byChild = new Map(existing.map((r) => [r.childId, r]));
    const out = { enrolled: [] as string[], already: [] as string[], notFound: [] as string[] };
    const now = this.clock.now();
    for (const p of players) {
      if (!ok.has(p.childId)) {
        out.notFound.push(p.childId);
        continue;
      }
      const row = byChild.get(p.childId);
      if (row?.status === "enrolled") {
        out.already.push(p.childId);
        continue;
      }
      if (row) {
        await this.db
          .update(seasonPlayers)
          .set({ status: "enrolled", enabledBy: by, enabledAt: now, paymentNote: p.paymentNote ?? row.paymentNote, revokedAt: null, revokedBy: null })
          .where(eq(seasonPlayers.id, row.id));
      } else {
        await this.db.insert(seasonPlayers).values({ seasonId, childId: p.childId, enabledBy: by, enabledAt: now, paymentNote: p.paymentNote ?? null });
      }
      byChild.set(p.childId, { ...(row ?? ({} as typeof existing[number])), status: "enrolled" });
      out.enrolled.push(p.childId);
      await this.notifier?.notify({
        kind: "season_enabled",
        childIds: [p.childId],
        title: "赛季资格开通了",
        body: `你已经是「${s.name}」的赛季玩家。开营日 ${+s.openingDate.slice(5, 7)}月${+s.openingDate.slice(8)}日晚上公布分组。`,
        link: "/season",
        dedupeKey: `season_enabled:${seasonId}`,
      });
      await this.log(by, "season_enroll", `season:${seasonId}/child:${p.childId}`, row ? { status: row.status } : null, { status: "enrolled", paymentNote: p.paymentNote ?? null });
    }
    return out;
  }

  /** 撤销开通 (before the grouping is confirmed; afterwards a child leaving is 退赛 in the season). */
  async revoke(seasonId: string, childId: string, reason: string, by: string): Promise<void> {
    const s = await this.season(seasonId);
    if (s.groupingLockedAt) fail(409, "grouping_locked");
    const [row] = await this.db
      .select()
      .from(seasonPlayers)
      .where(and(eq(seasonPlayers.seasonId, seasonId), eq(seasonPlayers.childId, childId), eq(seasonPlayers.status, "enrolled")));
    if (!row) fail(404, "not_enrolled");
    await this.db.update(seasonPlayers).set({ status: "revoked", revokedAt: this.clock.now(), revokedBy: by }).where(eq(seasonPlayers.id, row!.id));
    // A child taken out of an unconfirmed grouping leaves the draft too.
    const draft = s.grouping as GroupingDraft | null;
    if (draft) {
      for (const sv of draft.servers) for (const t of sv.teams) t.childIds = t.childIds.filter((c) => c !== childId);
      await this.db.update(seasons).set({ grouping: draft }).where(eq(seasons.id, seasonId));
    }
    await this.log(by, "season_revoke", `season:${seasonId}/child:${childId}`, { status: "enrolled" }, { status: "revoked" }, reason);
  }

  /** 报名名单: every enabled child, with the phone for reconciling payments, and the team once grouped. */
  async roster(seasonId: string) {
    await this.season(seasonId);
    const rows = await this.db
      .select({ p: seasonPlayers, child: children, phone: families.phone })
      .from(seasonPlayers)
      .innerJoin(children, eq(seasonPlayers.childId, children.id))
      .innerJoin(families, eq(children.familyId, families.id))
      .where(eq(seasonPlayers.seasonId, seasonId))
      .orderBy(asc(seasonPlayers.enabledAt));
    const placement = await this.placements(seasonId);
    return rows.map((r) => ({
      childId: r.child.id,
      familyId: r.child.familyId,
      nickname: r.child.nickname,
      grade: r.child.grade,
      gradeLabel: GRADE_LABELS[r.child.grade] ?? String(r.child.grade),
      phone: r.phone,
      status: r.p.status,
      paymentNote: r.p.paymentNote,
      enabledBy: r.p.enabledBy,
      enabledAt: r.p.enabledAt.toISOString(),
      revokedAt: r.p.revokedAt?.toISOString() ?? null,
      server: placement.get(r.child.id)?.server ?? null,
      team: placement.get(r.child.id)?.team ?? null,
      teamId: placement.get(r.child.id)?.teamId ?? null,
    }));
  }

  /** Where each child sits: from the confirmed teams, or else from the draft. */
  private async placements(seasonId: string): Promise<Map<string, { server: string; team: string; teamId: string | null }>> {
    const s = await this.season(seasonId);
    const out = new Map<string, { server: string; team: string; teamId: string | null }>();
    if (s.groupingLockedAt) {
      const rows = await this.db
        .select({ childId: teamMembers.childId, team: teams.name, teamId: teams.id, server: servers.name })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .innerJoin(servers, eq(teams.serverId, servers.id))
        .where(eq(servers.seasonId, seasonId));
      for (const r of rows) out.set(r.childId, { server: r.server, team: r.team, teamId: r.teamId });
    } else {
      const draft = s.grouping as GroupingDraft | null;
      for (const sv of draft?.servers ?? []) for (const t of sv.teams) for (const c of t.childIds) out.set(c, { server: sv.name, team: t.name, teamId: null });
    }
    return out;
  }

  // ---- grouping (part 3 §4, §20.1) -------------------------------------------------------

  private async enrolledPlayers(seasonId: string): Promise<(Player & { nickname: string })[]> {
    const rows = await this.db
      .select({ child: children })
      .from(seasonPlayers)
      .innerJoin(children, eq(seasonPlayers.childId, children.id))
      .where(and(eq(seasonPlayers.seasonId, seasonId), eq(seasonPlayers.status, "enrolled")));
    // Play style from the registration survey (content library 10.2 Q6); children who skipped it have none.
    const styles = this.survey ? await this.survey.styles(rows.map((r) => r.child.id)) : new Map<string, string>();
    return rows.map((r) => ({ childId: r.child.id, familyId: r.child.familyId, grade: r.child.grade, style: (styles.get(r.child.id) as Player["style"]) ?? null, nickname: r.child.nickname }));
  }

  /** 生成分组: snake by grade, varied play styles, siblings apart. Moves the season to 已分组 (not yet locked). */
  async generateGrouping(seasonId: string, by: string): Promise<GroupingView> {
    const s = await this.season(seasonId);
    if (s.groupingLockedAt) fail(409, "grouping_locked");
    if (!GROUPING_STATES.includes(s.status as SeasonStatus)) fail(409, "wrong_season_status", { status: s.status });
    const { params } = await this.params(seasonId);
    const players = await this.enrolledPlayers(seasonId);
    if (players.length < params.grouping.teamsPerServer) fail(409, "too_few_players", { need: params.grouping.teamsPerServer, have: players.length });
    // A fresh draw each time the admin presses the button, reproducible from the stored draft.
    const rng = createRng((s.seed + (await this.groupingCount(seasonId))) % 2_147_483_646 || 1);
    const result = groupPlayers(players, params, rng);
    let name = 0;
    const draft: GroupingDraft = {
      generatedAt: this.clock.now().toISOString(),
      generatedBy: by,
      servers: result.servers.map((sv, i) => ({
        name: SERVER_NAMES[i] ?? `${i + 1}服`,
        teams: sv.teams.map((t) => ({ name: TEAM_NAME_POOL[name++ % TEAM_NAME_POOL.length]!, childIds: t.map((p) => p.childId) })),
      })),
    };
    await this.db.update(seasons).set({ grouping: draft, status: "grouped" }).where(eq(seasons.id, seasonId));
    await this.log(by, "grouping_generate", `season:${seasonId}`, { status: s.status }, { status: "grouped", servers: draft.servers.length, players: players.length });
    return this.groupingView(seasonId);
  }

  private async groupingCount(seasonId: string): Promise<number> {
    const rows = await this.db
      .select({ id: opLog.id })
      .from(opLog)
      .where(and(eq(opLog.action, "grouping_generate"), eq(opLog.object, `season:${seasonId}`)));
    return rows.length;
  }

  private async draftOf(seasonId: string): Promise<{ s: SeasonRow; draft: GroupingDraft }> {
    const s = await this.season(seasonId);
    if (s.groupingLockedAt) fail(409, "grouping_locked");
    const draft = s.grouping as GroupingDraft | null;
    if (!draft || s.status !== "grouped") fail(409, "no_grouping");
    return { s, draft: draft! };
  }

  /** Drag a child to another team (before confirmation). */
  async movePlayer(seasonId: string, childId: string, server: number, team: number, by: string): Promise<GroupingView> {
    const { draft } = await this.draftOf(seasonId);
    const target = draft.servers[server]?.teams[team];
    if (!target) fail(400, "bad_position");
    let from: string | null = null;
    for (const sv of draft.servers)
      for (const t of sv.teams)
        if (t.childIds.includes(childId)) {
          from = `${sv.name}/${t.name}`;
          t.childIds = t.childIds.filter((c) => c !== childId);
        }
    if (!from) fail(404, "not_enrolled");
    target!.childIds.push(childId);
    await this.db.update(seasons).set({ grouping: draft }).where(eq(seasons.id, seasonId));
    await this.log(by, "grouping_move", `season:${seasonId}/child:${childId}`, { at: from }, { at: `${draft.servers[server]!.name}/${target!.name}` });
    return this.groupingView(seasonId);
  }

  /** Rename a team (before confirmation; the name is part of the engine state afterwards). */
  async renameTeam(seasonId: string, server: number, team: number, name: string, by: string): Promise<GroupingView> {
    const { draft } = await this.draftOf(seasonId);
    const t = draft.servers[server]?.teams[team];
    if (!t) fail(400, "bad_position");
    const before = t!.name;
    t!.name = name;
    await this.db.update(seasons).set({ grouping: draft }).where(eq(seasons.id, seasonId));
    await this.log(by, "team_rename", `season:${seasonId}/${draft.servers[server]!.name}`, { name: before }, { name });
    return this.groupingView(seasonId);
  }

  async groupingView(seasonId: string): Promise<GroupingView> {
    const s = await this.season(seasonId);
    let draft = s.grouping as GroupingDraft | null;
    if (!draft) fail(409, "no_grouping");
    const ids = draft!.servers.flatMap((sv) => sv.teams.flatMap((t) => t.childIds));
    const kids = ids.length ? await this.db.select().from(children).where(inArray(children.id, ids)) : [];
    const byId = new Map(kids.map((k) => [k.id, k]));
    const conflicts: GroupingView["siblingConflicts"] = [];
    const view: GroupingView = {
      locked: !!s.groupingLockedAt,
      generatedAt: draft!.generatedAt,
      servers: draft!.servers.map((sv, si) => ({
        name: sv.name,
        teams: sv.teams.map((t, ti) => {
          const members = t.childIds
            .map((c) => byId.get(c))
            .filter((k): k is NonNullable<typeof k> => !!k)
            .map((k) => ({ childId: k.id, nickname: k.nickname, grade: k.grade, gradeLabel: GRADE_LABELS[k.grade] ?? String(k.grade), familyId: k.familyId }));
          const fam = new Map<string, string[]>();
          for (const m of members) fam.set(m.familyId, [...(fam.get(m.familyId) ?? []), m.childId]);
          for (const sibs of fam.values()) if (sibs.length > 1) conflicts.push({ server: si, team: ti, childIds: sibs });
          const avg = members.length ? members.reduce((a, m) => a + m.grade, 0) / members.length : 0;
          return { name: t.name, size: members.length, averageGrade: Math.round(avg * 10) / 10, members };
        }),
      })),
      siblingConflicts: conflicts,
    };
    return view;
  }

  /**
   * 确认分组 (lock): creates the servers, teams, lands, the engine state (opening
   * grain) and the planned events, all in one transaction.
   */
  async confirmGrouping(
    seasonId: string,
    i: { landNames?: Record<string, string>; prompts?: Record<string, string[]> },
    by: string,
  ): Promise<{ servers: { serverId: string; name: string; teamIds: string[] }[] }> {
    const { s, draft } = await this.draftOf(seasonId);
    if (draft.servers.some((sv) => sv.teams.some((t) => t.childIds.length === 0))) fail(409, "team_empty");
    const { version, params } = await this.params(seasonId);
    const calendar = await this.store.calendar();
    const ids = draft.servers.flatMap((sv) => sv.teams.flatMap((t) => t.childIds));
    const kids = await this.db.select().from(children).where(inArray(children.id, ids));
    const grade = new Map(kids.map((k) => [k.id, k.grade]));
    const now = this.clock.now();
    // Lands come from the question bank's templates unless the admin passes names / prompts by hand.
    const teamsPerServer = draft.servers[0]?.teams.length ?? params.grouping.teamsPerServer;
    const bankMap = this.bank ? await this.bank.defaultMapping(teamsPerServer, teamsPerServer / 2) : null;
    const hasBank = !!bankMap && Object.keys(bankMap.landNames).length > 0;
    const prompts = i.prompts ?? ((s.prompts as Record<string, string[]> | null) ?? (hasBank ? bankMap!.prompts : undefined));
    const landNames = i.landNames ?? (hasBank ? bankMap!.landNames : undefined);
    const out = await this.db.transaction(async (tx) => {
      const made: { serverId: string; name: string; teamIds: string[] }[] = [];
      for (const [k, sv] of draft.servers.entries()) {
        const r = await this.store.createServerIn(tx as unknown as Db, {
          seasonId,
          name: sv.name,
          opening: s.openingDate,
          // Each server draws its own random numbers.
          seed: ((s.seed + k * 7919) % 2_147_483_646) || 1,
          params,
          paramVersion: version,
          calendar,
          teams: sv.teams.map((t) => ({ name: t.name, members: t.childIds.map((c) => ({ childId: c, grade: grade.get(c) ?? 1 })) })),
          landNames,
          landTemplates: hasBank ? bankMap!.landTemplates : undefined,
          prompts,
          createdBy: by,
          at: now,
        });
        made.push({ ...r, name: sv.name });
      }
      await tx.update(seasons).set({ groupingLockedAt: now, prompts: prompts ?? null }).where(eq(seasons.id, seasonId));
      await tx.insert(opLog).values({
        actor: by,
        action: "grouping_confirm",
        object: `season:${seasonId}`,
        after: { servers: made.map((m) => ({ id: m.serverId, name: m.name, teams: m.teamIds.length })) },
        at: now,
      });
      return made;
    });
    return { servers: out };
  }

  /** Season of a confirmed server (for the routes). */
  async seasonOfServer(serverId: string): Promise<SeasonRow> {
    const [row] = await this.db.select({ s: seasons }).from(servers).innerJoin(seasons, eq(servers.seasonId, seasons.id)).where(eq(servers.id, serverId));
    if (!row) fail(404, "not_found");
    return row!.s;
  }

  /** Children enrolled in live seasons (helper for the student side). */
  async childSeasons(childId: string) {
    return this.db
      .select({ season: seasons, player: seasonPlayers })
      .from(seasonPlayers)
      .innerJoin(seasons, eq(seasonPlayers.seasonId, seasons.id))
      .where(and(eq(seasonPlayers.childId, childId), or(eq(seasonPlayers.status, "enrolled"), eq(seasonPlayers.status, "withdrawn"))));
  }
}
