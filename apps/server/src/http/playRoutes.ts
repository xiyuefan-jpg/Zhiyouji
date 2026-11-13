/**
 * Student website: the season (PRD part 5 D–F). The logged-in child (chosen
 * on "我是谁") acts for their team; team actions need the leader or deputy.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  answerTransferRequest,
  bidRequest,
  chooseCardRequest,
  claimRoleRequest,
  itemRequest,
  landRequest,
  ledgerQuery,
  linesRequest,
  offerRoleRequest,
  roundParam,
  roundSubmission,
  supplyEntryRequest,
  useItemRequest,
} from "@zhiyouji/shared";
import type { SeasonPlay } from "../season/play.js";
import type { Reports } from "../season/reports.js";
import type { Supply } from "../season/supply.js";
import type { WarWords } from "../season/warWords.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.string().min(1).max(40) });

const beforeQuery = z.object({ before: z.coerce.date().optional() });

export function playRoutes(app: FastifyInstance, play: SeasonPlay, reports: Reports, supply: Supply, warWords: WarWords, auth: FamilyAuth): void {
  const ctx = async (req: FastifyRequest) => play.ctx((await auth.child(req)).child.id);

  app.get("/v1/season/me", async (req) => play.me((await auth.child(req)).child.id));
  app.get("/v1/season/map", async (req) => play.map(await ctx(req)));
  app.get("/v1/season/ranking", async (req) => play.ranking(await ctx(req)));
  app.get("/v1/season/team", async (req) => play.team(await ctx(req)));
  app.get("/v1/season/ledger", async (req) => play.ledger(await ctx(req), ledgerQuery.parse(req.query).currency));
  app.get("/v1/season/items", async (req) => play.catalogue(await ctx(req)));

  // roles (E3)
  app.post("/v1/season/roles/claim", async (req) => play.claimRole(await ctx(req), claimRoleRequest.parse(req.body).role));
  app.post("/v1/season/roles/offer", async (req) => {
    const b = offerRoleRequest.parse(req.body);
    return play.offerRole(await ctx(req), b.role, b.to);
  });
  app.get("/v1/season/roles/transfers", async (req) => ({ transfers: await play.pendingTransfers(await ctx(req)) }));
  app.post("/v1/season/roles/transfers/:id", async (req) =>
    play.answerTransfer(await ctx(req), z.uuid().parse((req.params as { id: string }).id), answerTransferRequest.parse(req.body).accept),
  );
  app.post("/v1/season/roles/take-over", async (req) => play.takeOver(await ctx(req)));

  // contests (D2, D3, E7)
  app.get("/v1/season/lands/:id/quote", async (req) => play.quote(await ctx(req), idParam.parse(req.params).id));
  app.post("/v1/season/contests", async (req) => play.startContest(await ctx(req), landRequest.parse(req.body).landId));
  app.get("/v1/season/contests/:id", async (req) => play.contest(await ctx(req), idParam.parse(req.params).id));
  app.post("/v1/season/contests/:id/join", async (req) => play.joinContest(await ctx(req), idParam.parse(req.params).id));

  // items (E5), center land, shop (E10), epic auctions (E11)
  app.post("/v1/season/items/use", async (req) => play.useItem(await ctx(req), useItemRequest.parse(req.body)));
  app.post("/v1/season/center-lands/buy", async (req) => play.buyCenterLand(await ctx(req), landRequest.parse(req.body).landId));
  app.get("/v1/season/shop", async (req) => play.shop(await ctx(req)));
  app.post("/v1/season/shop/buy", async (req) => play.buyShopItem(await ctx(req), itemRequest.parse(req.body).itemId));
  app.post("/v1/season/shop/bid", async (req) => {
    const b = bidRequest.parse(req.body);
    return play.bidEpic(await ctx(req), b.itemId, b.amount);
  });

  // submission rounds (D4, E10)
  app.get("/v1/season/rounds/:round", async (req) => play.roundView(await ctx(req), roundParam.parse(req.params).round));
  app.post("/v1/season/rounds/:round", async (req) => play.submitRound(await ctx(req), roundParam.parse(req.params).round, roundSubmission.parse(req.body)));

  // weekly wars (E8), big battle (E12)
  app.get("/v1/season/wars", async (req) => play.wars(await ctx(req)));
  app.get("/v1/season/big-battle", async (req) => play.bigBattle(await ctx(req)));
  app.post("/v1/season/big-battle/lines", async (req) => play.submitLines(await ctx(req), linesRequest.parse(req.body).lines));

  // 战报 (F1), 全服广播 (F2), 组内动态 (E1)
  app.get("/v1/season/reports", async (req) => reports.list(await ctx(req)));
  app.get("/v1/season/reports/:id", async (req) => reports.get(await ctx(req), z.uuid().parse((req.params as { id: string }).id)));
  app.get("/v1/season/broadcasts", async (req) => reports.broadcasts(await ctx(req), beforeQuery.parse(req.query).before));
  app.get("/v1/season/team-feed", async (req) => reports.teamFeed(await ctx(req)));

  // 军需任务 (E9)
  const supplyParam = z.object({ id: z.string().regex(/^\d[ab]$/) });
  app.get("/v1/season/supply", async (req) => supply.list(await ctx(req)));
  app.post("/v1/season/supply/:id/entry", async (req) => supply.submitEntry(await ctx(req), supplyParam.parse(req.params).id, supplyEntryRequest.parse(req.body)));
  app.post("/v1/season/supply/:id/summary", async (req) => supply.submitSummary(await ctx(req), supplyParam.parse(req.params).id, supplyEntryRequest.parse(req.body)));

  // 周战争：主题、词条、对手情报 (E8, §3.5)
  const weekParam = z.object({ week: z.coerce.number().int().min(1).max(5) });
  app.get("/v1/season/wars/:week", async (req) => warWords.view(await ctx(req), weekParam.parse(req.params).week));
  app.post("/v1/season/wars/:week/card", async (req) => warWords.choose(await ctx(req), weekParam.parse(req.params).week, chooseCardRequest.parse(req.body).card));
}
