import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { children, families } from "@zhiyouji/db";
import { flatten, patchFrom } from "../src/pages/SeasonSetupPages";
import { startBackend } from "./backend";
import { account, login, renderConsole } from "./helpers";

describe("admin console: 赛季 and 玩家与分组 (part 7 §2–§3)", () => {
  it("parameter rows flatten and patch back", () => {
    expect(flatten({ a: { b: 1, c: [1, 2] }, d: true })).toEqual([
      { path: "a.b", value: 1 },
      { path: "a.c", value: [1, 2] },
      { path: "d", value: true },
    ]);
    expect(patchFrom({ "items.zijin.pts": 6, "time.shopOpenDay": 14 })).toEqual({ items: { zijin: { pts: 6 } }, time: { shopOpenDay: 14 } });
  });

  it("open enrollment, enable a child found by nickname, generate and confirm the grouping, change a parameter", async () => {
    const be = await startBackend();
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) {
      const [f] = await be.db.insert(families).values({ phone: `1390000${2000 + i}`, consentVersion: be.cfg.policyVersion }).returning();
      const [c] = await be.db.insert(children).values({ familyId: f!.id, nickname: i === 0 ? "小乌龟" : `孩子${i}`, grade: 1 + (i % 9) }).returning();
      ids.push(c!.id);
    }
    const s = await be.services.seasons.create({ name: "第三季", opening: "2027-01-10", seed: 4 }, "admin:test");
    const { secret } = await account(be, "boss@example.com", "admin");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderConsole(`/season/${s.id}`);
    await login(be, user, "boss@example.com", secret);
    await user.click(await screen.findByRole("button", { name: "开放报名" }));
    await waitFor(async () => expect((await be.services.seasons.season(s.id)).status).toBe("enrolling"));
    await be.services.seasons.enroll(s.id, ids.slice(1).map((childId) => ({ childId })), "admin:test");

    // parameters: change one number with a note
    const zijin = await screen.findByLabelText("items.zijin.pts");
    await user.clear(zijin);
    await user.type(zijin, "6");
    await user.type(screen.getByPlaceholderText("为什么改（进版本记录）"), "试运行调低");
    await user.click(screen.getByRole("button", { name: /保存为新版本（改了 1 项）/ }));
    await waitFor(async () => expect((await be.services.seasons.params(s.id)).params.items.zijin.pts).toBe(6));

    // 开营前检查: not ready yet, and says why
    await user.click(screen.getByRole("tab", { name: "开营前检查" }));
    expect(await screen.findByText(/还不能开营/)).toBeTruthy();
    expect(await screen.findByText("还没生成分组")).toBeTruthy();
    expect(screen.getByText(/和默认值不同的 1 项：items.zijin.pts/)).toBeTruthy();

    // 玩家与分组
    await user.click(screen.getByText("玩家与分组 →"));
    await user.type(await screen.findByPlaceholderText("家长手机号或孩子昵称"), "小乌龟{Enter}");
    const row = (await screen.findByText("小乌龟")).closest("tr")!;
    await user.type(within(row).getByLabelText("小乌龟缴费备注"), "已转账");
    await user.click(within(row).getByRole("button", { name: "开 通" }));
    await waitFor(async () => expect((await be.services.seasons.roster(s.id)).find((r) => r.childId === ids[0])?.paymentNote).toBe("已转账"));

    // 报名名单: an enrolled child can be revoked before the grouping is locked (part 7 §3)
    await user.click(screen.getByRole("tab", { name: "报名名单" }));
    const rosterRow = (await screen.findAllByText("小乌龟")).map((x) => x.closest("tr")!).find((tr) => within(tr).queryByRole("button", { name: /撤\s?销/ }));
    expect(rosterRow).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "分组" }));
    await user.click(await screen.findByRole("button", { name: "生成分组" }));
    expect((await screen.findAllByText(/2 人 · 平均/)).length).toBe(8);
    await user.click(screen.getByRole("button", { name: "确认并锁定" }));
    await user.click((await screen.findAllByRole("button", { name: "确 认" })).at(-1)!);
    await waitFor(async () => expect((await be.services.seasons.season(s.id)).groupingLockedAt).not.toBeNull());
    expect(await screen.findByText(/小组微信群二维码/)).toBeTruthy();
    await be.stop();
  });
});
