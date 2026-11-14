/**
 * 开营前检查清单 (PRD part 9 §3 condition 5; content library "D1 之前"): one
 * page of checks before a season opens — parameters, the calendar's school
 * and rest days, the prize pool, the grouping, reviewer accounts — plus what
 * the other parts need on day 1: the question bank (every land can draw two
 * prompts), the WeChat group QR codes and the AI models (still the fakes?).
 *
 * Read-only. `fail` = the season should not open like this; `warn` = look
 * at it; `info` = nothing the system can check, a reminder.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { addDays, DEFAULT_PARAMS } from "@zhiyouji/engine";
import { adminUsers, calendarDays, landTemplates, paramVersions, prompts, reviewerLeaves, servers, teamMembers, teams, type Db } from "@zhiyouji/db";
import type { AiGateway } from "../aiGateway.js";
import type { Clock } from "../clock.js";
import { QuestionBank } from "../content/questionBank.js";
import type { SeasonStore } from "../seasonStore.js";
import type { SeasonAdmin } from "./seasons.js";

export type CheckStatus = "ok" | "warn" | "fail" | "info";
export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/** Days the calendar must cover: D0 … D40 (the admin calendar shows 41 days). */
const CALENDAR_DAYS = 41;

/** Paths whose value differs between two params objects ("items.zijin.pts"). */
export function changedPaths(a: unknown, b: unknown, at = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k));
  }
  return [at || "(全部)"];
}

export class Preflight {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly store: SeasonStore,
    private readonly seasons: SeasonAdmin,
    private readonly gateway: AiGateway,
  ) {}

  async check(seasonId: string): Promise<{ seasonId: string; ready: boolean; checks: Check[] }> {
    const s = await this.seasons.season(seasonId);
    const checks: Check[] = [];
    const add = (key: string, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });

    // 1. parameters
    const [pv] = await this.db.select().from(paramVersions).where(and(eq(paramVersions.seasonId, seasonId), eq(paramVersions.version, s.currentParamVersion)));
    if (!pv) add("params", "参数", "fail", "这个赛季还没有参数表");
    else {
      const changed = changedPaths(DEFAULT_PARAMS, pv.params);
      add("params", "参数", "ok", changed.length ? `第 ${pv.version} 版；和默认值不同的 ${changed.length} 项：${changed.slice(0, 8).join("、")}${changed.length > 8 ? "……" : ""}` : `第 ${pv.version} 版，全部是默认值`);
    }

    // 2. calendar: school and rest days
    const last = addDays(s.openingDate, CALENDAR_DAYS - 1);
    const set = await this.db.select().from(calendarDays).where(and(gte(calendarDays.day, s.openingDate), lte(calendarDays.day, last)));
    add(
      "calendar",
      "日历的上学日和休息日",
      set.length ? "ok" : "warn",
      set.length
        ? `开营后 ${CALENDAR_DAYS} 天里手动设了 ${set.length} 天（上学 ${set.filter((d) => d.kind === "school").length}、休息 ${set.filter((d) => d.kind !== "school").length}），其余按周六日休息`
        : `开营后 ${CALENDAR_DAYS} 天全是默认（周六日休息、其余上学）；节假日和调休要在"日历"里手动设`,
    );

    // 3. prize pool: entered at the final settlement
    add("pool", "奖池", "info", "奖池金额在终局结算时填写；开营前请和合作方确认金额，奖学金比例在参数表里");

    // 4. grouping
    if (!s.groupingLockedAt) {
      add("grouping", "分组", "fail", s.grouping ? "分组已生成，还没确认锁定" : "还没生成分组");
    } else {
      const svs = await this.db.select().from(servers).where(eq(servers.seasonId, seasonId));
      const ts = svs.length ? await this.db.select().from(teams).where(inArray(teams.serverId, svs.map((x) => x.id))) : [];
      const ms = ts.length ? await this.db.select().from(teamMembers).where(inArray(teamMembers.teamId, ts.map((x) => x.id))) : [];
      const size = new Map<string, number>();
      for (const m of ms) size.set(m.teamId, (size.get(m.teamId) ?? 0) + 1);
      const sizes = ts.map((t) => size.get(t.id) ?? 0);
      const p = (pv?.params ?? DEFAULT_PARAMS) as typeof DEFAULT_PARAMS;
      const odd = svs.filter((sv) => ts.filter((t) => t.serverId === sv.id).length !== p.grouping.teamsPerServer);
      const empty = sizes.filter((n) => n === 0).length;
      add(
        "grouping",
        "分组",
        empty || odd.length ? "fail" : "ok",
        `已锁定：${svs.length} 个服、${ts.length} 个组、${ms.length} 人，每组 ${Math.min(...sizes)}–${Math.max(...sizes)} 人` +
          (odd.length ? `；${odd.map((x) => x.name).join("、")} 的组数不是 ${p.grouping.teamsPerServer}` : "") +
          (empty ? `；${empty} 个组没有人` : ""),
      );
    }

    // 5. reviewer accounts
    const staff = await this.db.select().from(adminUsers).where(eq(adminUsers.status, "active"));
    const reviewers = staff.filter((u) => u.role === "reviewer");
    const firstWeekEnd = addDays(s.openingDate, 7);
    const away = reviewers.length
      ? await this.db
          .select()
          .from(reviewerLeaves)
          .where(and(inArray(reviewerLeaves.reviewerId, reviewers.map((r) => r.id)), lte(reviewerLeaves.fromDay, firstWeekEnd), gte(reviewerLeaves.toDay, s.openingDate)))
      : [];
    const invited = (await this.db.select().from(adminUsers).where(eq(adminUsers.status, "invited"))).filter((u) => u.role === "reviewer");
    add(
      "reviewers",
      "复核员账号",
      reviewers.length ? (away.length >= reviewers.length ? "warn" : "ok") : "fail",
      (reviewers.length ? `${reviewers.length} 个复核员已开通（都开了两步验证）` : "还没有开通的复核员（没人复核时作品会到时限按 AI 分结算）") +
        (away.length ? `；第一周有 ${new Set(away.map((a) => a.reviewerId)).size} 人请假` : "") +
        (invited.length ? `；${invited.length} 个邀请还没接受` : ""),
    );

    // 6. question bank: every land can draw at least two prompts
    if (s.groupingLockedAt) {
      const svs = await this.db.select().from(servers).where(eq(servers.seasonId, seasonId));
      const low: string[] = [];
      for (const sv of svs) for (const x of QuestionBank.lowStock(await this.store.state(sv.id))) low.push(`${sv.name} ${x.landId}（${x.available} 条）`);
      add("prompts", "题库", low.length ? "fail" : "ok", low.length ? `可抽的题少于 2 条：${low.join("、")}` : "每块地都至少能抽 2 条题");
    } else {
      const tpl = await this.db.select().from(landTemplates);
      const enabled = await this.db.select().from(prompts).where(and(eq(prompts.category, "land"), eq(prompts.status, "enabled")));
      const per = new Map<string, number>();
      for (const q of enabled) if (q.landTemplateId) per.set(q.landTemplateId, (per.get(q.landTemplateId) ?? 0) + 1);
      const thin = tpl.filter((t) => t.status === "enabled" && (per.get(t.id) ?? 0) < 2);
      add(
        "prompts",
        "题库",
        !tpl.length ? "fail" : thin.length ? "warn" : "ok",
        !tpl.length ? "还没有地块模板（题库与评分 → 一键导入）" : thin.length ? `启用的题少于 2 条的地块：${thin.map((t) => t.name).join("、")}` : `${tpl.length} 个地块模板，每个都至少有 2 条启用的题`,
      );
    }

    // 7. WeChat group QR codes
    if (s.groupingLockedAt) {
      const svs = await this.db.select().from(servers).where(eq(servers.seasonId, seasonId));
      const ts = svs.length ? await this.db.select().from(teams).where(inArray(teams.serverId, svs.map((x) => x.id))) : [];
      const missing = ts.filter((t) => !t.qrImage);
      add("qr", "小组微信群二维码", missing.length ? "warn" : "ok", missing.length ? `${missing.length} 个组还没上传：${missing.slice(0, 8).map((t) => t.name).join("、")}${missing.length > 8 ? "……" : ""}` : "每个组都上传了");
    } else add("qr", "小组微信群二维码", "info", "分组锁定后上传（玩家与分组 → 二维码）");

    // 8. AI models
    const fake = (await this.gateway.configs()).configs.filter((c) => c.provider === "fake");
    add("ai", "AI 模型", fake.length ? "warn" : "ok", fake.length ? `还在用假的 AI：${fake.map((c) => c.task).join("、")}（内容与运营 → AI 配置）` : "每个任务都配了真的模型");

    // 9. timing
    const now = this.clock.now();
    const opening = new Date(`${s.openingDate}T00:00:00+08:00`);
    add("timing", "开营日", +opening > +now ? "ok" : "info", `${s.openingDate}（周日）；现在状态：${s.status}`);

    return { seasonId, ready: !checks.some((c) => c.status === "fail"), checks };
  }
}
