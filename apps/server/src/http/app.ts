/**
 * The API (PRD part 2 §2): builds the Fastify app with every route, given the
 * database, the clock and the outside services. Tests build it with PGlite,
 * a hand-moved clock and the fake SMS / captcha.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
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
import { QuestionBank } from "../content/questionBank.js";
import { bankRoutes } from "./bankRoutes.js";
import { Debates } from "../season/debates.js";
import { Operations } from "../season/operations.js";
import { opsRoutes } from "./opsRoutes.js";
import { Survey } from "../accounts/survey.js";
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
  const ai = d.ai ?? new FakeAiScorer();
  const aiDaily = d.aiDaily ?? new FakeAiDaily();
  const play = new SeasonPlay(d.db, d.clock, store);
  return {
    supply: new Supply(d.db, d.clock, store, d.aiSupply ?? new FakeAiSupply(), notifier),
    aiDaily,
    daily: new DailyTasks(d.db, d.clock, d.cfg, storage, aiDaily, notifier, store, play),
    ai,
    dataRights: new DataRights(d.db, d.clock, storage, notifier),
    scoring: new Scoring(d.db, d.clock, store, ai, notifier, storage),
    storage,
    works: new Works(d.db, d.clock, d.cfg, store, storage, debates, ops),
    ops,
    survey,
    debates,
    store,
    scheduler,
    seasons,
    control: new SeasonControl(d.db, d.clock, store, scheduler, seasons),
    play,
    reports: new Reports(d.db, d.clock, store, notifier),
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

export function buildApp(d: AppDeps, services = buildServices(d)): { app: FastifyInstance; services: Services } {
  const app = Fastify({ logger: d.logger ?? false, trustProxy: d.trustProxy ?? false, bodyLimit: 256 * 1024 });

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
  playRoutes(app, services.play, services.reports, services.supply, services.warWords, services.debates, services.familyAuth);
  seasonControlRoutes(app, services.control, services.adminAuth);
  workRoutes(app, services.works, services.play, services.scoring, services.familyAuth);
  reviewRoutes(app, services.scoring, services.admin, services.adminAuth);
  dataRoutes(app, d.db, services.dataRights, services.familyAuth, services.adminAuth);
  bankRoutes(app, services.bank, services.adminAuth);
  opsRoutes(app, services.ops, services.play, services.familyAuth, services.adminAuth);
  app.get("/v1/survey", async (req) => services.survey.latest((await services.familyAuth.child(req)).child.id));
  app.post("/v1/survey", async (req) => services.survey.submit((await services.familyAuth.child(req)).child, surveySubmit.parse(req.body)));
  dailyRoutes(app, services.daily, services.admin, services.familyAuth, services.adminAuth);
  devStorageRoutes(app, services.storage, d.clock, Math.max(...Object.values(d.cfg.uploads.maxBytes)));
  return { app, services };
}
