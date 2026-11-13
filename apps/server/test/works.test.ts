import { describe, expect, it } from "vitest";
import { bj } from "./helpers.js";
import { contestSetup } from "./seasonHelpers.js";

describe("作品工坊: uploads, materials, submitting (part 5 E4, §3.3)", () => {
  it("upload straight to storage, add to the material box, the leader submits versions until the deadline", async () => {
    const t = await contestSetup();
    const a1 = t.a1api;
    const slot = `contest:${t.contestId}`;
    const slots = (await a1("GET", "/v1/season/works")).json().slots;
    expect(slots).toEqual([expect.objectContaining({ slot, kind: "contest", open: true, role: "attacker", submitted: null })]);

    // a member (b1 shares the team) uploads a video
    const b1 = await t.as("13800000002", t.b1);
    expect((await b1("POST", "/v1/season/uploads", { kind: "video", contentType: "application/zip", size: 10 })).json().error).toBe("file_type");
    expect((await b1("POST", "/v1/season/uploads", { kind: "image", contentType: "image/png", size: 30 * 1024 * 1024 })).json().error).toBe("file_too_big");
    const up = (await b1("POST", "/v1/season/uploads", { kind: "video", contentType: "video/mp4", size: 11, filename: "讲解.mp4" })).json();
    expect(up.upload.method).toBe("PUT");
    // not there yet
    expect((await b1("POST", `/v1/season/uploads/${up.fileId}/complete`)).json().error).toBe("upload_missing");
    const put = await t.app.inject({ method: "PUT", url: up.upload.url, payload: Buffer.from("hello video"), headers: { "content-type": "video/mp4" } });
    expect(put.statusCode).toBe(200);
    // a forged URL is refused
    expect((await t.app.inject({ method: "PUT", url: up.upload.url.replace(/sig=[0-9a-f]+/, "sig=00"), payload: Buffer.from("x"), headers: { "content-type": "video/mp4" } })).statusCode).toBe(403);
    expect((await b1("POST", `/v1/season/uploads/${up.fileId}/complete`)).json().file).toMatchObject({ status: "uploaded", kind: "video" });
    const url = (await a1("GET", `/v1/season/files/${up.fileId}/url`)).json().url;
    expect((await t.app.inject({ method: "GET", url })).body).toBe("hello video");

    await b1("POST", `/v1/season/works/${slot}/materials`, { fileId: up.fileId });
    await b1("POST", `/v1/season/works/${slot}/materials`, { text: "我们打算用弹簧比喻大气压" });
    const mats = (await a1("GET", `/v1/season/works/${slot}/materials`)).json().materials;
    expect(mats).toHaveLength(2);
    expect(mats[0].file).toMatchObject({ id: up.fileId, filename: "讲解.mp4" });

    // only the leader or deputy submits; members must be in the team; media must match
    const body = { mediaKind: "video", fileIds: [up.fileId], text: "说明", aiNote: "用 AI 查了资料", members: [t.a1, t.b1] };
    expect((await b1("POST", `/v1/season/works/${slot}`, body)).json().error).toBe("not_leader");
    expect((await a1("POST", `/v1/season/works/${slot}`, { ...body, members: [t.a2] })).json().error).toBe("bad_members");
    expect((await a1("POST", `/v1/season/works/${slot}`, { ...body, mediaKind: "audio" })).json().error).toBe("media_mismatch");
    expect((await a1("POST", `/v1/season/works/${slot}`, body)).json().work).toMatchObject({ version: 1, members: [t.a1, t.b1] });
    expect((await a1("POST", `/v1/season/works/${slot}`, { mediaKind: "text", text: "改成文字版", members: [t.a1] })).json().work.version).toBe(2);
    const v = (await b1("GET", `/v1/season/works/${slot}/versions`)).json().works;
    expect(v.map((w: { version: number }) => w.version)).toEqual([2, 1]);
    expect((await a1("GET", "/v1/season/works")).json().slots[0].submitted.version).toBe(2);

    // the other team cannot see or use this slot or file
    const a2 = await t.as("13800000001", t.a2);
    expect((await a2("GET", `/v1/season/works/${slot}/materials`)).json().error).toBe("no_slot");
    expect((await a2("GET", `/v1/season/files/${up.fileId}/url`)).statusCode).toBe(404);

    // after the deadline (day 3 21:00) nothing more is accepted
    t.clock.set(bj("2027-02-12", 21, 1));
    expect((await a1("POST", `/v1/season/works/${slot}`, body)).json().error).toBe("too_late");
    expect((await a1("GET", "/v1/season/works")).json().slots[0].open).toBe(false);
    await t.close();
  });
});
