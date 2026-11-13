/**
 * Student website: uploads, the material box and submitting works (PRD part 5
 * E4, §3.3). Also the development storage that stands in for OSS.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { materialRequest, slotParam, uploadRequest, workSubmit } from "@zhiyouji/shared";
import type { Clock } from "../clock.js";
import type { SeasonPlay } from "../season/play.js";
import type { Works } from "../season/works.js";
import type { Scoring } from "../season/scoring.js";
import { LocalStorage, type ObjectStorage } from "../storage.js";
import { fail } from "./errors.js";
import type { FamilyAuth } from "./familyRoutes.js";

const idParam = z.object({ id: z.uuid() });

export function workRoutes(app: FastifyInstance, works: Works, play: SeasonPlay, scoring: Scoring, auth: FamilyAuth): void {
  const ctx = async (req: FastifyRequest) => play.ctx((await auth.child(req)).child.id);

  app.post("/v1/season/uploads", async (req) => works.requestUpload(await ctx(req), uploadRequest.parse(req.body)));
  app.post("/v1/season/uploads/:id/complete", async (req) => works.completeUpload(await ctx(req), idParam.parse(req.params).id));
  app.get("/v1/season/files/:id/url", async (req) => works.fileUrl(await ctx(req), idParam.parse(req.params).id));

  app.get("/v1/season/works", async (req) => works.slots(await ctx(req)));
  app.get("/v1/season/works/:slot/materials", async (req) => works.listMaterials(await ctx(req), slotParam.parse(req.params).slot));
  app.post("/v1/season/works/:slot/materials", async (req) => works.addMaterial(await ctx(req), slotParam.parse(req.params).slot, materialRequest.parse(req.body)));
  app.delete("/v1/season/materials/:id", async (req) => works.removeMaterial(await ctx(req), idParam.parse(req.params).id));
  app.get("/v1/season/works/:slot/versions", async (req) => works.versions(await ctx(req), slotParam.parse(req.params).slot));
  app.get("/v1/season/works/:slot/result", async (req) => {
    const c = await ctx(req);
    return scoring.results(c.serverId, c.teamId, slotParam.parse(req.params).slot);
  });
  app.post("/v1/season/works/:slot", async (req) => works.submit(await ctx(req), slotParam.parse(req.params).slot, workSubmit.parse(req.body)));
}

/** PUT / GET for LocalStorage's signed URLs (development and tests only; production uses OSS). */
export function devStorageRoutes(app: FastifyInstance, storage: ObjectStorage, clock: Clock, maxBytes: number): void {
  if (!(storage instanceof LocalStorage)) return;
  const local = storage;
  const q = z.object({ op: z.enum(["put", "get"]), exp: z.coerce.number(), sig: z.string() });
  app.register(async (sub) => {
    sub.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: maxBytes }, (_req, body, done) => done(null, body));
    sub.put("/v1/dev-storage/*", async (req) => {
      const key = decodeURIComponent((req.params as { "*": string })["*"]);
      const p = q.parse(req.query);
      if (p.op !== "put" || !local.verify(key, "put", p.exp, p.sig, +clock.now())) fail(403, "forbidden");
      const body = req.body as Buffer;
      await local.put(key, Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? "")), String(req.headers["content-type"] ?? "application/octet-stream"));
      return { ok: true };
    });
    sub.get("/v1/dev-storage/*", async (req, reply) => {
      const key = decodeURIComponent((req.params as { "*": string })["*"]);
      const p = q.parse(req.query);
      if (p.op !== "get" || !local.verify(key, "get", p.exp, p.sig, +clock.now())) fail(403, "forbidden");
      const o = await local.get(key);
      if (!o) fail(404, "not_found");
      reply.header("content-type", o!.contentType);
      return o!.bytes;
    });
  });
}
