/**
 * Season actions on the student website (PRD part 5 D–E): request shapes.
 */

import { z } from "zod";

export const roleSchema = z.enum(["leader", "deputy"]);

export const claimRoleRequest = z.object({ role: roleSchema });
export const offerRoleRequest = z.object({ role: roleSchema, to: z.uuid() });
export const answerTransferRequest = z.object({ accept: z.boolean() });

export const landRequest = z.object({ landId: z.string().min(1).max(10) });
export const itemRequest = z.object({ itemId: z.string().min(1).max(20) });
export const bidRequest = z.object({ itemId: z.string().min(1).max(20), amount: z.number().int().positive() });

export const useItemRequest = z.object({
  itemId: z.string().min(1).max(20),
  uid: z.string().min(1).max(40).optional(),
  targetTeamId: z.uuid().optional(),
  landId: z.string().min(1).max(10).optional(),
  contestId: z.string().min(1).max(40).optional(),
  week: z.number().int().min(1).max(5).optional(),
  line: z.number().int().min(0).max(10).optional(),
});

export const ROUND_NAMES = ["blind_auction", "starter_items", "center_round", "rare_round"] as const;
export const roundParam = z.object({ round: z.enum(ROUND_NAMES) });
export const roundSubmission = z.object({
  /** Blind auction only: grain bid. */
  bid: z.number().int().min(0).optional(),
  /** Land ids (auction, D8) or item ids (starter items, rare round), most wanted first. */
  prefs: z.array(z.string().min(1).max(20)).max(20),
});

export const linesRequest = z.object({ lines: z.array(z.uuid()).min(1).max(10) });

export const ledgerQuery = z.object({ currency: z.enum(["grain", "points"]).default("points") });
