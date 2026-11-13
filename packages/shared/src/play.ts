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

// ---- 作品工坊 (part 5 E4, §3.3) -------------------------------------------------------------

export const FILE_KINDS = ["video", "audio", "image", "pdf"] as const;
export const MEDIA_KINDS = ["video", "audio", "images", "text"] as const;

export const uploadRequest = z.object({
  kind: z.enum(FILE_KINDS),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  filename: z.string().trim().max(200).optional(),
});

export const slotParam = z.object({ slot: z.string().regex(/^(contest:[A-Za-z0-9]+|war:\d+|line|main:[ab])$/) });

export const materialRequest = z.object({
  fileId: z.uuid().optional(),
  text: z.string().max(5000).optional(),
});

export const workSubmit = z.object({
  mediaKind: z.enum(MEDIA_KINDS),
  fileIds: z.array(z.uuid()).max(20).default([]),
  /** Written explanation (and the whole work when mediaKind is "text"). */
  text: z.string().max(10000).optional(),
  /** 人机协作说明 */
  aiNote: z.string().max(1000).optional(),
  /** Members who took part (signature). */
  members: z.array(z.uuid()).min(1).max(20),
});

// ---- review (part 7 §5) ------------------------------------------------------------------------

export const reviewSubmit = z.object({
  /** Score per rubric dimension key, e.g. { accuracy: 20, teach: 25, … }. */
  dims: z.record(z.string(), z.number().int().min(0).max(100)),
  comment: z.string().trim().min(1).max(3000),
  flags: z.array(z.enum(["plagiarism", "inappropriate", "needs_admin"])).max(3).optional(),
});
export const reassignRequest = z.object({ reviewerId: z.uuid() });
export const leaveRequest = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
export const ruleRequest = z.object({ score: z.number().int().min(0).max(100), note: z.string().trim().min(1).max(300) });
