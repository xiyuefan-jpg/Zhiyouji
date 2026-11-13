import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dailySubmissions, files, knowledgeCards, landTemplates, lands, messages, works } from "@zhiyouji/db";
import type { FakeMediaProcessor, ScoreRequest } from "../src/index.js";
import { bj, setup } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

type Call = (m: "GET" | "POST", url: string, body?: unknown) => Promise<{ json: () => any; statusCode: number }>;

async function upload(t: { app: { inject: (o: object) => Promise<{ statusCode: number }> } }, call: Call, prefix: string, kind: string, contentType: string, filename: string): Promise<string> {
  const up = (await call("POST", `${prefix}/uploads`, { kind, contentType, size: 4, filename })).json();
  await t.app.inject({ method: "PUT", url: up.upload.url, payload: Buffer.from("data"), headers: { "content-type": contentType } });
  await call("POST", `${prefix}/uploads/${up.fileId}/complete`);
  return up.fileId as string;
}

describe("getting uploads ready for the AI (part 6 §2, T1–T3)", () => {
  it("a voice explanation is transcribed before the daily review; the card comes from the transcript", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const media = t.services.mediaProcessor as FakeMediaProcessor;
    const f = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
    const call: Call = (m, url, body) => t.call(m, url, body, f.token);
    const pic = await upload(t, call, "/v1/daily", "image", "image/jpeg", "a.jpg");
    const voice = await upload(t, call, "/v1/daily", "audio", "audio/webm", "voice.webm");
    media.texts.set(voice, "我学了大气压，吸管喝饮料就是外面的空气把饮料压进嘴里。");
    const r = (await call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "voice", fileId: voice }, aiNote: "让 AI 举例子" })).json();
    expect(r.status).toBe("passed");
    const [file] = await t.db.select().from(files).where(eq(files.id, voice));
    expect(file).toMatchObject({ status: "processed", transcript: "我学了大气压，吸管喝饮料就是外面的空气把饮料压进嘴里。", durationSec: 30 });
    const [card] = await t.db.select().from(knowledgeCards);
    expect(card!.summary).toContain("吸管");
    // the evidence picture is marked processed by the worker's pass
    await t.services.media.runDue();
    expect((await t.db.select().from(files).where(eq(files.id, pic)))[0]!.status).toBe("processed");
    await t.close();
  });

  it("a file that cannot be transcribed: the review waits and retries; after 3 failures the admins hear and the review goes on", async () => {
    const t = await setup(bj("2027-03-10", 16));
    const media = t.services.mediaProcessor as FakeMediaProcessor;
    await t.adminUser();
    const f = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    await t.call("POST", "/v1/session/child", { childId: f.childIds[0] }, f.token);
    const call: Call = (m, url, body) => t.call(m, url, body, f.token);
    const pic = await upload(t, call, "/v1/daily", "image", "image/jpeg", "a.jpg");
    const voice = await upload(t, call, "/v1/daily", "audio", "audio/webm", "bad.webm");
    media.failing.add(voice);
    const r = (await call("POST", "/v1/daily/submissions", { templateId: 1, evidenceFileIds: [pic], explain: { kind: "voice", fileId: voice }, aiNote: "让 AI 举例子" })).json();
    expect(r.status).toBe("reviewing");
    for (let i = 0; i < 3; i++) {
      t.clock.advance(31 * 60_000);
      await t.services.daily.runDue();
    }
    const [file] = await t.db.select().from(files).where(eq(files.id, voice));
    expect(file).toMatchObject({ status: "failed", processAttempts: 3 });
    expect((await t.db.select().from(dailySubmissions))[0]!.status).not.toBe("reviewing");
    expect((await t.db.select().from(messages)).some((m) => m.type === "media_failed")).toBe(true);
    await t.close();
  });

  it("a video in a team work: transcript and key frames are ready for the AI's first score", async () => {
    const t = await contestSetup();
    const call: Call = (m, url, body) => t.a1api(m as "GET", url, body);
    const video = await upload(t, call, "/v1/season", "video", "video/mp4", "work.mp4");
    const seen: ScoreRequest[] = [];
    const ai = t.services.ai as { score: (r: ScoreRequest) => Promise<unknown> };
    const orig = ai.score.bind(ai);
    ai.score = async (r) => (seen.push(r), orig(r));
    await t.a1api("POST", `/v1/season/works/contest:${t.contestId}`, { mediaKind: "video", fileIds: [video], text: "我们的视频", members: [t.a1] });
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    const [file] = await t.db.select().from(files).where(eq(files.id, video));
    expect(file!.status).toBe("processed");
    expect((file!.frames as string[]).length).toBe(3);
    const mine = seen.find((r) => r.text === "我们的视频")!;
    expect(mine.transcript).toBe("（语音转写）work.mp4");
    expect(mine.images).toHaveLength(3);
    await t.close();
  });
});

describe("作品知识标签 (part 6 T7)", () => {
  it("the AI's first score tags the work inside its land's subject, with a difficulty level", async () => {
    const t = await contestSetup({ seedBank: true });
    const slots = (await t.a1api("GET", "/v1/season/works")).json().slots as { slot: string; open: boolean }[];
    const slot = slots.find((s) => s.open && s.slot.startsWith("contest:"))!.slot;
    const w = (await t.a1api("POST", `/v1/season/works/${encodeURIComponent(slot)}`, { mediaKind: "text", text: "作品", members: [t.a1] })).json().work;
    t.clock.set(bj("2027-02-12", 21, 1));
    await t.services.scoring.runDue(t.serverId);
    const [row] = await t.db.select().from(works).where(eq(works.id, w.id));
    const st = await t.services.store.state(t.serverId);
    const landRow = (await t.db.select().from(lands)).find((l) => l.serverId === t.serverId && l.code === st.contests[t.contestId]!.landId)!;
    const [tpl] = await t.db.select().from(landTemplates).where(eq(landTemplates.id, landRow.templateId!));
    const tags = row!.tags as string[];
    expect(tags.length).toBe(1);
    expect(tags[0]!.startsWith(tpl!.subject.slice(0, 2)) || tags[0]!.startsWith("其他/")).toBe(true);
    expect(row!.difficulty).toBe(3);
    await t.close();
  });
});

describe("新标签建议整理 (part 6 T10)", () => {
  it("groups last month's 其他 tags, most frequent first; the admins hear on the 1st, once", async () => {
    const t = await setup(bj("2027-04-01", 9));
    await t.adminUser();
    const f = await t.family("13500000001", [{ nickname: "小雨", grade: 4 }]);
    const childId = f.childIds[0]!;
    const add = async (tag: string, title: string, day: string) => {
      const [s] = await t.db.insert(dailySubmissions).values({ childId, templateId: 1, day, status: "passed", evidenceFileIds: [], explainKind: "text", explainText: "x", grade: 4, submittedAt: new Date() }).returning();
      await t.db.insert(knowledgeCards).values({ childId, submissionId: s!.id, title, summary: "x", tag, day, createdAt: new Date() });
    };
    await add("其他/魔方", "三阶魔方", "2027-03-02");
    await add("其他/魔方", "魔方公式", "2027-03-09");
    await add("其他/折纸", "千纸鹤", "2027-03-15");
    await add("物理与天文/力与运动", "大气压", "2027-03-15");
    await add("其他/魔方", "四月的", "2027-04-01");
    const s = await t.services.tagSuggestions.suggestions("2027-03");
    expect(s).toMatchObject({ month: "2027-03", total: 3 });
    expect(s.suggestions.map((x) => [x.name, x.count])).toEqual([["魔方", 2], ["折纸", 1]]);
    expect(await t.services.tagSuggestions.runDue()).toBe(1);
    expect(await t.services.tagSuggestions.runDue()).toBe(0);
    const msg = (await t.db.select().from(messages)).find((m) => m.type === "tag_suggestions")!;
    expect(msg.body).toContain("魔方（2）");
    await t.close();
  });
});
