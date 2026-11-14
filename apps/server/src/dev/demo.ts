/**
 * DEMO MODE — for trying the whole site locally; never used in production
 * (main.ts does not import this file).
 *
 *   npm run demo -w @zhiyouji/server        # API on :3000 with a simulated clock
 *   npm run dev -w @zhiyouji/web            # student website on :5173
 *   npm run dev -w @zhiyouji/admin          # admin console on :5174
 *
 * What it sets up:
 * - the clock starts on DEMO_START (Beijing, default 2027-01-25 10:00) and only moves
 *   when you fast-forward it (POST /v1/dev/advance);
 * - a season "S3 演示" opening on 2027-02-07 (Sunday), enrollment open, with 31 bot
 *   children already enabled; the 12 land templates and their prompts from the content
 *   library (docs/design/智游记S3_试运行内容库.md §4);
 * - an admin (boss@demo.cn) and a reviewer (rev@demo.cn), password demo-password-1;
 *   their two-step code for the simulated time: GET /v1/dev/totp?email=…;
 * - any phone number can log in; the code: GET /v1/dev/code?phone=…;
 * - bots play every team that has no human child in it;
 * - DEMO_HUMAN="phone:昵称:年级" adds one real family to the season, DEMO_GROUP=1 confirms the grouping at start.
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { children, families, seasons, servers, teamMembers, teams } from "@zhiyouji/db";
import { createPgliteDb } from "@zhiyouji/db";
import { beijingDate, beijingInstant, seasonDayOf } from "@zhiyouji/engine";
import { SimClock } from "../clock.js";
import { defaultConfig } from "../config.js";
import { buildApp } from "../http/app.js";
import { FakeCaptcha, FakeSms } from "../providers.js";
import { totpAt } from "../security.js";
import { setSessionCookie } from "../http/auth.js";
import { LocalStorage } from "../storage.js";
import { Worker } from "../worker.js";
import { Bots } from "./bots.js";

const HOUR = 3_600_000;
const ADMIN = "demo";
const OPENING = process.env.DEMO_OPENING ?? "2027-02-07";
const PASSWORD = "demo-password-1";
const BOT_NAMES = ["悟空", "八戒", "沙僧", "白龙", "红孩儿", "哪吒", "金角", "银角", "玉兔", "嫦娥", "织女", "牛郎", "土行孙", "雷震子", "杨戬", "哮天", "灵吉", "镇元", "观音", "弥勒", "太白", "托塔", "巨灵", "千里眼", "顺风耳", "赤脚", "福星", "禄星", "寿星", "龙女", "善财"];

/**
 * Big-battle prompts for the demo from the content library's draft theme (§7.1, a table:
 * 战线 | 分值 | 学科 | 任务 | 本组印记 | 评分族). The real theme is still 待补, so titles say 草案.
 */
function battleFromContentLibrary(): { category: "battle_line" | "battle_main"; title: string; body: string; rubric: string | null }[] {
  let md = "";
  try {
    md = readFileSync(new URL("../../../../docs/design/智游记S3_试运行内容库.md", import.meta.url), "utf8");
  } catch {
    return [];
  }
  const sec = md.split("### 7.1")[1]?.split("###")[0] ?? "";
  const out: { category: "battle_line" | "battle_main"; title: string; body: string; rubric: string | null }[] = [];
  for (const line of sec.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    if (c.length < 8 || !/^[甲乙丙丁] · |^主战场/.test(c[1]!)) continue;
    const main = c[1]!.startsWith("主战场");
    out.push({
      category: main ? "battle_main" : "battle_line",
      title: `（草案）${c[1]!.replace(/^[甲乙丙丁] · /, "")}`,
      body: `${c[4]}。学科：${c[3]}；要有本组印记：${c[5]}。`,
      rubric: /^[A-E]$/.test(c[6]!) ? c[6]! : null,
    });
  }
  return out;
}

/** Land prompts from the content library (§4.3–4.14: "### 4.x 名字 · 学科", numbered 素材). */
function promptsFromContentLibrary(): Map<string, { title: string; body: string }[]> {
  const out = new Map<string, { title: string; body: string }[]>();
  let md = "";
  try {
    md = readFileSync(new URL("../../../../docs/design/智游记S3_试运行内容库.md", import.meta.url), "utf8");
  } catch {
    return out;
  }
  let land: string | null = null;
  let inMaterial = false;
  for (const line of md.split("\n")) {
    const h = /^### 4\.\d+ (\S+) · /.exec(line);
    if (h) {
      land = h[1]!;
      inMaterial = false;
      out.set(land, []);
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("### ")) land = null;
    if (!land) continue;
    if (/^- 素材/.test(line)) inMaterial = true;
    const m = /^\s+\d+\. (.+)$/.exec(line);
    if (inMaterial && m) {
      const text = m[1]!.replace(/（S\d）/g, "").trim();
      out.get(land)!.push({ title: text.slice(0, 40), body: text });
    }
  }
  return out;
}

async function main() {
  const env = process.env;
  const cfg = defaultConfig(env);
  const start = env.DEMO_START ? new Date(env.DEMO_START) : new Date(beijingInstant("2027-01-25", 10, 0));
  const clock = new SimClock(start);
  const { db, close } = await createPgliteDb(env.PGLITE_DIR);
  const sms = new FakeSms((line) => console.log(line));
  const storage = new LocalStorage(cfg.secret, env.STORAGE_DIR ?? "/tmp/zyj-demo-storage");
  const { app, services: s } = buildApp({ db, clock, cfg, sms, captcha: new FakeCaptcha(), storage, logger: false });
  const worker = new Worker(db, s.scheduler, s.smsDispatcher, s.notifier, s.reports, s.reminders, s.scoring, s.dataRights, s.daily, s.supply, s.debates, s.ops, s.showcase, s.summaries, s.media, s.tagSuggestions);

  // ---- seed ----------------------------------------------------------------------
  const secrets = new Map<string, string>();
  for (const [email, name, role] of [
    ["boss@demo.cn", "范老师", "admin"],
    ["rev@demo.cn", "李复核", "reviewer"],
  ] as const) {
    const inv = await s.admin.invite(ADMIN, { email, name, role, timezone: "America/New_York" });
    const { secret } = await s.admin.startInvite(inv.inviteToken, PASSWORD);
    await s.admin.finishInvite(inv.inviteToken, totpAt(secret, +clock.now()));
    secrets.set(email, secret);
  }
  await s.bank.seedDefaults(ADMIN);
  const templates = (await s.bank.templates()).templates;
  const library = promptsFromContentLibrary();
  for (const t of templates) {
    const items = library.get(t.name) ?? [];
    if (items.length) await s.bank.importMany(items.map((p) => ({ category: "land" as const, landTemplateId: t.id, title: p.title, body: p.body, status: "enabled" as const })), ADMIN);
  }
  const battle = battleFromContentLibrary();
  if (battle.length) await s.bank.importMany(battle.map((p) => ({ ...p, status: "enabled" as const })), ADMIN);
  const botIds: string[] = [];
  for (let i = 0; i < 31; i++) {
    const [f] = await db.insert(families).values({ phone: `1390000${String(1000 + i)}`, consentVersion: cfg.policyVersion, consentAt: clock.now() }).returning();
    const [c] = await db.insert(children).values({ familyId: f!.id, nickname: BOT_NAMES[i]!, grade: 1 + (i % 9), avatar: `a${1 + (i % 12)}` }).returning();
    botIds.push(c!.id);
  }
  const season = await s.seasons.create({ name: "S3 演示", opening: OPENING, seed: 7 }, ADMIN);
  await s.seasons.openEnrollment(season.id, ADMIN);
  await s.seasons.enroll(season.id, botIds.map((childId) => ({ childId, paymentNote: "机器人" })), ADMIN);
  // DEMO_HUMAN="phone:昵称:年级" puts one real family into the season (logs in with /v1/dev/login?phone=…);
  // DEMO_GROUP=1 also generates and confirms the grouping, so the season starts at D0 evening.
  if (env.DEMO_HUMAN) {
    const [phone, nickname, grade] = env.DEMO_HUMAN.split(":");
    const [f] = await db.insert(families).values({ phone: phone!, consentVersion: cfg.policyVersion, consentAt: clock.now() }).returning();
    const [c] = await db.insert(children).values({ familyId: f!.id, nickname: nickname ?? "小满", grade: Number(grade ?? 5) }).returning();
    await s.seasons.enroll(season.id, [{ childId: c!.id, paymentNote: "演示" }], ADMIN);
  }
  if (env.DEMO_GROUP === "1") {
    await s.seasons.generateGrouping(season.id, ADMIN);
    await s.seasons.confirmGrouping(season.id, {}, ADMIN);
  }
  const bots = new Bots(db, s, OPENING, new Set(botIds));

  /** Teams with at least one child who is not a bot. */
  async function humanTeams(serverId: string): Promise<Set<string>> {
    const rows = await db
      .select({ teamId: teams.id, childId: teamMembers.childId })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teams.serverId, serverId));
    return new Set(rows.filter((r) => !botIds.includes(r.childId)).map((r) => r.teamId));
  }

  async function liveServers() {
    return db.select({ id: servers.id, status: seasons.status }).from(servers).innerJoin(seasons, eq(servers.seasonId, seasons.id));
  }

  /** Move the clock hour by hour: the worker every hour, the bots every 2 hours. */
  async function advanceTo(to: number) {
    let ticks = 0;
    while (+clock.now() < to) {
      clock.set(Math.min(to, +clock.now() + HOUR));
      await worker.tick();
      ticks++;
      const hour = new Date(+clock.now() + 8 * HOUR).getUTCHours();
      if (hour % 2 === 0)
        for (const sv of await liveServers()) await bots.step(sv.id, sv.status, +clock.now(), await humanTeams(sv.id));
    }
    return ticks;
  }

  // ---- dev routes (demo only) --------------------------------------------------------
  const describe = async () => {
    const now = +clock.now();
    const st = (await db.select().from(seasons).where(eq(seasons.id, season.id)))[0]!;
    return {
      now: new Date(now).toISOString(),
      beijing: `${beijingDate(now)} ${String(new Date(now + 8 * HOUR).getUTCHours()).padStart(2, "0")}:${String(new Date(now + 8 * HOUR).getUTCMinutes()).padStart(2, "0")}`,
      seasonDay: seasonDayOf(OPENING, now),
      season: { id: season.id, status: st.status, opening: OPENING },
      admin: { email: "boss@demo.cn", reviewer: "rev@demo.cn", password: PASSWORD },
    };
  };
  app.get("/v1/dev/state", describe);
  app.get<{ Querystring: { phone: string } }>("/v1/dev/code", async (req) => ({ code: sms.lastCode(req.query.phone) ?? null }));
  /** Log a family in without a code (demo only: the 10-codes-a-day limit gets in the way of trying things). */
  app.get<{ Querystring: { phone: string } }>("/v1/dev/login", async (req, reply) => {
    const phone = req.query.phone;
    let [fam] = await db.select().from(families).where(eq(families.phone, phone)).limit(1);
    if (!fam) [fam] = await db.insert(families).values({ phone, createdAt: clock.now(), lastLoginAt: clock.now() }).returning();
    const sess = await s.sessions.create("family", { familyId: fam!.id });
    setSessionCookie(reply, cfg, cfg.cookies.family, sess.token, sess.expiresAt);
    return reply.redirect("/");
  });
  app.get<{ Querystring: { email: string } }>("/v1/dev/totp", async (req) => {
    const secret = secrets.get(req.query.email);
    return { code: secret ? totpAt(secret, +clock.now()) : null };
  });
  app.post<{ Body: { hours?: number; to?: string; beijing?: string } }>("/v1/dev/advance", async (req) => {
    const b = req.body ?? {};
    let to = +clock.now() + (b.hours ?? 1) * HOUR;
    if (b.to) to = +new Date(b.to);
    if (b.beijing) {
      const [d, hm] = b.beijing.split(" ");
      const [h, m] = (hm ?? "0:0").split(":").map(Number);
      to = beijingInstant(d!, h!, m ?? 0);
    }
    if (to < +clock.now()) return { error: "past", ...(await describe()) };
    const ticks = await advanceTo(to);
    return { ticks, ...(await describe()) };
  });

  const port = Number(env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`demo API on :${port}`, await describe());

  const stop = async () => {
    await app.close();
    await close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
