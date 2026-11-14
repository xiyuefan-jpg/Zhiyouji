/** Admin console: 待补清单 (PRD part 7 §4). Admins edit; reviewers read. */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ContentTodos } from "../content/todos.js";
import type { AdminAuth } from "./adminRoutes.js";

const idParam = z.object({ id: z.uuid() });
const todoBody = z.object({
  title: z.string().trim().min(1).max(60),
  state: z.string().trim().max(200).nullable().optional(),
  action: z.string().trim().max(300).nullable().optional(),
  dueDay: z.number().int().min(-60).max(40),
  dueNote: z.string().trim().max(60).nullable().optional(),
});
const todoPatch = todoBody.partial().extend({ done: z.boolean().optional() });

export function todoRoutes(app: FastifyInstance, todos: ContentTodos, auth: AdminAuth): void {
  const admin = async (req: Parameters<AdminAuth["user"]>[0]) => `admin:${(await auth.user(req, ["admin"])).user.id}`;
  app.get("/v1/admin/content/todos", async (req) => {
    await auth.user(req);
    return todos.list();
  });
  app.post("/v1/admin/content/todos/seed-defaults", async (req) => todos.seedDefaults(await admin(req)));
  app.post("/v1/admin/content/todos", async (req) => {
    const by = await admin(req);
    return todos.create(todoBody.parse(req.body), by);
  });
  app.patch("/v1/admin/content/todos/:id", async (req) => {
    const by = await admin(req);
    return todos.update(idParam.parse(req.params).id, todoPatch.parse(req.body), by);
  });
}
