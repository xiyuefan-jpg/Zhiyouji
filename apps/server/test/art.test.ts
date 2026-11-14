import { describe, expect, it } from "vitest";
import { contestSetup } from "./seasonHelpers.js";

describe("美术资源 (part 7 §8; part 5 §7)", () => {
  it("upload to a slot with its author, enable it; the website gets the live image and credits the author", async () => {
    const t = await contestSetup();
    const boss = await t.adminUser();
    const call = (m: "GET" | "POST", url: string, b?: unknown) => t.call(m, url, b, boss.token);
    const slots = (await call("GET", "/v1/admin/art")).json().slots as { slot: string; name: string; group: string }[];
    expect(slots.map((s) => s.slot)).toEqual(expect.arrayContaining(["map", "land:火焰山", "item:zijin", "badge:1", "avatar:a1", "tudigong", "splash"]));
    expect((await call("POST", "/v1/admin/art/ticket", { slot: "nope", contentType: "image/png", size: 3 })).statusCode).toBe(400);
    const up = async (slot: string, body: string, author: string, live: boolean) => {
      const tk = (await call("POST", "/v1/admin/art/ticket", { slot, contentType: "image/png", size: body.length })).json();
      await t.app.inject({ method: "PUT", url: tk.upload.url, payload: Buffer.from(body), headers: { "content-type": "image/png" } });
      return (await call("POST", "/v1/admin/art", { slot, key: tk.key, contentType: "image/png", author, live })).json().id as string;
    };
    await up("land:火焰山", "v1", "AI 初稿", true);
    const second = await up("land:火焰山", "v2", "三组 小林", false);
    expect((await call("POST", "/v1/admin/art", { slot: "map", key: "art/map/x", contentType: "image/png", author: "x" })).json().error).toBe("upload_missing");

    let live = (await t.a1api("GET", "/v1/art")).json();
    expect((await t.app.inject({ method: "GET", url: live.images["land:火焰山"] })).body).toBe("v1");
    // the child's drawing replaces the draft
    await call("POST", `/v1/admin/art/${second}/enable`);
    live = (await t.a1api("GET", "/v1/art")).json();
    expect((await t.app.inject({ method: "GET", url: live.images["land:火焰山"] })).body).toBe("v2");
    expect(live.authors).toEqual([{ author: "三组 小林", works: ["火焰山"] }]);
    const list = (await call("GET", "/v1/admin/art")).json().slots.find((s: { slot: string }) => s.slot === "land:火焰山");
    expect(list.uploads.map((u: { author: string; live: boolean }) => [u.author, u.live]).sort()).toEqual([
      ["AI 初稿", false],
      ["三组 小林", true],
    ]);
    await call("POST", "/v1/admin/art/disable", { slot: "land:火焰山" });
    expect((await t.a1api("GET", "/v1/art")).json().images).toEqual({});
    await t.close();
  });
});
