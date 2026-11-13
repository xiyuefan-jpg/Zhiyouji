import { describe, expect, it } from "vitest";
import { bj, setup } from "./helpers.js";

describe("request limit (part 8 §3.3)", () => {
  it("per login per minute; others and the next minute are not affected; health is never counted", async () => {
    const t = await setup(bj("2027-03-10", 16), (c) => (c.rateLimit.perMinute = 5));
    const a = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    t.clock.advance(60_000);
    for (let i = 0; i < 5; i++) expect((await t.call("GET", "/v1/me", undefined, a.token)).statusCode).toBe(200);
    const r = await t.call("GET", "/v1/me", undefined, a.token);
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ error: "too_many_requests", message: "操作太频繁了，请等一会儿再试" });
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await t.call("GET", "/v1/health")).statusCode).toBe(200);
    // another login is separate
    const other = await t.call("GET", "/v1/me", undefined, "someone-else");
    expect(other.statusCode).toBe(401);
    t.clock.advance(60_000);
    expect((await t.call("GET", "/v1/me", undefined, a.token)).statusCode).toBe(200);
    await t.close();
  });
});
