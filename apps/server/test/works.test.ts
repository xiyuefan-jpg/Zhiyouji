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

describe("big files go up in parts and resume after a break (part 2 §4.5, part 5 §5)", () => {
  it("multipart: parts, a broken upload resumes with the missing parts, the server joins them and checks the size", async () => {
    const t = await contestSetup();
    t.cfg.uploads.multipart = { from: 10, partSize: 4 };
    const a1 = t.a1api;
    const bytes = Buffer.from("0123456789abc"); // 13 bytes → parts of 4, 4, 4, 1
    const up = (await a1("POST", "/v1/season/uploads", { kind: "video", contentType: "video/mp4", size: bytes.length, filename: "大视频.mp4" })).json();
    expect(up.upload).toBeUndefined();
    expect(up.multipart).toEqual({ partSize: 4, parts: 4 });
    const put = async (n: number, b: Buffer) => {
      const r = (await a1("POST", `/v1/season/uploads/${up.fileId}/parts`, { partNumbers: [n] })).json();
      return t.app.inject({ method: "PUT", url: r.parts[0].url, payload: b, headers: { "content-type": "application/octet-stream" } });
    };
    expect((await put(1, bytes.subarray(0, 4))).statusCode).toBe(200);
    expect((await put(3, bytes.subarray(8, 12))).statusCode).toBe(200);
    expect((await put(2, bytes.subarray(4, 6))).statusCode).toBe(200); // the connection broke halfway: a short part
    // the network came back (or the page was opened again): what is already there?
    expect((await a1("GET", `/v1/season/uploads/${up.fileId}/parts`)).json()).toEqual({ partSize: 4, parts: 4, done: [1, 3], complete: false });
    const early = (await a1("POST", `/v1/season/uploads/${up.fileId}/complete`)).json();
    expect(early).toMatchObject({ error: "upload_missing", missing: [2, 4] });
    // a tampered URL is refused
    const r = (await a1("POST", `/v1/season/uploads/${up.fileId}/parts`, { partNumbers: [2] })).json();
    expect((await t.app.inject({ method: "PUT", url: r.parts[0].url.replace("part=2", "part=4"), payload: Buffer.from("x") })).statusCode).toBe(403);
    expect((await a1("POST", `/v1/season/uploads/${up.fileId}/parts`, { partNumbers: [5] })).statusCode).toBe(400);
    await put(2, bytes.subarray(4, 8));
    await put(4, bytes.subarray(12));
    const done = (await a1("POST", `/v1/season/uploads/${up.fileId}/complete`)).json();
    expect(done.file).toMatchObject({ status: "uploaded", size: 13 });
    const url = (await a1("GET", `/v1/season/files/${up.fileId}/url`)).json().url;
    expect((await t.app.inject({ method: "GET", url })).rawPayload.toString()).toBe("0123456789abc");
    expect((await a1("GET", `/v1/season/uploads/${up.fileId}/parts`)).json().complete).toBe(true);
    expect((await a1("POST", `/v1/season/uploads/${up.fileId}/parts`, { partNumbers: [1] })).json().error).toBe("already_uploaded");
    await t.close();
  });
});
