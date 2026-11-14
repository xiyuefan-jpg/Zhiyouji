/**
 * The API (PRD part 2 §2): builds the Fastify app with every route, given the
 * database, the clock and the outside services. Tests build it with PGlite,
 * a hand-moved clock and the fake SMS / captcha.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { Db } from "@zhiyouji/db";
import { errorText } from "@zhiyouji/shared";
import { AdminAccounts } from "../accounts/admin.js";
import { FamilyAccounts } from "../accounts/family.js";
import { Sessions } from "../accounts/sessions.js";
import type { Clock } from "../clock.js";
import type { ServerConfig } from "../config.js";
import { Notifier, SmsDispatcher } from "../notify/notifier.js";
import type { CaptchaVerifier, SmsProvider } from "../providers.js";
import { AdminAuth, adminRoutes } from "./adminRoutes.js";
import { HttpError } from "./errors.js";
import { FamilyAuth, familyRoutes } from "./familyRoutes.js";
import { messageRoutes } from "./messageRoutes.js";
import { seasonAdminRoutes } from "./seasonAdminRoutes.js";
import { playRoutes } from "./playRoutes.js";
import { SeasonPlay } from "../season/play.js";
import { Reports } from "../season/reports.js";
import { SeasonNotices } from "../notify/seasonNotices.js";
import { SeasonControl } from "../season/control.js";
import { Reminders } from "../notify/reminders.js";
import { Works } from "../season/works.js";
import { LocalStorage, type ObjectStorage } from "../storage.js";
import { devStorageRoutes, workRoutes } from "./workRoutes.js";
import { FakeAiScorer, type AiScorer } from "../ai.js";
import { Scoring } from "../season/scoring.js";
import { reviewRoutes } from "./reviewRoutes.js";
import { DataRights } from "../accounts/dataRights.js";
import { dataRoutes } from "./dataRoutes.js";
import { FakeAiDaily, FakeAiSupply, type AiDailyReviewer, type AiSupplyScorer } from "../ai.js";
import { Supply } from "../season/supply.js";
import { WarWords } from "../season/warWords.js";
import { Home } from "../season/todo.js";
import { FakeMediaProcessor, MediaPipeline, type MediaProcessor } from "../media.js";
import { TagSuggestions } from "../daily/tagSuggestions.js";
import { rateLimit } from "./rateLimit.js";
import { adminAudit } from "./audit.js";
import { QuestionBank } from "../content/questionBank.js";
import { bankRoutes } from "./bankRoutes.js";
import { Debates } from "../season/debates.js";
import { Operations } from "../season/operations.js";
import { opsRoutes } from "./opsRoutes.js";
import { Survey } from "../accounts/survey.js";
import { Dashboard } from "../season/dashboard.js";
import { Preflight } from "../season/preflight.js";
import { Showcase } from "../season/showcase.js";
import { watchRoutes } from "./watchRoutes.js";
import { Summaries } from "../daily/summaries.js";
import { FakeAiSummarizer, type AiSummarizer } from "../ai.js";
import { AiGateway } from "../aiGateway.js";
import { aiRoutes } from "./aiRoutes.js";
import { exportRoutes } from "./exportRoutes.js";
import { FakeContentSafety, type ContentSafety } from "../providers.js";
import { surveySubmit } from "@zhiyouji/shared";
import { DailyTasks } from "../daily/daily.js";
import { dailyRoutes } from "./dailyRoutes.js";
import { seasonControlRoutes } from "./seasonControlRoutes.js";
import { SeasonAdmin } from "../season/seasons.js";
import { SeasonStore } from "../seasonStore.js";
import { Scheduler } from "../scheduler.js";

export interface AppDeps {
  db: Db;
  clock: Clock;
  cfg: ServerConfig;
  sms: SmsProvider;
  captcha: CaptchaVerifier;
  /** Object storage for works (default: LocalStorage in memory). */
  storage?: ObjectStorage;
  /** AI initial scoring of works (default: the fake). */
  ai?: AiScorer;
  /** AI review of daily tasks (default: the fake). */
  aiDaily?: AiDailyReviewer;
  /** AI scoring of supply tasks (default: the fake). */
  aiSupply?: AiSupplyScorer;
  /** Content safety (default: the fake). */
  safety?: ContentSafety;
  /** Weekly / monthly look-backs and season reviews (default: the fake). */
  aiSummary?: AiSummarizer;
  /** Speech-to-text, video key frames, document text (default: the fake). */
  media?: MediaProcessor;
  logger?: boolean;
  trustProxy?: boolean;
}

export interface Services {
  sessions: Sessions;
  family: FamilyAccounts;
  admin: AdminAccounts;
  notifier: Notifier;
  smsDispatcher: SmsDispatcher;
  familyAuth: FamilyAuth;
  adminAuth: AdminAuth;
  /** One season store per process: it caches the engine state of every server. */
  store: SeasonStore;
  scheduler: Scheduler;
  seasons: SeasonAdmin;
  play: SeasonPlay;
  reports: Reports;
  seasonNotices: SeasonNotices;
  control: SeasonControl;
  reminders: Reminders;
  storage: ObjectStorage;
  works: Works;
  ai: AiScorer;
  scoring: Scoring;
  dataRights: DataRights;
  aiDaily: AiDailyReviewer;
  daily: DailyTasks;
  supply: Supply;
  warWords: WarWords;
  bank: QuestionBank;
  debates: Debates;
  ops: Operations;
  survey: Survey;
  dashboard: Dashboard;
  preflight: Preflight;
  showcase: Showcase;
  summaries: Summaries;
  gateway: AiGateway;
  home: Home;
  media: MediaPipeline;
  mediaProcessor: MediaProcessor;
  tagSuggestions: TagSuggestions;
}

export function buildServices(d: AppDeps): Services {
  const sessions = new Sessions(d.db, d.clock, d.cfg);
  const family = new FamilyAccounts(d.db, d.clock, d.cfg, sessions, d.sms, d.captcha);
  const admin = new AdminAccounts(d.db, d.clock, d.cfg, sessions);
  const store = new SeasonStore(d.db);
  const notifier = new Notifier(d.db, d.clock, d.cfg);
  const scheduler = new Scheduler(d.db, store, d.clock);
  const seasonNotices = new SeasonNotices(d.db, notifier);
  const warWords = new WarWords(d.db, d.clock, store, notifier);
  const bank = new QuestionBank(d.db, d.clock, store, notifier);
  const storage = d.storage ?? new LocalStorage(d.cfg.secret);
  const debates = new Debates(d.db, d.clock, store, notifier, storage);
  const ops = new Operations(d.db, d.clock, store, notifier, storage);
  store.onApplied(async (serverId, _seq, notices, state) => {
    for (const n of notices) if (n.kind === "contest_started") await debates.onContestStarted(serverId, state, String(n.data.contestId));
  });
  // A land running out of prompts after a draw → tell the admins.
  store.onApplied(async (serverId, _seq, notices, state) => {
    for (const n of notices) if (n.kind === "contest_started") await bank.checkAfterDraw(serverId, state, String(n.data.landId));
  });
  // Engine notices → message center and SMS; D0 evening → "分组公布".
  store.onApplied((serverId, seq, notices, state) => seasonNotices.dispatch(serverId, seq, notices, state));
  scheduler.onRowDone(async (serverId, kind, key) => {
    if (kind === "publish_groups") await seasonNotices.groupsPublished(serverId, await store.state(serverId));
    if (kind === "war_pairing") await warWords.onPaired(serverId, Number(key.split(":")[1]));
    if (kind === "gift_deadline") await warWords.reveal(serverId, Number(key.split(":")[1]));
  });
  const survey = new Survey(d.db, d.clock);
  const seasons = new SeasonAdmin(d.db, d.clock, store, notifier, bank, survey);
  // The raw model clients (fakes until the accounts exist); everything else gets them through the gateway (logging, fallback, shadow).
  const gateway = new AiGateway(d.db, d.clock);
  const ai = d.ai ?? new FakeAiScorer();
  const aiDaily = d.aiDaily ?? new FakeAiDaily();
  const play = new SeasonPlay(d.db, d.clock, store, notifier);
  const reports = new Reports(d.db, d.clock, store, notifier);
  const works = new Works(d.db, d.clock, d.cfg, store, storage, debates, ops);
  const mediaProcessor = d.media ?? new FakeMediaProcessor();
  const media = new MediaPipeline(d.db, d.clock, storage, mediaProcessor, notifier);
  const supply = new Supply(d.db, d.clock, store, gateway.wrapSupply(d.aiSupply ?? new FakeAiSupply()), notifier);
  return {
    home: new Home(d.db, d.clock, store, play, works, supply, warWords, reports),
    media,
    mediaProcessor,
    tagSuggestions: new TagSuggestions(d.db, d.clock, notifier),
    gateway,
    summaries: new Summaries(d.db, d.clock, gateway.wrapSummary(d.aiSummary ?? new FakeAiSummarizer()), notifier, store),
    showcase: new Showcase(d.db, d.clock, store, d.safety ?? new FakeContentSafety(), notifier, storage, play, reports),
    supply,
    aiDaily,
    daily: new DailyTasks(d.db, d.clock, d.cfg, storage, gateway.wrapDaily(aiDaily), notifier, store, play, media),
    ai,
    dataRights: new DataRights(d.db, d.clock, storage, notifier),
    scoring: new Scoring(d.db, d.clock, store, gateway.wrapScorer(ai), notifier, storage, media),
    storage,
    works,
    ops,
    survey,
    dashboard: new Dashboard(d.db, d.clock, store),
    preflight: new Preflight(d.db, d.clock, store, seasons, gateway),
    debates,
    store,
    scheduler,
    seasons,
    control: new SeasonControl(d.db, d.clock, store, scheduler, seasons),
    play,
    reports,
    reminders: new Reminders(d.db, d.clock, store, notifier, warWords, debates),
    warWords,
    bank,
    seasonNotices,
    sessions,
    family,
    admin,
    notifier,
    smsDispatcher: new SmsDispatcher(d.db, d.clock, d.cfg, d.sms),
    familyAuth: new FamilyAuth(d.cfg, sessions, family),
    adminAuth: new AdminAuth(d.cfg, sessions, admin),
  };
}

export function buildApp(d: AppDeps, services = buildServices(d)): { app: FastifyInstance; services: Services; adminRouteKeys: string[]; routeKeys: string[] } {
  const app = Fastify({ logger: d.logger ?? false, trustProxy: d.trustProxy ?? false, bodyLimit: 256 * 1024 });

  rateLimit(app, d.clock, d.cfg.rateLimit.perMinute);
  // Every admin route must say how it is logged (PRD part 8 §3.1, §3.4).
  const adminRouteKeys: string[] = [];
  const routeKeys: string[] = [];
  app.addHook("onRoute", (r) => {
    for (const m of Array.isArray(r.method) ? r.method : [r.method]) if (m !== "HEAD") routeKeys.push(`${m} ${r.url}`);
  });
  adminAudit(app, d.db, d.clock, (k) => adminRouteKeys.push(k));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body());
    if (err instanceof ZodError) {
      const code = err.issues.map((i) => i.message).find((m) => errorText(m) !== errorText("bad_request")) ?? "bad_request";
      return reply.status(400).send({ error: code, message: errorText(code), fields: err.issues.map((i) => i.path.join(".")) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: "bad_request", message: errorText("bad_request") });
    req.log.error(err);
    return reply.status(500).send({ error: "server", message: "服务器出了点问题，请稍后再试" });
  });

  app.get("/v1/health", async () => ({ ok: true, now: d.clock.now().toISOString() }));
  familyRoutes(app, d.cfg, services.family, services.sessions, services.familyAuth);
  adminRoutes(app, d.cfg, services.admin, services.sessions, services.adminAuth);
  messageRoutes(app, services.notifier, services.familyAuth, services.adminAuth);
  seasonAdminRoutes(app, services.seasons, services.adminAuth);
  playRoutes(app, services.play, services.reports, services.supply, services.warWords, services.debates, services.familyAuth, services.home);
  seasonControlRoutes(app, services.control, services.adminAuth);
  workRoutes(app, services.works, services.play, services.scoring, services.familyAuth);
  reviewRoutes(app, services.scoring, services.admin, services.adminAuth);
  dataRoutes(app, d.db, services.dataRights, services.familyAuth, services.adminAuth);
  bankRoutes(app, services.bank, services.adminAuth);
  opsRoutes(app, services.ops, services.play, services.familyAuth, services.adminAuth);
  watchRoutes(app, services.showcase, services.familyAuth, services.adminAuth);
  aiRoutes(app, services.gateway, services.scoring, services.adminAuth);
  exportRoutes(app, d.db, services.admin, services.adminAuth);
  app.get("/v1/journal/summaries", async (req) => services.summaries.list((await services.familyAuth.child(req)).child.id));
  app.get("/v1/season-reviews", async (req) => services.summaries.seasonReviewsOf((await services.familyAuth.child(req)).child.id));
  const seasonIdParam = z.object({ id: z.uuid() });
  app.post("/v1/admin/seasons/:id/reviews/generate", async (req) => {
    await services.adminAuth.user(req, ["admin"]);
    return services.summaries.generateSeasonReviews(seasonIdParam.parse(req.params).id);
  });
  app.get("/v1/admin/seasons/:id/reviews", async (req) => {
    const { user } = await services.adminAuth.user(req, ["admin"]);
    const id = seasonIdParam.parse(req.params).id;
    const r = await services.summaries.previewSeasonReviews(id);
    await services.adminAuth.view(user.id, r.reviews.map((x) => x.childId), { contentKind: "season_review", objectId: id, action: "view" });
    return r;
  });
  app.post("/v1/admin/seasons/:id/reviews/release", async (req) => {
    await services.adminAuth.user(req, ["admin"]);
    return services.summaries.releaseSeasonReviews(seasonIdParam.parse(req.params).id);
  });
  // 开营前检查清单 (part 9 §3)
  app.get("/v1/admin/seasons/:id/preflight", async (req) => {
    await services.adminAuth.user(req, ["admin"]);
    return services.preflight.check(seasonIdParam.parse(req.params).id);
  });
  // 新标签建议 (part 6 T10)
  app.get("/v1/admin/tags/suggestions", async (req) => {
    await services.adminAuth.user(req, ["admin"]);
    const month = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query).month;
    return services.tagSuggestions.suggestions(month);
  });
  app.get("/v1/admin/dashboard", async (req) => {
    const { user } = await services.adminAuth.user(req);
    return services.dashboard.view(user.id, user.role);
  });
  app.get("/v1/survey", async (req) => services.survey.latest((await services.familyAuth.child(req)).child.id));
  app.post("/v1/survey", async (req) => services.survey.submit((await services.familyAuth.child(req)).child, surveySubmit.parse(req.body)));
  dailyRoutes(app, services.daily, services.admin, services.familyAuth, services.adminAuth);
  devStorageRoutes(app, services.storage, d.clock, Math.max(...Object.values(d.cfg.uploads.maxBytes)));
  return { app, services, adminRouteKeys, routeKeys };
}
