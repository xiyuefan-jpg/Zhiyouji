/**
 * 赛季 (PRD part 7 §2) and 玩家与分组 (§3):
 * - seasons: list, new season (opening day is a Sunday; copy parameters from
 *   an earlier season), open enrollment, rename / move the opening day;
 * - parameters: every number of the season (part 3 §17) as an editable
 *   table; saving makes a new version with a note; the version history shows
 *   what changed;
 * - calendar: mark days as school days or rest days;
 * - players: find a child by the parent's phone or nickname, enable (with a
 *   payment note), the roster (export CSV, revoke);
 * - grouping: generate, look at servers and teams (size, average grade,
 *   siblings apart), move a child, rename a team, confirm and lock;
 * - after confirming: each team's WeChat QR code upload.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { ApiError, request } from "../api";
import { Time } from "../time";
import { downloadText, useLoad } from "../useLoad";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

interface Season {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  opening: string;
  paramVersion: number;
  groupingLocked: boolean;
}

// ---- seasons -----------------------------------------------------------------------------------------

export function SeasonsPage() {
  const nav = useNavigate();
  const list = useLoad(() => request<{ seasons: Season[] }>("GET", "/v1/admin/seasons"));
  const [form] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const create = async () => {
    const v = await form.validateFields();
    try {
      const r = await request<{ season: Season }>("POST", "/v1/admin/seasons", { name: v.name, opening: v.opening.format("YYYY-MM-DD"), ...(v.copyFrom ? { copyParamsFrom: v.copyFrom } : {}) });
      message.success("已新建（草稿）");
      setCreating(false);
      nav(`/season/${r.season.id}`);
    } catch (e) {
      message.error(errText(e));
    }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ justifyContent: "space-between", width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          赛季
        </Typography.Title>
        <Button type="primary" onClick={() => setCreating(true)}>
          新建赛季
        </Button>
      </Space>
      <Table<Season>
        rowKey="id"
        loading={list.loading}
        dataSource={list.data?.seasons ?? []}
        pagination={false}
        onRow={(s) => ({ onClick: () => nav(`/season/${s.id}`), style: { cursor: "pointer" } })}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "状态", render: (_, s) => <Tag>{s.statusLabel}</Tag> },
          { title: "开营日", dataIndex: "opening" },
          { title: "参数版本", dataIndex: "paramVersion" },
        ]}
      />
      <Modal open={creating} title="新建赛季" okText="新建" cancelText="取消" onOk={() => void create()} onCancel={() => setCreating(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "填名称" }]}>
            <Input maxLength={40} placeholder="例如：第三季" />
          </Form.Item>
          <Form.Item name="opening" label="开营日（D0，必须是周日）" rules={[{ required: true, message: "选开营日" }]}>
            <DatePicker disabledDate={(d) => d.day() !== 0} />
          </Form.Item>
          <Form.Item name="copyFrom" label="参数从哪一季复制（可不选，用默认参数）">
            <Select allowClear options={(list.data?.seasons ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export function SeasonDetailPage() {
  const { id = "" } = useParams();
  const s = useLoad(() => request<{ season: Season; servers: { id: string; name: string }[] }>("GET", `/v1/admin/seasons/${id}`), [id]);
  const d = s.data;
  const act = async (path: string, ok: string) => {
    try {
      await request("POST", `/v1/admin/seasons/${id}/${path}`);
      message.success(ok);
      s.reload();
    } catch (e) {
      message.error(errText(e));
    }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {s.error && <Alert type="error" message={s.error} />}
      {d && (
        <>
          <Space wrap align="center">
            <Typography.Title level={3} style={{ margin: 0 }}>
              {d.season.name}
            </Typography.Title>
            <Tag>{d.season.statusLabel}</Tag>
            <Typography.Text type="secondary">开营日 {d.season.opening}</Typography.Text>
            {d.season.status === "draft" && (
              <Button type="primary" onClick={() => void act("open-enrollment", "已开放报名")}>
                开放报名
              </Button>
            )}
            {d.season.status === "grouped" && !d.season.groupingLocked && (
              <Popconfirm title="退回报名中？草稿分组会作废。" onConfirm={() => void act("reopen-enrollment", "已退回报名中")}>
                <Button>重新开放报名</Button>
              </Popconfirm>
            )}
            <Link to={`/players/${id}`}>玩家与分组 →</Link>
          </Space>
          {d.servers.length > 0 && (
            <Space wrap>
              服：
              {d.servers.map((sv) => (
                <Link key={sv.id} to={`/monitor/${sv.id}`}>
                  {sv.name}
                </Link>
              ))}
            </Space>
          )}
          <Tabs
            items={[
              { key: "params", label: "参数", children: <ParamsEditor seasonId={id} /> },
              { key: "calendar", label: "日历（上学日 / 休息日）", children: <CalendarEditor opening={d.season.opening} /> },
            ]}
          />
        </>
      )}
    </Space>
  );
}

// ---- parameters ---------------------------------------------------------------------------------------

type Json = number | string | boolean | null | Json[] | { [k: string]: Json };

export function flatten(o: Json, prefix = ""): { path: string; value: Json }[] {
  if (o !== null && typeof o === "object" && !Array.isArray(o)) return Object.entries(o).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  return [{ path: prefix, value: o }];
}

export function patchFrom(changes: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let cur = out as Record<string, Json>;
    for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, Json>;
    cur[keys.at(-1)!] = value;
  }
  return out;
}

function ParamsEditor({ seasonId }: { seasonId: string }) {
  const p = useLoad(() => request<{ current: { version: number; params: Json } | null; versions: { version: number; createdBy: string; createdAt: string; note: string | null; changes: Record<string, unknown> }[] }>("GET", `/v1/admin/seasons/${seasonId}/params`), [seasonId]);
  const [edits, setEdits] = useState<Record<string, Json>>({});
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const rows = useMemo(() => (p.data?.current ? flatten(p.data.current.params) : []), [p.data]);
  const shown = rows.filter((r) => r.path.includes(filter));
  const save = async () => {
    if (!note.trim()) return void message.warning("写一句为什么改");
    try {
      const r = await request<{ version: number; changes: Record<string, unknown> }>("POST", `/v1/admin/seasons/${seasonId}/params`, { patch: patchFrom(edits), note });
      message.success(Object.keys(r.changes).length ? `已保存为第 ${r.version} 版` : "没有改动");
      setEdits({});
      setNote("");
      p.reload();
    } catch (e) {
      message.error(errText(e));
    }
  };
  const editor = (path: string, value: Json) => {
    const cur = path in edits ? edits[path]! : value;
    if (typeof value === "number") return <InputNumber aria-label={path} value={cur as number} onChange={(n) => setEdits({ ...edits, [path]: n ?? 0 })} />;
    if (typeof value === "boolean") return <Switch aria-label={path} checked={cur as boolean} onChange={(b) => setEdits({ ...edits, [path]: b })} />;
    return (
      <Input
        aria-label={path}
        style={{ width: 320 }}
        defaultValue={JSON.stringify(cur)}
        onBlur={(e) => {
          try {
            setEdits({ ...edits, [path]: JSON.parse(e.target.value) as Json });
          } catch {
            message.warning("格式不对，例如 [10, 15, 20, 25]");
          }
        }}
      />
    );
  };
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Text type="secondary">赛季开始后改参数从改的那一刻起生效；和时间有关的参数不会自动重排计划事件，请到"赛季监控 → 计划事件"里手动改时间。</Typography.Text>
      <Space wrap>
        <Input.Search placeholder="找参数，例如 zijin" allowClear onChange={(e) => setFilter(e.target.value)} style={{ width: 240 }} />
        <Input placeholder="为什么改（进版本记录）" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 320 }} />
        <Button type="primary" disabled={Object.keys(edits).length === 0} onClick={() => void save()}>
          保存为新版本（改了 {Object.keys(edits).length} 项）
        </Button>
      </Space>
      <Table size="small" rowKey="path" dataSource={shown} pagination={{ pageSize: 25 }} columns={[{ title: "参数", dataIndex: "path" }, { title: "值", render: (_, r) => editor(r.path, r.value) }]} />
      <Card size="small" title="版本记录">
        {p.data?.versions.map((v) => (
          <div key={v.version} style={{ marginBottom: 6 }}>
            <Typography.Text strong>第 {v.version} 版</Typography.Text> · <Time iso={v.createdAt} /> · {v.note ?? ""}
            {Object.keys(v.changes).length > 0 && <Typography.Text type="secondary"> · 改了：{Object.keys(v.changes).join("、")}</Typography.Text>}
          </div>
        ))}
      </Card>
    </Space>
  );
}

function CalendarEditor({ opening }: { opening: string }) {
  const from = opening;
  const to = dayjs(opening).add(40, "day").format("YYYY-MM-DD");
  const cal = useLoad(() => request<{ days: { day: string; kind: string; note: string | null; source: string }[] }>("GET", `/v1/admin/calendar?from=${from}&to=${to}`), [from]);
  const kindOf = new Map((cal.data?.days ?? []).map((d) => [d.day, d.kind]));
  const days = Array.from({ length: 41 }, (_, i) => dayjs(opening).add(i, "day"));
  const set = async (day: string, kind: "school" | "rest" | null) => {
    try {
      await request("POST", `/v1/admin/calendar/${day}`, { kind });
      cal.reload();
    } catch (e) {
      message.error(errText(e));
    }
  };
  return (
    <Table
      size="small"
      rowKey={(d) => d.format("YYYY-MM-DD")}
      dataSource={days}
      pagination={false}
      columns={[
        { title: "第几天", render: (_, _d, i) => `D${i}` },
        { title: "日期", render: (_, d) => `${d.format("M月D日")} 周${"日一二三四五六"[d.day()]}` },
        {
          title: "类型",
          render: (_, d) => {
            const k = kindOf.get(d.format("YYYY-MM-DD"));
            const auto = d.day() === 0 || d.day() === 6 ? "休息日" : "上学日";
            return k ? <Tag color={k === "rest" ? "green" : "blue"}>{k === "rest" ? "休息日" : "上学日"}（手动）</Tag> : <Typography.Text type="secondary">{auto}（默认）</Typography.Text>;
          },
        },
        {
          title: "",
          render: (_, d) => {
            const day = d.format("YYYY-MM-DD");
            return (
              <Space>
                <Button size="small" onClick={() => void set(day, "school")}>
                  设为上学日
                </Button>
                <Button size="small" onClick={() => void set(day, "rest")}>
                  设为休息日
                </Button>
                {kindOf.has(day) && (
                  <Button size="small" type="link" onClick={() => void set(day, null)}>
                    恢复默认
                  </Button>
                )}
              </Space>
            );
          },
        },
      ]}
    />
  );
}

// ---- 玩家与分组 (§3) -------------------------------------------------------------------------------------

const PLAYER_STATUS: Record<string, string> = { enrolled: "已开通", revoked: "已撤销", withdrawn: "已退赛" };

interface ChildHit {
  childId: string;
  nickname: string;
  gradeLabel?: string;
  grade: number;
  phoneMasked: string;
}

interface RosterRow {
  childId: string;
  nickname: string;
  gradeLabel: string;
  phone: string;
  status: string;
  paymentNote: string | null;
  server: string | null;
  team: string | null;
}

interface Grouping {
  locked: boolean;
  generatedAt: string;
  servers: { name: string; teams: { name: string; size: number; averageGrade: number; members: { childId: string; nickname: string; gradeLabel: string }[] }[] }[];
  siblingConflicts: { server: number; team: number; childIds: string[] }[];
}

export function PlayersPage() {
  const { seasonId } = useParams();
  const nav = useNavigate();
  const seasons = useLoad(() => request<{ seasons: Season[] }>("GET", "/v1/admin/seasons"));
  const season = seasons.data?.seasons.find((s) => s.id === seasonId);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        玩家与分组
      </Typography.Title>
      <Select aria-label="选赛季" placeholder="选赛季" style={{ width: 240 }} value={seasonId} onChange={(id) => nav(`/players/${id}`)} options={(seasons.data?.seasons ?? []).map((s) => ({ value: s.id, label: `${s.name}（${s.statusLabel}）` }))} />
      {season && (
        <Tabs
          items={[
            { key: "enable", label: "开通资格", children: <EnablePlayers season={season} /> },
            { key: "roster", label: "报名名单", children: <Roster season={season} /> },
            { key: "grouping", label: "分组", children: <GroupingEditor season={season} onLocked={seasons.reload} /> },
          ]}
        />
      )}
    </Space>
  );
}

function EnablePlayers({ season }: { season: Season }) {
  const [q, setQ] = useState("");
  const hits = useLoad(() => (q ? request<{ children: ChildHit[] }>("GET", `/v1/admin/children?q=${encodeURIComponent(q)}`) : Promise.resolve({ children: [] })), [q]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Who is already enabled, so the search shows it instead of a second 开通 button.
  const roster = useLoad(() => request<{ players: RosterRow[] }>("GET", `/v1/admin/seasons/${season.id}/players`), [season.id]);
  const enrolled = new Set((roster.data?.players ?? []).filter((p) => p.status === "enrolled").map((p) => p.childId));
  const enable = async (ids: string[]) => {
    try {
      await request("POST", `/v1/admin/seasons/${season.id}/players`, { players: ids.map((childId) => ({ childId, ...(notes[childId] ? { paymentNote: notes[childId] } : {}) })) });
      roster.reload();
      message.success(`已开通 ${ids.length} 人`);
    } catch (e) {
      message.error(errText(e));
    }
  };
  if (season.status !== "enrolling") return <Alert type="info" message={`现在是"${season.statusLabel}"，只有"报名中"可以开通资格。`} />;
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Input.Search placeholder="家长手机号或孩子昵称" enterButton="找" onSearch={(v) => setQ(v.trim())} style={{ width: 360 }} />
      <Table<ChildHit>
        rowKey="childId"
        size="small"
        dataSource={hits.data?.children ?? []}
        pagination={false}
        locale={{ emptyText: q ? "没有找到" : "先搜索" }}
        columns={[
          { title: "昵称", dataIndex: "nickname" },
          { title: "年级", render: (_, c) => c.gradeLabel ?? c.grade },
          { title: "家长手机号", dataIndex: "phoneMasked" },
          { title: "缴费备注", render: (_, c) => <Input size="small" aria-label={`${c.nickname}缴费备注`} value={notes[c.childId] ?? ""} onChange={(e) => setNotes({ ...notes, [c.childId]: e.target.value })} /> },
          {
            title: "",
            render: (_, c) =>
              enrolled.has(c.childId) ? (
                <Tag color="green">已开通</Tag>
              ) : (
                <Button size="small" type="primary" onClick={() => void enable([c.childId])}>
                  开通
                </Button>
              ),
          },
        ]}
      />
    </Space>
  );
}

function Roster({ season }: { season: Season }) {
  const r = useLoad(() => request<{ players: RosterRow[] }>("GET", `/v1/admin/seasons/${season.id}/players`), [season.id]);
  const revoke = (childId: string) => {
    let reason = "";
    Modal.confirm({
      title: "撤销开通？",
      content: <Input aria-label="撤销原因" placeholder="原因" onChange={(e) => (reason = e.target.value)} />,
      okText: "撤销",
      cancelText: "取消",
      onOk: async () => {
        try {
          await request("POST", `/v1/admin/seasons/${season.id}/players/${childId}/revoke`, { reason: reason.trim() || "管理员撤销" });
          r.reload();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <Typography.Text>共 {r.data?.players.filter((p) => p.status !== "revoked").length ?? 0} 人</Typography.Text>
        <Button onClick={() => void downloadText(`/v1/admin/seasons/${season.id}/players.csv`, `${season.name}-报名名单.csv`).catch((e) => message.error(errText(e)))}>导出 CSV</Button>
      </Space>
      <Table<RosterRow>
        rowKey="childId"
        size="small"
        loading={r.loading}
        dataSource={r.data?.players ?? []}
        pagination={{ pageSize: 50 }}
        columns={[
          { title: "昵称", dataIndex: "nickname" },
          { title: "年级", dataIndex: "gradeLabel" },
          { title: "状态", dataIndex: "status", render: (st: string) => PLAYER_STATUS[st] ?? st },
          { title: "缴费备注", dataIndex: "paymentNote" },
          { title: "服 / 组", render: (_, p) => (p.server ? `${p.server} / ${p.team}` : "—") },
          {
            title: "",
            render: (_, p) =>
              p.status === "enabled" &&
              !season.groupingLocked && (
                <Button size="small" danger onClick={() => revoke(p.childId)}>
                  撤销
                </Button>
              ),
          },
        ]}
      />
    </Space>
  );
}

function GroupingEditor({ season, onLocked }: { season: Season; onLocked: () => void }) {
  const g = useLoad(() => request<{ grouping: Grouping | null }>("GET", `/v1/admin/seasons/${season.id}/grouping`).catch(() => ({ grouping: null })), [season.id]);
  const [move, setMove] = useState<{ childId: string; nickname: string } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const call = async (path: string, body?: unknown, ok?: string) => {
    try {
      await request("POST", `/v1/admin/seasons/${season.id}/grouping/${path}`, body);
      if (ok) message.success(ok);
      g.reload();
    } catch (e) {
      message.error(errText(e));
    }
  };
  const grouping = g.data?.grouping;
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {!season.groupingLocked && (
        <Space>
          <Button type={grouping ? "default" : "primary"} disabled={!["enrolling", "grouped"].includes(season.status)} onClick={() => void call("generate", undefined, "已生成分组")}>
            {grouping ? "重新生成" : "生成分组"}
          </Button>
          {grouping && (
            <Popconfirm
              title="确认锁定分组？会建服、组、地块和计划事件，之后不能再改。"
              okText="确认"
              cancelText="取消"
              onConfirm={async () => {
                await call("confirm", {}, "分组已锁定");
                onLocked();
              }}
            >
              <Button type="primary">确认并锁定</Button>
            </Popconfirm>
          )}
        </Space>
      )}
      {grouping?.siblingConflicts.length ? <Alert type="warning" message={`有 ${grouping.siblingConflicts.length} 处兄弟姐妹在同一组，请换组`} /> : null}
      {grouping?.servers.map((sv, si) => (
        <Card key={si} size="small" title={sv.name}>
          <Space wrap align="start">
            {sv.teams.map((t, ti) => (
              <Card
                key={ti}
                size="small"
                style={{ width: 220 }}
                title={
                  season.groupingLocked ? (
                    t.name
                  ) : (
                    <Typography.Text editable={{ onChange: (name) => name.trim() && name !== t.name && void call("rename", { server: si, team: ti, name: name.trim() }) }}>{t.name}</Typography.Text>
                  )
                }
                extra={<Typography.Text type="secondary">{t.size} 人 · 平均 {t.averageGrade}</Typography.Text>}
              >
                {t.members.map((m) => (
                  <div key={m.childId}>
                    {season.groupingLocked ? (
                      `${m.nickname}（${m.gradeLabel}）`
                    ) : (
                      <Button size="small" type="link" style={{ padding: 0 }} onClick={() => (setMove({ childId: m.childId, nickname: m.nickname }), setTarget(null))}>
                        {m.nickname}（{m.gradeLabel}）
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            ))}
          </Space>
        </Card>
      ))}
      <Modal
        open={!!move}
        title={`把${move?.nickname ?? ""}换到`}
        okText="换组"
        cancelText="取消"
        onCancel={() => setMove(null)}
        onOk={async () => {
          if (!move || !target) return;
          const [server, team] = target.split(":").map(Number) as [number, number];
          await call("move", { childId: move.childId, server, team });
          setMove(null);
        }}
      >
        <Select
          style={{ width: "100%" }}
          value={target}
          onChange={setTarget}
          options={(grouping?.servers ?? []).flatMap((sv, si) => sv.teams.map((t, ti) => ({ value: `${si}:${ti}`, label: `${sv.name} · ${t.name}` })))}
        />
      </Modal>
      {season.groupingLocked && <TeamQrCodes seasonId={season.id} />}
    </Space>
  );
}

/** After confirming: upload each team's WeChat group QR code (part 7 §3; part 5 E1). */
function TeamQrCodes({ seasonId }: { seasonId: string }) {
  const s = useLoad(() => request<{ servers: { id: string; name: string }[] }>("GET", `/v1/admin/seasons/${seasonId}`), [seasonId]);
  return (
    <Card size="small" title="小组微信群二维码（上传后只有本组成员能看到；7 天过期，满 6 天会提醒更新）">
      {s.data?.servers.map((sv) => <ServerQr key={sv.id} serverId={sv.id} name={sv.name} />)}
    </Card>
  );
}

function ServerQr({ serverId, name }: { serverId: string; name: string }) {
  const o = useLoad(() => request<{ teams: { id: string; name: string }[] }>("GET", `/v1/admin/servers/${serverId}`), [serverId]);
  const upload = async (target: string, file: File) => {
    try {
      const t = await request<{ key: string; upload: { url: string; headers: Record<string, string> } }>("POST", `${target}/qr/ticket`, { contentType: file.type, size: file.size });
      const res = await fetch(t.upload.url, { method: "PUT", headers: t.upload.headers, body: file });
      if (!res.ok) throw new Error("上传没有成功");
      await request("POST", `${target}/qr`, { key: t.key });
      message.success("二维码已更新");
    } catch (e) {
      message.error(errText(e));
    }
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text strong>{name}</Typography.Text>
      {o.data?.teams.map((t) => (
        <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
          <span style={{ width: 120 }}>{t.name}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${t.name}二维码`} onChange={(e) => e.target.files?.[0] && void upload(`/v1/admin/teams/${t.id}`, e.target.files[0])} />
        </div>
      ))}
      {(["a", "b"] as const).map((camp) => (
        <div key={camp} style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
          <span style={{ width: 120 }}>大团战{camp === "a" ? "甲" : "乙"}阵营</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${camp}阵营二维码`} onChange={(e) => e.target.files?.[0] && void upload(`/v1/admin/servers/${serverId}/camps/${camp}`, e.target.files[0])} />
        </div>
      ))}
    </div>
  );
}
