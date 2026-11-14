import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ConfigProvider } from "antd-mobile";
import { dailySubmissions, knowledgeCards } from "@zhiyouji/db";
import { App } from "../src/App";
import { startBackend } from "./backend";
import { recorder } from "../src/platform/recorder";

const TEXT = "我今天用AI学了大气压。原来我以为空气没有重量，后来懂了空气也有重量会压在我们身上。我自己想到的例子是用吸管喝饮料，其实是外面的大气把饮料压进嘴里。";

describe("student website: 每日任务 (part 5 C1–C3)", () => {
  it("首页 → 去修行 → template → evidence + explanation + AI line → passed with a knowledge card", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "text" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    const user = userEvent.setup();
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    await user.click(await screen.findByText("去修行"));
    await user.click(await screen.findByText("用 AI 学了一个新知识"));
    expect(await screen.findByText(/和 AI 对话的截图/)).toBeTruthy();

    // the page checks before sending anything
    await user.click(screen.getByRole("button", { name: "交上去" }));
    expect((await screen.findByRole("alert")).textContent).toBe("至少交一张证据图片");

    await user.upload(screen.getByLabelText("选图片或拍照"), new File(["jpg"], "chat.jpg", { type: "image/jpeg" }));
    await user.type(screen.getByPlaceholderText("写 50–150 个字"), TEXT);
    await user.type(screen.getByPlaceholderText("一句话就好"), "我让 AI 举了三个例子");
    await user.click(screen.getByRole("button", { name: "交上去" }));

    expect(await screen.findByText("审核结果")).toBeTruthy();
    expect(await screen.findByText(/做得好的/)).toBeTruthy();
    expect(screen.getByText("已经记进修行日志")).toBeTruthy();
    const [card] = await be.db.select().from(knowledgeCards);
    expect(screen.getByText(card!.title)).toBeTruthy();

    // C7: the card in the journal, with the child's own explanation
    await user.click(screen.getByText("在修行日志里看这张卡片"));
    expect(await screen.findByText("我当时的讲解")).toBeTruthy();
    expect(screen.getAllByText(TEXT).length).toBeGreaterThan(0);
    expect(screen.getByAltText("证据图片")).toBeTruthy();
    await be.stop();
  });

  it("not passed → 改一改再交 starts from the last hand-in (text, AI line, pictures) and says how many tries are left", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "text" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    const user = userEvent.setup();
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/daily/new/1"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    const first = TEXT.replace("其实", "不通过其实"); // the fake AI fails texts with "不通过"
    await user.upload(await screen.findByLabelText("选图片或拍照"), new File(["jpg"], "chat.jpg", { type: "image/jpeg" }));
    await user.type(screen.getByPlaceholderText("写 50–150 个字"), first);
    await user.type(screen.getByPlaceholderText("一句话就好"), "我让 AI 举了三个例子");
    await user.click(screen.getByRole("button", { name: "交上去" }));
    expect(await screen.findByText("还差一点")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "改一改再交" }));
    const box = (await screen.findByDisplayValue(first)) as HTMLTextAreaElement;
    expect(screen.getByDisplayValue("我让 AI 举了三个例子")).toBeTruthy();
    expect(await screen.findByText("没有选新图片时，沿用上次的 1 张证据图片。")).toBeTruthy();
    await user.clear(box);
    await user.type(box, TEXT);
    await user.click(screen.getByRole("button", { name: "交上去" }));
    expect(await screen.findByText(/做得好的/)).toBeTruthy();
    const subs = await be.db.select().from(dailySubmissions);
    expect(subs.map((x) => x.status).sort()).toEqual(["failed", "passed"]);
    expect(subs[0]!.evidenceFileIds).toEqual(subs[1]!.evidenceFileIds);
    await be.stop();
  });

  it("修行日志: calendar month, subjects, search, summaries (C4–C8)", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "text" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    const sub = await be.db.insert(dailySubmissions).values({ childId: c.id, templateId: 1, day: "2027-01-04", status: "passed", evidenceFileIds: [], explainKind: "text", explainText: TEXT, grade: 5, submittedAt: new Date() }).returning();
    await be.db.insert(knowledgeCards).values({ childId: c.id, submissionId: sub[0]!.id, title: "大气压", summary: "空气有重量", tag: "物理与工程/力学", day: "2027-01-04", createdAt: new Date() });
    const user = userEvent.setup();
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/journal?tab=search"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    await user.type(await screen.findByPlaceholderText("找以前的卡片"), "大气{Enter}");
    expect(await screen.findByText("大气压")).toBeTruthy();
    await user.click(screen.getByText("领域", { selector: ".adm-tabs-tab" }));
    expect(await screen.findByText("一共 1 张知识卡片")).toBeTruthy();
    await user.click(screen.getByText("小结", { selector: ".adm-tabs-tab" }));
    expect(await screen.findByText("还没有小结")).toBeTruthy();
    await be.stop();
  });
});

describe("讲解录音 (part 5 §3.1 step 4)", () => {
  it("hold to talk, release, play back, hand in a voice explanation", async () => {
    const be = await startBackend();
    await be.services.family.requestCode("13812345678", undefined);
    const login = await be.services.family.login("13812345678", be.sms.lastCode("13812345678")!);
    await be.services.family.consent(login.family.id, "agree", be.cfg.policyVersion);
    const c = await be.services.family.createChild(login.family.id, { nickname: "小明", grade: 5, avatar: "a1", explainPref: "voice" });
    await be.services.sessions.setChild((await be.db.query.sessions.findFirst())!.id, c.id);
    const realFetch = be.fetchMock.getMockImplementation()!;
    be.fetchMock.mockImplementation((input, init = {}) => realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${login.token}` } }));
    localStorage.setItem("zyj_privacy_notice", "2027-01");
    vi.spyOn(recorder, "supported").mockReturnValue(true);
    vi.spyOn(recorder, "start").mockResolvedValue();
    vi.spyOn(recorder, "stop").mockResolvedValue({ blob: new Blob(["voice"], { type: "audio/webm;codecs=opus" }), mimeType: "audio/webm;codecs=opus", durationMs: 12_000 });
    const user = userEvent.setup();
    render(
      <ConfigProvider>
        <MemoryRouter initialEntries={["/daily/new/1"]}>
          <App />
        </MemoryRouter>
      </ConfigProvider>,
    );
    const hold = await screen.findByRole("button", { name: "按住说话" });
    fireEvent.pointerDown(hold);
    const release = await screen.findByRole("button", { name: "松开结束" });
    fireEvent.pointerUp(release);
    expect(await screen.findByText("录好了，12 秒")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重录" })).toBeTruthy();
    await user.upload(screen.getByLabelText("选图片或拍照"), new File(["jpg"], "chat.jpg", { type: "image/jpeg" }));
    await user.type(screen.getByPlaceholderText("一句话就好"), "我让 AI 举了三个例子");
    await user.click(screen.getByRole("button", { name: "交上去" }));
    expect(await screen.findByText("审核结果")).toBeTruthy();
    const [sub] = await be.db.select().from(dailySubmissions);
    expect(sub!.explainKind).toBe("voice");
    expect(sub!.explainFileId).toBeTruthy();
    vi.restoreAllMocks();
    await be.stop();
  });
});
