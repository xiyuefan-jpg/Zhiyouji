import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messages } from "@zhiyouji/db";
import { bj } from "./helpers.js";
import { contestSetup, playSetup } from "./seasonHelpers.js";

describe("season play on the student website (part 5 D–E)", () => {
  it("before D0 evening the child waits; afterwards sees the season, the map and the team", async () => {
    const t = await playSetup();
    const a1 = await t.as("13800000001", t.a1);
    expect((await a1("GET", "/v1/season/me")).json()).toMatchObject({ status: "waiting", season: { name: "S3" } });
    expect((await a1("GET", "/v1/season/map")).json().error).toBe("no_season");

    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const me = (await a1("GET", "/v1/season/me")).json();
    expect(me).toMatchObject({ status: "playing", role: "member", canAct: false, season: { status: "running", day: 0 } });
    expect(me.members.length).toBeGreaterThanOrEqual(2);
    expect(me.members.find((m: { me: boolean }) => m.me).nickname).toBe("大毛");

    const map = (await a1("GET", "/v1/season/map")).json();
    expect(map.lands).toHaveLength(12);
    expect(map.lands[0]).toMatchObject({ id: "E1", name: "火焰山", kind: "edge", output: 1, owner: null });
    const team = (await a1("GET", "/v1/season/team")).json();
    expect(team).toMatchObject({ grain: 60, spendableGrain: 60, points: 0, items: [] });
    const ledger = (await a1("GET", "/v1/season/ledger?currency=grain")).json();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ amount: 60, source: "opening" });
    expect((await a1("GET", "/v1/season/ranking")).json().ranking).toHaveLength(8);
    await t.close();
  });

  it("roles: claim, taken, hand-over waits for the receiver, members cannot act for the team", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    const b1 = await t.as("13800000002", t.b1);

    expect((await a1("POST", "/v1/season/roles/claim", { role: "leader" })).json()).toMatchObject({ role: "leader", canAct: true });
    const taken = await b1("POST", "/v1/season/roles/claim", { role: "leader" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: "taken", message: "这个位置已经有人了" });
    expect((await b1("POST", "/v1/season/roles/claim", { role: "deputy" })).json().role).toBe("deputy");

    // a1 hands the leader role to b1; nothing changes until b1 accepts
    expect((await a1("POST", "/v1/season/roles/offer", { role: "leader", to: t.b1 })).json().transfer.status).toBe("pending");
    expect((await a1("GET", "/v1/season/me")).json().role).toBe("leader");
    const pending = (await b1("GET", "/v1/season/roles/transfers")).json().transfers;
    expect(pending).toHaveLength(1);
    expect(pending[0].forMe).toBe(true);
    // a1 cannot accept on b1's behalf
    expect((await a1("POST", `/v1/season/roles/transfers/${pending[0].id}`, { accept: true })).statusCode).toBe(404);
    const acc = (await b1("POST", `/v1/season/roles/transfers/${pending[0].id}`, { accept: true })).json();
    expect(acc.role).toBe("leader");
    expect((await a1("GET", "/v1/season/me")).json()).toMatchObject({ role: "member", canAct: false });

    // the deputy seat is free again (default 6); a member's team action is refused
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 5, prefs: ["E1"] })).json()).toMatchObject({ error: "not_leader", message: "请组长或副组长操作" });
    // take-over: the leader b1 is active, so the deputy cannot take over
    expect((await a1("POST", "/v1/season/roles/claim", { role: "deputy" })).json().role).toBe("deputy");
    expect((await a1("POST", "/v1/season/roles/take-over")).json().error).toBe("leader_active");
    // three days later without b1 → a1 takes over
    t.clock.advance(3 * 24 * 3_600_000 + 60_000);
    const a1b = await t.as("13800000001", t.a1);
    expect((await a1b("POST", "/v1/season/roles/take-over")).json().role).toBe("leader");
    await t.close();
  });

  it("blind auction submission window, the auction result on the map, then a contest with a cost quote", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });

    // only edge lands, bid ≤ grain
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 5, prefs: ["C1"] })).json().error).toBe("bad_prefs");
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 61, prefs: ["E1"] })).json().error).toBe("not_enough_grain");
    const sub = (await a1("POST", "/v1/season/rounds/blind_auction", { bid: 20, prefs: ["E1", "E2"] })).json();
    expect(sub).toMatchObject({ open: true, closed: false, submission: { bid: 20, prefs: ["E1", "E2"] } });
    // starter items are not open yet
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun"] })).json().error).toBe("too_early");

    // D1 21:00: the auction runs; the highest bid gets its first choice
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(t.serverId);
    const map = (await a1("GET", "/v1/season/map")).json();
    expect(map.lands.find((l: { id: string }) => l.id === "E1")).toMatchObject({ mine: true });
    expect((await a1("POST", "/v1/season/rounds/blind_auction", { bid: 1, prefs: ["E3"] })).json().error).toBe("too_late");
    expect((await a1("GET", "/v1/season/team")).json().grain).toBe(40);
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun", "bihuo", "zhencha"] })).json().error).toBe("bad_prefs");
    expect((await a1("POST", "/v1/season/rounds/starter_items", { prefs: ["huanhun", "bihuo"] })).json().submission.prefs).toEqual(["huanhun", "bihuo"]);

    // D2 10:00: attack another team's land
    t.clock.set(bj("2027-02-09", 10));
    const target = map.lands.find((l: { owner: unknown; mine: boolean; kind: string }) => l.owner && !l.mine && l.kind === "edge");
    const quote = (await a1("GET", `/v1/season/lands/${target.id}/quote`)).json();
    expect(quote.cost).toBeGreaterThan(0);
    const started = await a1("POST", "/v1/season/contests", { landId: target.id });
    expect(started.statusCode).toBe(200);
    const c = started.json().contest;
    expect(c).toMatchObject({ landId: target.id, paid: quote.cost });
    expect(c.promptId.startsWith(target.id)).toBe(true);
    expect((await a1("GET", "/v1/season/team")).json().grain).toBe(40 - quote.cost);
    const detail = (await a1("GET", `/v1/season/contests/${c.id}`)).json();
    expect(detail).toMatchObject({ status: "active", involved: true });
    expect((await a1("POST", "/v1/season/contests", { landId: "E1" })).json().error).toBe("own_land");
    expect((await a1("POST", "/v1/season/contests", { landId: target.id })).json().error).toBe("contest_in_progress");

    // the sibling in another team sees the contest on the map, not a1's items
    const a2 = await t.as("13800000001", t.a2);
    const m2 = (await a2("GET", "/v1/season/map")).json();
    expect(m2.lands.find((l: { id: string }) => l.id === target.id).contest.id).toBe(c.id);
    expect((await a2("GET", `/v1/season/contests/${c.id}`)).json().attackers[0].paid).toBeUndefined();
    await t.close();
  });

  it("法宝图鉴: when, target and effect with the season's numbers", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    const cat = (await a1("GET", "/v1/season/items")).json();
    expect(cat.items).toHaveLength(21);
    expect(cat.punchDownFactor).toBe(0.5);
    const by = (id: string) => cat.items.find((i: { id: string }) => i.id === id);
    expect(by("zijin")).toMatchObject({ target: "team", broadcast: true, effect: "选一个组：从它那里抢 5 分（目标排名比你们低时 × 0.5）。" });
    expect(by("shengsi")).toMatchObject({ target: "own_land" });
    expect(by("xiuli")).toMatchObject({ target: "contest" });
    expect(by("yujing")).toMatchObject({ target: "week" });
    expect(by("bihuo")).toMatchObject({ target: "passive", broadcast: false });
    expect(by("zhencha")).toMatchObject({ broadcast: false });
    expect(by("bagua").when).toBe("第 29 天之前");
    await t.close();
  });

  it("using an item says what happened to the target (挡下了) and what 太虚幻镜 would copy", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    const mine = (await a1("GET", "/v1/season/me")).json().team.id as string;
    const st = await t.services.store.state(t.serverId);
    const other = st.teamOrder.find((x) => x !== mine)!;
    await t.services.control.intervene(t.serverId, { action: "give_item", teamId: mine, itemId: "zijin", reason: "测试" }, "admin:test");
    await t.services.control.intervene(t.serverId, { action: "give_item", teamId: other, itemId: "bihuo", reason: "测试" }, "admin:test");
    expect((await a1("GET", "/v1/season/items")).json().taixuCopies).toBeNull();
    t.clock.set(bj("2027-02-09", 10));
    const r = (await a1("POST", "/v1/season/items/use", { itemId: "zijin", targetTeamId: other })).json();
    expect(r.used).toMatchObject({ itemId: "zijin", copied: null, outcomes: [{ teamId: other, team: st.teams[other]!.name, outcome: "blocked" }] });
    expect(r.items).toEqual([]);
    expect((await a1("GET", "/v1/season/items")).json().taixuCopies).not.toBeNull();
    await t.close();
  });

  it("商店 (D15–D17): window, goods with prices and stock, buying a common item, rare waits for the D15 round, epic auctions with the minimum bid", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    expect((await a1("GET", "/v1/season/shop")).json()).toMatchObject({ open: false, rareRoundDone: false, maxItems: 3, maxEpic: 1, bought: [] });
    t.clock.set(bj("2027-02-22", 10));
    await t.services.scheduler.runDue(t.serverId);
    const shop = (await a1("GET", "/v1/season/shop")).json();
    expect(shop.open).toBe(true);
    expect(shop.goods.find((g: { id: string }) => g.id === "huanhun")).toMatchObject({ tier: "common", price: 50, stock: null, mine: false });
    expect(shop.goods.find((g: { id: string }) => g.id === "zijin")).toMatchObject({ tier: "rare", price: 80, stock: 2 });
    expect(shop.goods.some((g: { id: string }) => g.id === "zhencha" || g.id === "bagua")).toBe(false);
    expect((await a1("POST", "/v1/season/shop/buy", { itemId: "zijin" })).json().error).toBe("rare_round_pending");
    const team = (await a1("GET", "/v1/season/team")).json();
    if (team.spendableGrain >= 50) {
      await a1("POST", "/v1/season/shop/buy", { itemId: "huanhun" });
      expect((await a1("GET", "/v1/season/shop")).json().goods.find((g: { id: string }) => g.id === "huanhun").mine).toBe(true);
    }
    t.clock.set(bj("2027-02-22", 21, 1));
    await t.services.scheduler.runDue(t.serverId);
    const later = (await a1("GET", "/v1/season/shop")).json();
    expect(later.rareRoundDone).toBe(true);
    expect(later.auctions.length).toBeGreaterThan(0);
    expect(later.auctions[0]).toMatchObject({ closed: false, minBid: 150, leader: null });
    await t.close();
  });
});

describe("notifications, reports and feeds (part 8 §1.2; part 5 F1, F2, E1)", () => {
  it("enabled → grouped → attacked (with SMS) → reports three times a day, items kept secret", async () => {
    const { smsOutbox } = await import("@zhiyouji/db");
    const t = await playSetup();
    const a1 = await t.as("13800000001", t.a1);
    const msgs = async (f: typeof a1) => (await f("GET", "/v1/messages")).json().messages as { type: string; title: string; body: string; link: string }[];
    expect((await msgs(a1)).map((m) => m.type)).toEqual(["season_enabled"]);

    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const grouped = (await msgs(a1)).find((m) => m.type === "grouped")!;
    expect(grouped.body).toContain("组");
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    await a1("POST", "/v1/season/rounds/blind_auction", { bid: 20, prefs: ["E1"] });
    t.clock.set(bj("2027-02-08", 21, 1));
    await t.services.scheduler.runDue(t.serverId);

    t.clock.set(bj("2027-02-09", 10));
    const st = await t.services.store.state(t.serverId);
    const myTeam = (await a1("GET", "/v1/season/me")).json().team.id as string;
    const target = st.landOrder.find((l) => st.lands[l]!.kind === "edge" && st.lands[l]!.owner && st.lands[l]!.owner !== myTeam)!;
    const defender = st.lands[target]!.owner!;
    const c = (await a1("POST", "/v1/season/contests", { landId: target })).json().contest;
    // the defenders got a message and their parents an SMS (queued, quiet hours aside)
    const defenders = st.teams[defender]!.members.map((m) => m.childId);
    const { messages } = await import("@zhiyouji/db");
    const { eq, and } = await import("drizzle-orm");
    const got = await t.db.select().from(messages).where(and(eq(messages.type, "attacked"), eq(messages.dedupeKey, `attacked:${t.serverId}:${c.id}`)));
    expect(got.map((m) => m.recipientId).sort()).toEqual([...defenders].sort());
    expect(got[0]!.body).toContain("截止 2月12日 21:00");
    expect((await t.db.select().from(smsOutbox)).filter((r) => r.kind === "attack").length).toBeGreaterThan(0);
    // the attacker's own team got nothing
    expect((await msgs(a1)).some((m) => m.type === "attacked")).toBe(false);

    // reports: D0 evening … D2 noon
    t.clock.set(bj("2027-02-09", 12, 1));
    const made = await t.services.reports.runDue(t.serverId);
    expect(made).toBe(6);
    expect(await t.services.reports.runDue(t.serverId)).toBe(0); // idempotent
    const list = (await a1("GET", "/v1/season/reports")).json().reports;
    expect(list).toHaveLength(6);
    expect(list[0].title).toBe("战报 · 2月9日 12:00");
    const latest = (await a1("GET", `/v1/season/reports/${list[0].id}`)).json();
    expect(latest.lines.map((l: { text: string }) => l.text).join("|")).toContain("发起了进攻");
    expect(latest.ranking).toHaveLength(8);
    const morning2 = (await a1("GET", `/v1/season/reports/${list[1].id}`)).json();
    expect(morning2.lines.map((l: { text: string }) => l.text).some((t: string) => t.startsWith("第 1 批选地（盲拍）结果：") && t.includes("出价"))).toBe(true);
    expect((await msgs(a1)).some((m) => m.type === "report")).toBe(true);

    // broadcasts are visible at once; the team feed holds the role change
    const a2 = await t.as("13800000001", t.a2);
    const bc = (await a2("GET", "/v1/season/broadcasts")).json().lines;
    expect(bc[0].text).toContain("发起了进攻");
    const tf = (await a1("GET", "/v1/season/team-feed")).json().lines;
    expect(tf.some((l: { text: string }) => l.text.startsWith("组长变动（认领）"))).toBe(true);
    const tf2 = (await a2("GET", "/v1/season/team-feed")).json().lines as { text: string }[];
    expect(tf2.some((l) => l.text.startsWith("组长变动"))).toBe(false);
    expect(tf2.some((l) => l.text.startsWith("没有人认领组长，系统指定"))).toBe(true);

    // D2 21:00 starter items: each team sees only its own picks
    t.clock.set(bj("2027-02-10", 7, 1));
    await t.services.scheduler.runDue(t.serverId);
    await t.services.reports.runDue(t.serverId);
    const r2 = (await a2("GET", "/v1/season/reports")).json().reports[0];
    const lines2 = (await a2("GET", `/v1/season/reports/${r2.id}`)).json().lines as { kind: string; data: { allocations: { teamId: string }[] } }[];
    const starter = lines2.filter((l) => l.kind === "starter_items");
    const a2Team = (await a2("GET", "/v1/season/me")).json().team.id;
    expect(starter).toHaveLength(1);
    expect(starter[0]!.data.allocations.every((a) => a.teamId === a2Team)).toBe(true);
    await t.close();
  });
});

describe("submission reminders (part 8 §1.2)", () => {
  it("3 hours before a preference deadline, leaders of teams that have not submitted get a message once", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    t.clock.set(bj("2027-02-08", 17, 30));
    expect(await t.services.reminders.runDue(t.serverId)).toBe(0);
    // a1's team submits; at 18:30 the other 7 teams (no leaders yet → every member) are reminded
    await a1("POST", "/v1/season/rounds/blind_auction", { bid: 0, prefs: ["E1"] });
    t.clock.set(bj("2027-02-08", 18, 30));
    const sent = await t.services.reminders.runDue(t.serverId);
    expect(sent).toBe(16 - (await a1("GET", "/v1/season/me")).json().members.length);
    expect(await t.services.reminders.runDue(t.serverId)).toBe(0);
    const a2 = await t.as("13800000001", t.a2);
    const m = (await a2("GET", "/v1/messages")).json().messages.find((x: { type: string }) => x.type === "submit_due");
    expect(m.body).toBe("本组还没提交第 1 批选地（盲拍）的出价和偏好，2月8日 21:00 截止。");
    expect((await a1("GET", "/v1/messages")).json().messages.some((x: { type: string }) => x.type === "submit_due")).toBe(false);
    await t.close();
  });
});

describe("首页 (part 5 §4) and 组长待办 (E2)", () => {
  it("leader: 战况 with the contest, today's list sorted by deadline, the calendar strip; the defender's team sees it as urgent", async () => {
    const t = await contestSetup(); // D2 10:00: a1 leads and has attacked
    const h = (await t.a1api("GET", "/v1/home")).json();
    expect(h.status).toBe("playing");
    expect(h.season.day).toBe(2);
    expect(h.battle.contests).toHaveLength(1);
    expect(h.battle.contests[0]).toMatchObject({ id: t.contestId, role: "attacker", urgent: false });
    expect(h.battle.lands.map((l: { id: string }) => l.id)).toContain("E1");
    const kinds = h.todo.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("daily");
    expect(kinds).toContain("work");
    const daily = h.todo.find((x: { kind: string }) => x.kind === "daily");
    expect(daily).toMatchObject({ title: "每日任务（今天已计 0/2）", done: false, deadline: +bj("2027-02-10", 0) });
    const work = h.todo.find((x: { kind: string }) => x.kind === "work");
    expect(work.link).toBe(`/season/works/${encodeURIComponent(`contest:${t.contestId}`)}`);
    // undone first, then by deadline
    const open = h.todo.filter((x: { done: boolean }) => !x.done).map((x: { deadline: number | null }) => x.deadline ?? Infinity);
    expect([...open].sort((a, b) => a - b)).toEqual(open);
    expect(h.counts.worksPending).toBe(1);
    expect(h.upcoming.length).toBeGreaterThan(0);
    expect(h.nextPublication).toBeGreaterThan(+t.clock.now());

    // someone on the defending team: urgent, with the defence work in the list
    const st = await t.services.store.state(t.serverId);
    const defenderChild = st.teams[t.defender]!.members[0]!.childId;
    const dh = await t.services.home.home(defenderChild);
    expect(dh.status).toBe("playing");
    const d = dh as Extract<typeof dh, { status: "playing" }>;
    expect(d.battle.contests[0]).toMatchObject({ role: "defender", urgent: true });
    expect(d.todo.some((x) => x.kind === "work" && x.title.includes("守方"))).toBe(true);
    // b1 is a plain member of a1's team: no leader-only items
    const b = await t.services.home.home(t.b1);
    expect(b.todo.every((x) => !x.leaderOnly)).toBe(true);
    await t.close();
  });

  it("leader at D0 evening: the blind auction is in 组长待办 until submitted; a child without a season only has the daily task", async () => {
    const t = await playSetup();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    let h = (await a1("GET", "/v1/home")).json();
    expect(h.todo.find((x: { kind: string }) => x.kind === "round")).toMatchObject({ title: "盲拍：出价和边缘地顺序", done: false, leaderOnly: true, link: "/season/rounds/blind_auction" });
    await a1("POST", "/v1/season/rounds/blind_auction", { bid: 5, prefs: ["E1"] });
    h = (await a1("GET", "/v1/home")).json();
    expect(h.todo.find((x: { kind: string }) => x.kind === "round").done).toBe(true);
    const free = await t.family("13800000009", [{ nickname: "小芳", grade: 3 }]);
    const fh = await t.services.home.home(free.childIds[0]!);
    expect(fh.status).toBe("none");
    expect(fh.todo.map((x) => x.kind)).toEqual(["daily"]);
    // 战况精选 (part 5 §4): the live server's top three; no contest yet
    const f = (fh as { featured: { serverId: string; top: unknown[]; hotContest: unknown } }).featured;
    expect(f.serverId).toBe(t.serverId);
    expect(f.top).toHaveLength(3);
    expect(f.hotContest).toBeNull();
    await t.close();
  });
});

describe("赛季日历 (B2) and 小组公开主页 (F4)", () => {
  it("the calendar lists planned events by season day with links; a team's public page has no member names", async () => {
    const t = await contestSetup();
    const cal = (await t.a1api("GET", "/v1/season/calendar")).json();
    expect(cal.today).toBe(2);
    const d0 = cal.days.find((d: { day: number }) => d.day === 0);
    expect(d0.events.map((e: { label: string }) => e.label)).toContain("分组公布");
    const all = cal.days.flatMap((d: { events: { label: string; link: string | null }[] }) => d.events);
    expect(all.find((e: { label: string }) => e.label === "第 1 周周战争配对").link).toBe("/season/wars/1");
    expect(all.some((e: { label: string }) => e.label === "商店开门")).toBe(true);
    expect(all.some((e: { label: string }) => e.label === "大团战作品截止")).toBe(true);

    const page = (await t.a1api("GET", `/v1/watch/${t.serverId}/teams/${t.defender}`)).json();
    const st = await t.services.store.state(t.serverId);
    expect(page.name).toBe(st.teams[t.defender]!.name);
    expect(page.lands.length).toBeGreaterThan(0);
    expect(page.grades.reduce((n: number, g: { count: number }) => n + g.count, 0)).toBe(st.teams[t.defender]!.members.length);
    expect(JSON.stringify(page)).not.toMatch(/nickname|childId|items/);
    await t.close();
  });
});

describe("异常提醒 (part 8 §3.4)", () => {
  it("attacking a land of the team a brother or sister is in tells the admins", async () => {
    const t = await playSetup();
    await t.adminUser();
    t.clock.set(bj("2027-02-07", 19, 1));
    await t.services.scheduler.runDue(t.serverId);
    const a1 = await t.as("13800000001", t.a1);
    await a1("POST", "/v1/season/roles/claim", { role: "leader" });
    const st = await t.services.store.state(t.serverId);
    const team2 = st.teamOrder.find((id) => st.teams[id]!.members.some((m) => m.childId === t.a2))!;
    await t.services.control.intervene(t.serverId, { action: "set_land_owner", landId: "E3", teamId: team2, reason: "测试" }, "admin:test");
    t.clock.set(bj("2027-02-09", 10));
    const r = await a1("POST", "/v1/season/contests", { landId: "E3" });
    expect(r.statusCode).toBe(200);
    const msgs = await t.db.select().from(messages).where(eq(messages.type, "sibling_contest"));
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.body).toContain("二毛");
    await t.close();
  });
});
