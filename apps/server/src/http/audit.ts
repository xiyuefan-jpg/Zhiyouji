/**
 * What every admin console route leaves behind (PRD part 8 §3.1, §3.4;
 * part 7 §7 操作日志; part 4 §13 操作日志 / 查看记录).
 *
 * Every `/v1/admin/...` route must be listed in `ADMIN_AUDIT`; the app refuses
 * to start otherwise, so a new route cannot quietly skip the logs. Each entry
 * says how the route is covered:
 *
 * - `domain`: the service writes the operation log itself (with before / after
 *   and the reason);
 * - `route`: the service does not, so after a successful call this module
 *   writes one operation-log line (who, the action, the object from the URL,
 *   the request body without secrets; `note` / `reason` in the body becomes
 *   the reason);
 * - `view`: the route shows a specific child's data and records it in the view
 *   log itself (per child for content and contact details; one line per
 *   list for rosters that show only nicknames and grades);
 * - `none`: nothing to log, with why.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { opLog, type Db } from "@zhiyouji/db";
import type { Clock } from "../clock.js";

export type AuditPolicy =
  | { kind: "domain"; action: string }
  | { kind: "route"; action: string; object: string }
  | { kind: "view"; contentKind: string; perChild: boolean }
  | { kind: "none"; why: string };

const domain = (action: string): AuditPolicy => ({ kind: "domain", action });
const route = (action: string, object: string): AuditPolicy => ({ kind: "route", action, object });
const view = (contentKind: string, perChild = true): AuditPolicy => ({ kind: "view", contentKind, perChild });
const none = (why: string): AuditPolicy => ({ kind: "none", why });

const READ = none("只读，不含具体孩子的数据");
const OWN_INBOX = none("自己的消息中心已读状态");
const LOGIN = none("登录和退出（PRD 第 4 部分 v0.5 取消了管理端登录记录）");
const TICKET = none("只拿上传凭证，传完设置时才记");

/** `METHOD /path` → how it is logged. */
export const ADMIN_AUDIT: Record<string, AuditPolicy> = {
  // accounts (part 7 §0)
  "POST /v1/admin/auth/login": LOGIN,
  "POST /v1/admin/auth/logout": LOGIN,
  "POST /v1/admin/auth/invite/start": none("设密码的第一步；激活时（invite/finish）记"),
  "POST /v1/admin/auth/invite/finish": domain("activate_admin_user"),
  "GET /v1/admin/me": READ,
  "GET /v1/admin/users": none("管理端账号列表，不含孩子的数据"),
  "POST /v1/admin/users": domain("invite_admin_user"),
  "POST /v1/admin/users/:id/disable": domain("disable_admin_user"),
  "GET /v1/admin/view-log": READ,
  "GET /v1/admin/op-log": READ,
  "GET /v1/admin/messages": none("管理端自己的通知"),
  "GET /v1/admin/messages/unread-count": READ,
  "POST /v1/admin/messages/:id/read": OWN_INBOX,
  "POST /v1/admin/messages/read-all": OWN_INBOX,
  "GET /v1/admin/dashboard": none("只有数量和截止时间"),

  // seasons, enrollment, grouping (part 7 §2–§3)
  "GET /v1/admin/seasons": READ,
  "POST /v1/admin/seasons": domain("season_create"),
  "GET /v1/admin/seasons/:id": READ,
  "PATCH /v1/admin/seasons/:id": domain("season_update"),
  "POST /v1/admin/seasons/:id/open-enrollment": domain("season_status"),
  "POST /v1/admin/seasons/:id/reopen-enrollment": domain("season_status"),
  "GET /v1/admin/children": view("child_search"),
  "POST /v1/admin/seasons/:id/players": domain("season_enroll"),
  "GET /v1/admin/seasons/:id/players": view("roster"),
  "GET /v1/admin/seasons/:id/players.csv": view("roster"),
  "POST /v1/admin/seasons/:id/players/:childId/revoke": domain("season_revoke"),
  "POST /v1/admin/seasons/:id/grouping/generate": domain("grouping_generate"),
  "GET /v1/admin/seasons/:id/grouping": view("grouping", false),
  "POST /v1/admin/seasons/:id/grouping/move": domain("grouping_move"),
  "POST /v1/admin/seasons/:id/grouping/rename": domain("team_rename"),
  "POST /v1/admin/seasons/:id/grouping/confirm": domain("grouping_confirm"),
  "GET /v1/admin/seasons/:id/params": READ,
  "GET /v1/admin/seasons/:id/preflight": none("开营前检查清单，只有数量"),
  "POST /v1/admin/seasons/:id/params": domain("params_set"),
  "GET /v1/admin/calendar": READ,
  "POST /v1/admin/calendar/:day": domain("calendar_set"),

  // live season, interventions, final (part 7 §7–§9)
  "GET /v1/admin/servers/:id": view("server_overview", false),
  "GET /v1/admin/servers/:id/ledger": none("小组的账本，不含孩子的数据"),
  "GET /v1/admin/servers/:id/planned": READ,
  "POST /v1/admin/servers/:id/planned/:key/reschedule": domain("planned_move"),
  "POST /v1/admin/servers/:id/planned/:key/rerun": domain("planned_rerun"),
  "POST /v1/admin/servers/:id/pause": domain("season_pause"),
  "POST /v1/admin/servers/:id/resume": domain("season_resume"),
  "POST /v1/admin/servers/:id/interventions": domain("intervene_*"),
  "GET /v1/admin/servers/:id/feed": none("全服广播，本服孩子都看得到"),
  "POST /v1/admin/feed/:id/hide": domain("feed_hide"),
  "POST /v1/admin/servers/:id/finalize": domain("finalize"),
  "GET /v1/admin/servers/:id/scholarship.csv": view("scholarship", false),
  "GET /v1/admin/servers/:id/supply": none("各组军需的分数和档位，不含孩子的内容"),
  "GET /v1/admin/servers/:id/supply/:supplyId/teams/:teamId": view("supply"),
  "POST /v1/admin/servers/:id/supply/:supplyId/teams/:teamId/regrade": route("supply_regrade", "supply:{supplyId}:{teamId}"),
  "GET /v1/admin/servers/:id/final-preview": none("小组的分数和奖学金预览，不含孩子的数据"),

  // review (part 7 §5–§6)
  "GET /v1/admin/reviews": none("自己的复核队列，盲审，不含孩子的数据"),
  "GET /v1/admin/reviews/:id": view("work"),
  "POST /v1/admin/reviews/:id": route("review_score", "review:{id}"),
  "POST /v1/admin/reviews/leave": route("reviewer_leave", "reviewer"),
  "POST /v1/admin/reviews/:id/reassign": route("review_reassign", "review:{id}"),
  "GET /v1/admin/works/:id": view("work"),
  "POST /v1/admin/works/:id/rule": route("work_rule", "work:{id}"),
  "POST /v1/admin/works/:id/rejudge": route("work_rejudge", "work:{id}"),
  "POST /v1/admin/works/:id/ai-rerun": route("work_ai_rerun", "work:{id}"),
  "GET /v1/admin/reviewers/dashboard": none("复核员的统计，只有作品编号"),

  // daily tasks (part 7 §5)
  "GET /v1/admin/daily/exceptions": view("daily_task"),
  "POST /v1/admin/daily/:id/decide": route("daily_decide", "daily:{id}"),
  "POST /v1/admin/daily/:id/ai-rerun": route("daily_ai_rerun", "daily:{id}"),

  // question bank (part 7 §4)
  "GET /v1/admin/land-templates": READ,
  "POST /v1/admin/land-templates/seed-defaults": domain("land_templates_seed"),
  "PATCH /v1/admin/land-templates/:id": domain("land_template_update"),
  "GET /v1/admin/prompts": READ,
  "POST /v1/admin/prompts": domain("prompt_create"),
  "POST /v1/admin/prompts/import": domain("prompt_import"),
  "PATCH /v1/admin/prompts/:id": domain("prompt_update"),
  "GET /v1/admin/prompts/low-stock": READ,

  // content and operations (part 7 §8)
  "GET /v1/admin/announcements": READ,
  "POST /v1/admin/announcements": route("announcement_create", "announcements"),
  "POST /v1/admin/announcements/:id/withdraw": route("announcement_withdraw", "announcement:{id}"),
  "POST /v1/admin/teams/:id/qr/ticket": TICKET,
  "POST /v1/admin/teams/:id/qr": route("qr_set", "team:{id}"),
  "POST /v1/admin/servers/:id/camps/:camp/qr/ticket": TICKET,
  "POST /v1/admin/servers/:id/camps/:camp/qr": route("qr_set", "server:{id}/camp:{camp}"),
  "GET /v1/admin/safety": none("队列只有对象编号和标签；打开作品（/v1/admin/works/:id）时记"),
  "POST /v1/admin/safety/:id/pass": route("safety_pass", "safety:{id}"),
  "POST /v1/admin/safety/:id/remove": route("safety_remove", "safety:{id}"),
  "POST /v1/admin/safety/:id/forward": route("safety_forward", "safety:{id}"),

  // AI (part 6 §9; part 7 §4)
  "GET /v1/admin/ai/config": READ,
  "PUT /v1/admin/ai/config/:task": route("ai_config_set", "ai:{task}"),
  "GET /v1/admin/ai/prompts/:task": READ,
  "POST /v1/admin/ai/prompts/:task": route("ai_prompt_add", "ai:{task}"),
  "GET /v1/admin/ai/stats": READ,
  "GET /v1/admin/ai/prices": READ,
  "PUT /v1/admin/ai/prices/:model": route("ai_price_set", "ai_price:{model}"),
  "GET /v1/admin/tags/suggestions": none("按月汇总的标签名称"),

  // season reviews, data, exports (part 7 §9; part 8 §4)
  "POST /v1/admin/seasons/:id/reviews/generate": route("season_reviews_generate", "season:{id}"),
  "GET /v1/admin/seasons/:id/reviews": view("season_review"),
  "POST /v1/admin/seasons/:id/reviews/release": route("season_reviews_release", "season:{id}"),
  "GET /v1/admin/data-requests": view("data_request"),
  "GET /v1/admin/exports/:kind.csv": view("export", false),
};

/** Body keys never written to the log. */
const SECRET = /^(password|totp|code|token|secret|inviteToken)$/i;
const MAX_TEXT = 500;

/** The request body as it goes into the log: secrets dropped, long text cut. */
export function sanitizeBody(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…（共 ${v.length} 字）` : v;
  if (v === null || typeof v !== "object") return v ?? null;
  if (depth > 4) return "…";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitizeBody(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!SECRET.test(k)) out[k] = sanitizeBody(x, depth + 1);
  return out;
}

/** "work:{id}" + { id: "w1" } → "work:w1". */
export function auditObject(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "?");
}

/** Who made the request, set by `AdminAuth.user`. */
export const adminOfRequest = new WeakMap<FastifyRequest, string>();

/**
 * Registers the check (every admin route listed) and the `route` logging.
 * Call before the routes are added. `onAdminRoute` sees every admin route
 * (the coverage test uses it to find stale entries).
 */
export function adminAudit(app: FastifyInstance, db: Db, clock: Clock, onAdminRoute: (key: string) => void = () => {}): void {
  app.addHook("onRoute", (r: RouteOptions) => {
    if (!r.url.startsWith("/v1/admin/")) return;
    const methods = (Array.isArray(r.method) ? r.method : [r.method]).filter((m) => m !== "HEAD");
    for (const m of methods) {
      const key = `${m} ${r.url}`;
      const policy = ADMIN_AUDIT[key];
      if (!policy) throw new Error(`admin route without an audit policy (add it to ADMIN_AUDIT in http/audit.ts): ${key}`);
      onAdminRoute(key);
      if (policy.kind !== "route") continue;
      const hook = async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
        if (reply.statusCode >= 400) return payload;
        const actor = adminOfRequest.get(req);
        const body = (req.body ?? null) as Record<string, unknown> | null;
        const reason = body && typeof body === "object" ? (body.reason ?? body.note ?? null) : null;
        await db.insert(opLog).values({
          actor: actor ? `admin:${actor}` : "unknown",
          action: policy.action,
          object: auditObject(policy.object, (req.params ?? {}) as Record<string, string>),
          before: null,
          after: sanitizeBody(body),
          reason: typeof reason === "string" ? reason : null,
          at: clock.now(),
        });
        return payload;
      };
      const prev = r.onSend;
      r.onSend = prev ? [...(Array.isArray(prev) ? prev : [prev]), hook] : [hook];
    }
  });
}
