/**
 * 赛季监控与干预 (PRD part 7 §7, §8 战报预览): pick a server, then
 * - 总览: teams (rank, points, grain and frozen grain, lands, items, leader
 *   and deputy), lands, pause / resume;
 * - 争夺: every contest with its status; cancel with or without refund;
 * - 计划事件: times and status; move a time, rerun a failed one;
 * - 账本: entries by team and currency; reverse one;
 * - 人工干预: adjust grain / points, set a land's owner, give / take an item,
 *   set the leader or deputy, withdraw a member — always with a reason;
 * - 战报预览: the feed as the whole server reads it; hide a line.
 * Every action asks for a reason and lands in the operation log.
 */

import { ITEMS } from "@zhiyouji/engine";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { ApiError, request } from "../api";
import { Time } from "../time";
import { useLoad } from "../useLoad";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const pts = (p: number) => (p / 100).toFixed(1);

/** Ask for a reason, then run the action. */
export function withReason(title: string, run: (reason: string) => Promise<unknown>, onDone?: () => void) {
  let reason = "";
  Modal.confirm({
    title,
    content: <Input.TextArea aria-label="原因" placeholder="原因（进操作日志）" rows={2} onChange={(e) => (reason = e.target.value)} />,
    okText: "确定",
    cancelText: "取消",
    onOk: async () => {
      if (!reason.trim()) {
        message.warning("要填原因");
        throw new Error("needs reason");
      }
      try {
        await run(reason.trim());
        message.success("已完成");
        onDone?.();
      } catch (e) {
        message.error(errText(e));
        throw e;
      }
    },
  });
}

interface SeasonRow {
  id: string;
  name: string;
  status: string;
}

/** Season → server picker; navigates to /<base>/<serverId>. */
export function ServerPicker({ base, value }: { base: string; value?: string }) {
  const nav = useNavigate();
  const seasons = useLoad(() => request<{ seasons: SeasonRow[] }>("GET", "/v1/admin/seasons"));
  const [season, setSeason] = useState<string | null>(null);
  const servers = useLoad(() => (season ? request<{ servers: { id: string; name: string }[] }>("GET", `/v1/admin/seasons/${season}`) : Promise.resolve({ servers: [] })), [season]);
  return (
    <Space wrap>
      <Select
        aria-label="选赛季"
        placeholder="选赛季"
        style={{ width: 200 }}
        value={season}
        onChange={setSeason}
        options={(seasons.data?.seasons ?? []).map((s) => ({ value: s.id, label: s.name }))}
      />
      <Select aria-label="选服" placeholder="选服" style={{ width: 160 }} value={value} onChange={(id) => nav(`${base}/${id}`)} options={(servers.data?.servers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
    </Space>
  );
}

interface Overview {
  season: { id: string; name: string; status: string };
  server: { id: string; name: string };
  day: number;
  paused: boolean;
  teams: {
    id: string;
    name: string;
    rank: number | null;
    points: number;
    grain: number;
    frozenGrain: number;
    leader: string | null;
    deputy: string | null;
    members: { childId: string; nickname: string; grade: number; active: boolean }[];
    items: { uid: string; itemId: string; name: string; source: string }[];
    lands: string[];
  }[];
  lands: { id: string; name: string; kind: string; owner: string | null; contestId: string | null }[];
  contests: { id: string; landId: string; defender: string; attackers: { teamId: string; paid: number }[]; status: string; deadline: number; outcome?: { kind: string } }[];
  wars?: Record<string, { week: number; pairs: [string, string][]; bye: string | null; settled: boolean; results?: { teamId: string; outcome: string; points: number; chestItem: string | null }[] }>;
  shop?: { bought: Record<string, string[]>; auctions: { itemId: string; endAt: number; bids: { teamId: string; amount: number }[]; closed: boolean; winner: string | null }[] };
  bigBattle?: { camps: { a: string[]; b: string[] }; lineValues: number[]; final: { a: string[]; b: string[] } | null; settled: boolean } | null;
  itemUses?: { at: number; team: string; item: string; target: string | null; land: string | null; broadcast: boolean }[];
  pointsBySource?: Record<string, Record<string, number>>;
}

const OUTCOME: Record<string, string> = { win: "赢", lose: "输", tie: "平", bye: "轮空" };
const itemName = (id: string) => ITEMS.find((i) => i.id === id)?.name ?? id;

/** 周战争、商店与竞价、大团战、法宝使用记录、团队分来源 (part 7 §7). */
function SeasonTabs({ d, teamName }: { d: Overview; teamName: (id: string | null) => string }) {
  const wars = Object.values(d.wars ?? {}).sort((a, b) => a.week - b.week);
  const sources = [...new Set(Object.values(d.pointsBySource ?? {}).flatMap((x) => Object.keys(x)))];
  return (
    <Tabs
      size="small"
      items={[
        {
          key: "wars",
          label: "周战争",
          children: wars.length ? (
            <Table
              rowKey="week"
              size="small"
              pagination={false}
              dataSource={wars}
              columns={[
                { title: "周", dataIndex: "week" },
                { title: "配对", render: (_, w) => w.pairs.map(([a, b]) => `${teamName(a)} vs ${teamName(b)}`).join("；") + (w.bye ? `；轮空：${teamName(w.bye)}` : "") },
                {
                  title: "结果",
                  render: (_, w) => (w.settled ? (w.results ?? []).map((r) => `${teamName(r.teamId)} ${OUTCOME[r.outcome] ?? r.outcome} ${pts(r.points)}`).join("、") : <Tag>未结算</Tag>),
                },
              ]}
            />
          ) : (
            "还没配对"
          ),
        },
        {
          key: "shop",
          label: "商店与竞价",
          children: (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Table
                rowKey="itemId"
                size="small"
                pagination={false}
                locale={{ emptyText: "仙品竞价还没开始" }}
                dataSource={d.shop?.auctions ?? []}
                columns={[
                  { title: "仙品", render: (_, a) => itemName(a.itemId) },
                  { title: "最高出价", render: (_, a) => (a.bids.length ? `${teamName(a.bids[a.bids.length - 1]!.teamId)} ${a.bids[a.bids.length - 1]!.amount}` : "—") },
                  { title: "出价次数", render: (_, a) => a.bids.length },
                  { title: "结束", render: (_, a) => <Time iso={new Date(a.endAt)} /> },
                  { title: "状态", render: (_, a) => (a.closed ? `已结束${a.winner ? `，${teamName(a.winner)}得到` : "，流拍"}` : "进行中") },
                ]}
              />
              <div>
                已买：
                {Object.entries(d.shop?.bought ?? {})
                  .filter(([, v]) => v.length)
                  .map(([t, v]) => `${teamName(t)}：${v.map(itemName).join("、")}`)
                  .join("；") || "还没有"}
              </div>
            </Space>
          ),
        },
        {
          key: "battle",
          label: "大团战",
          children: d.bigBattle ? (
            <Space direction="vertical">
              <div>阵营甲：{d.bigBattle.camps.a.map(teamName).join("、")}</div>
              <div>阵营乙：{d.bigBattle.camps.b.map(teamName).join("、")}</div>
              {d.bigBattle.final &&
                d.bigBattle.lineValues.map((v, i) => (
                  <div key={i}>
                    第 {i + 1} 条线（{v} 分）：{teamName(d.bigBattle!.final!.a[i] ?? null)} vs {teamName(d.bigBattle!.final!.b[i] ?? null)}
                  </div>
                ))}
              <Tag>{d.bigBattle.settled ? "已结算" : d.bigBattle.final ? "战线已锁定" : "等战线分配"}</Tag>
            </Space>
          ) : (
            "还没分阵营"
          ),
        },
        {
          key: "items",
          label: "法宝使用记录",
          children: (
            <Table
              rowKey={(r) => `${r.at}-${r.team}-${r.item}`}
              size="small"
              pagination={{ pageSize: 30 }}
              locale={{ emptyText: "还没有人用法宝" }}
              dataSource={d.itemUses ?? []}
              columns={[
                { title: "时间", render: (_, r) => <Time iso={new Date(r.at)} /> },
                { title: "谁", dataIndex: "team" },
                { title: "法宝", dataIndex: "item" },
                { title: "对谁 / 哪块地", render: (_, r) => [r.target, r.land].filter(Boolean).join(" · ") || "—" },
                { title: "全服广播", render: (_, r) => (r.broadcast ? "是" : "只有本组知道") },
              ]}
            />
          ),
        },
        {
          key: "sources",
          label: "团队分来源",
          children: (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={d.teams}
              columns={[
                { title: "组", dataIndex: "name" },
                ...sources.map((src) => ({ title: SOURCE_TEXT[src] ?? src, render: (_: unknown, t: Overview["teams"][number]) => pts(d.pointsBySource?.[t.id]?.[src] ?? 0) })),
                { title: "合计", render: (_: unknown, t: Overview["teams"][number]) => pts(t.points) },
              ]}
            />
          ),
        },
      ]}
    />
  );
}

export function MonitorPage() {
  const { serverId } = useParams();
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        赛季监控与干预
      </Typography.Title>
      <ServerPicker base="/monitor" value={serverId} />
      {serverId ? <ServerMonitor serverId={serverId} /> : <Typography.Text type="secondary">先选一个服。</Typography.Text>}
    </Space>
  );
}

function ServerMonitor({ serverId }: { serverId: string }) {
  const [movingContest, setMovingContest] = useState<string | null>(null);
  const [contestAt, setContestAt] = useState<dayjs.Dayjs | null>(null);
  const o = useLoad(() => request<Overview>("GET", `/v1/admin/servers/${serverId}`), [serverId]);
  const d = o.data;
  const teamName = (id: string | null) => (id ? (d?.teams.find((t) => t.id === id)?.name ?? "") : "无主");
  const landName = (id: string) => d?.lands.find((l) => l.id === id)?.name ?? id;
  const nick = (id: string | null) => (id ? (d?.teams.flatMap((t) => t.members).find((m) => m.childId === id)?.nickname ?? "") : "—");
  if (o.error) return <Alert type="error" message={o.error} />;
  if (!d) return null;
  const pause = () =>
    d.paused
      ? Modal.confirm({ title: "恢复赛季？之后的计划事件会顺延暂停的时长。", okText: "恢复", cancelText: "取消", onOk: async () => (await request("POST", `/v1/admin/servers/${serverId}/resume`), o.reload()) })
      : withReason("暂停这个服？", (reason) => request("POST", `/v1/admin/servers/${serverId}/pause`, { reason }), o.reload);
  return (
    <>
      <Space wrap>
        <Typography.Text strong>
          {d.season.name} · {d.server.name} · 第 {d.day} 天
        </Typography.Text>
        {d.paused && <Tag color="red">暂停中</Tag>}
        <Button danger={!d.paused} onClick={pause}>
          {d.paused ? "恢复" : "暂停"}
        </Button>
        <Button onClick={o.reload}>刷新</Button>
      </Space>
      <Tabs
        items={[
          {
            key: "teams",
            label: "总览",
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={[...d.teams].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))}
                columns={[
                  { title: "名次", dataIndex: "rank" },
                  { title: "组", dataIndex: "name" },
                  { title: "团队分", render: (_, t) => pts(t.points) },
                  { title: "粮草", render: (_, t) => `${t.grain}${t.frozenGrain ? `（冻结 ${t.frozenGrain}）` : ""}` },
                  { title: "地", render: (_, t) => t.lands.map(landName).join("、") || "—" },
                  { title: "法宝", render: (_, t) => t.items.map((i) => i.name).join("、") || "—" },
                  { title: "组长 / 副组长", render: (_, t) => `${nick(t.leader)} / ${nick(t.deputy)}` },
                  { title: "人数", render: (_, t) => t.members.filter((m) => m.active).length },
                ]}
              />
            ),
          },
          {
            key: "contests",
            label: "争夺",
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={[...d.contests].reverse()}
                columns={[
                  { title: "地块", render: (_, c) => landName(c.landId) },
                  { title: "守方", render: (_, c) => teamName(c.defender) },
                  { title: "进攻方", render: (_, c) => c.attackers.map((a) => teamName(a.teamId)).join("、") },
                  { title: "截止", render: (_, c) => <Time iso={new Date(c.deadline)} /> },
                  { title: "状态", render: (_, c) => (c.status === "active" ? <Tag color="orange">进行中</Tag> : (c.outcome?.kind ?? c.status)) },
                  {
                    title: "",
                    render: (_, c) =>
                      c.status === "active" && (
                        <Space>
                          <Button size="small" onClick={() => (setMovingContest(c.id), setContestAt(dayjs(c.deadline)))}>
                            改截止
                          </Button>
                          <Button size="small" onClick={() => withReason("取消这场争夺，退还进攻方的粮草？", (reason) => request("POST", `/v1/admin/servers/${serverId}/interventions`, { action: "cancel_contest", contestId: c.id, refund: true, reason }), o.reload)}>
                            取消并退粮草
                          </Button>
                          <Button size="small" onClick={() => withReason("取消这场争夺，不退粮草？", (reason) => request("POST", `/v1/admin/servers/${serverId}/interventions`, { action: "cancel_contest", contestId: c.id, refund: false, reason }), o.reload)}>
                            取消不退
                          </Button>
                        </Space>
                      ),
                  },
                ]}
              />
            ),
          },
          { key: "season", label: "周战争 / 商店 / 大团战 / 法宝 / 分数来源", children: <SeasonTabs d={d} teamName={teamName} /> },
          { key: "planned", label: "计划事件（周战争、大团战的截止也在这里改）", children: <Planned serverId={serverId} /> },
          { key: "ledger", label: "账本", children: <Ledger serverId={serverId} teams={d.teams} /> },
          { key: "intervene", label: "人工干预", children: <Intervene serverId={serverId} d={d} onDone={o.reload} /> },
          { key: "feed", label: "战报预览", children: <FeedPreview serverId={serverId} /> },
        ]}
      />
      <Modal
        open={!!movingContest}
        title="改这场争夺的截止时间"
        okText="保存"
        cancelText="取消"
        onCancel={() => setMovingContest(null)}
        onOk={() =>
          withReason("改截止时间？争夺双方都会收到消息。", (reason) => request("POST", `/v1/admin/servers/${serverId}/interventions`, { action: "set_deadline", target: `contest:${movingContest}`, deadline: contestAt!.toISOString(), reason }), () => {
            setMovingContest(null);
            o.reload();
          })
        }
      >
        <DatePicker showTime aria-label="新的截止时间" value={contestAt} onChange={setContestAt} />
      </Modal>
    </>
  );
}

const STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: "default", text: "等待" },
  done: { color: "green", text: "完成" },
  failed: { color: "red", text: "失败" },
  skipped: { color: "default", text: "跳过" },
};

function Planned({ serverId }: { serverId: string }) {
  const p = useLoad(() => request<{ events: { key: string; kind: string; runAt: string; status: string; errorText: string | null; day: number | null }[] }>("GET", `/v1/admin/servers/${serverId}/planned`), [serverId]);
  const [moving, setMoving] = useState<string | null>(null);
  const [at, setAt] = useState<dayjs.Dayjs | null>(null);
  return (
    <>
      <Table
        rowKey="key"
        size="small"
        loading={p.loading}
        dataSource={(p.data?.events ?? []).filter((e) => e.kind !== "settle_day")}
        pagination={{ pageSize: 30 }}
        columns={[
          { title: "第几天", dataIndex: "day" },
          { title: "事件", dataIndex: "key" },
          { title: "时间", render: (_, e) => <Time iso={e.runAt} /> },
          { title: "状态", render: (_, e) => <Tag color={STATUS[e.status]?.color}>{STATUS[e.status]?.text ?? e.status}</Tag> },
          { title: "错误", render: (_, e) => e.errorText ?? "" },
          {
            title: "",
            render: (_, e) => (
              <Space>
                {e.status === "pending" && (
                  <Button size="small" onClick={() => (setMoving(e.key), setAt(dayjs(e.runAt)))}>
                    改时间
                  </Button>
                )}
                {e.status === "failed" && (
                  <Button size="small" type="primary" onClick={() => void request("POST", `/v1/admin/servers/${serverId}/planned/${encodeURIComponent(e.key)}/rerun`).then(() => (message.success("已重跑"), p.reload()), (x) => message.error(errText(x)))}>
                    重跑
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!moving}
        title={`改时间：${moving}`}
        okText="保存"
        cancelText="取消"
        onCancel={() => setMoving(null)}
        onOk={() =>
          withReason("改这个计划事件的时间？", (reason) => request("POST", `/v1/admin/servers/${serverId}/planned/${encodeURIComponent(moving!)}/reschedule`, { runAt: at!.toISOString(), reason }), () => {
            setMoving(null);
            p.reload();
          })
        }
      >
        <DatePicker showTime value={at} onChange={setAt} />
        <Typography.Paragraph type="secondary">按你电脑的时区选；保存后列表里同时显示北京时间。</Typography.Paragraph>
      </Modal>
    </>
  );
}

export const SOURCE_TEXT: Record<string, string> = {
  opening: "开营", daily_task: "每日任务", supply: "军需任务", attack: "进攻", join: "加入进攻", auction_bid: "盲拍", center_land: "中心地", shop: "商店", epic_auction: "竞价",
  refund: "退还", reversal: "冲正", admin: "管理员调整", territory: "领地收益", merit_capture: "夺地战功", merit_defend: "守地战功", war: "周战争", bye: "轮空",
  participation: "全员参与奖", big_battle_line: "大团战战线", big_battle_seize: "夺取产出", main_battlefield: "主战场", item_effect: "法宝效果", grain_conversion: "粮草折算", territory_transfer: "收益转移",
};

function Ledger({ serverId, teams }: { serverId: string; teams: Overview["teams"] }) {
  const [teamId, setTeamId] = useState<string | undefined>(teams[0]?.id);
  const [currency, setCurrency] = useState<"grain" | "points">("points");
  const l = useLoad(
    () => request<{ entries: { id: string; teamId: string; amount: number; source: string; note: string | null; at: number; reverses: string | null }[] }>("GET", `/v1/admin/servers/${serverId}/ledger?currency=${currency}${teamId ? `&teamId=${teamId}` : ""}`),
    [serverId, teamId, currency],
  );
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space>
        <Select style={{ width: 160 }} value={teamId} onChange={setTeamId} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
        <Radio.Group value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <Radio.Button value="points">团队分</Radio.Button>
          <Radio.Button value="grain">粮草</Radio.Button>
        </Radio.Group>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={l.loading}
        dataSource={l.data?.entries ?? []}
        pagination={{ pageSize: 30 }}
        columns={[
          { title: "时间", render: (_, e) => <Time iso={new Date(e.at)} /> },
          { title: "来源", render: (_, e) => SOURCE_TEXT[e.source] ?? e.source },
          { title: "金额", render: (_, e) => (currency === "points" ? pts(e.amount) : e.amount) },
          { title: "备注", render: (_, e) => e.note ?? "" },
          {
            title: "",
            render: (_, e) =>
              !e.reverses && (
                <Button size="small" onClick={() => withReason("冲正这一笔？（追加一笔相反的记录，不删原记录）", (reason) => request("POST", `/v1/admin/servers/${serverId}/interventions`, { action: "reverse_entry", entryId: e.id, reason }), l.reload)}>
                  冲正
                </Button>
              ),
          },
        ]}
      />
    </Space>
  );
}

const ACTIONS = [
  { value: "adjust_ledger", label: "加减粮草或团队分" },
  { value: "set_land_owner", label: "改地块主人" },
  { value: "give_item", label: "发放法宝" },
  { value: "remove_item", label: "收回法宝" },
  { value: "set_role", label: "设组长 / 副组长" },
  { value: "withdraw", label: "组员退赛" },
];

const ITEM_OPTIONS = [
  ["huanhun", "还魂金丹"], ["yujing", "玉净瓶"], ["jianbi", "坚壁清野"], ["bihuo", "辟火罩"], ["taixu", "太虚幻镜"], ["zhencha", "侦察令"],
  ["dianhua", "点化之术"], ["shengsi", "生死簿"], ["fatian", "法天象地"], ["danao", "大闹天宫"], ["jiuzhuan", "九转兵劫印"], ["xiuli", "袖里乾坤"],
  ["sanmei", "三昧真火"], ["zijin", "紫金红葫芦"], ["zhaoyao", "玄天照妖镜"], ["beishui", "背水阵"], ["jiancheng", "坚城令"], ["qiankun", "乾坤圈"],
  ["bagua", "八卦炉"], ["qibao", "七宝紫金钵"], ["diaobing", "调兵符"],
].map(([value, label]) => ({ value: value!, label: label! }));

function Intervene({ serverId, d, onDone }: { serverId: string; d: Overview; onDone: () => void }) {
  const [form] = Form.useForm();
  const action = Form.useWatch("action", form) as string | undefined;
  const teamId = Form.useWatch("teamId", form) as string | undefined;
  const team = d.teams.find((t) => t.id === teamId);
  const teamOpts = d.teams.map((t) => ({ value: t.id, label: t.name }));
  const submit = async () => {
    const v = await form.validateFields();
    const body: Record<string, unknown> = { action: v.action, reason: v.reason };
    if (v.action === "adjust_ledger") Object.assign(body, { teamId: v.teamId, currency: v.currency, amount: v.currency === "points" ? Math.round(v.amount * 100) : v.amount });
    if (v.action === "set_land_owner") Object.assign(body, { landId: v.landId, teamId: v.teamId ?? null });
    if (v.action === "give_item") Object.assign(body, { teamId: v.teamId, itemId: v.itemId });
    if (v.action === "remove_item") Object.assign(body, { teamId: v.teamId, uid: v.uid });
    if (v.action === "set_role") Object.assign(body, { teamId: v.teamId, role: v.role, childId: v.childId ?? null });
    if (v.action === "withdraw") Object.assign(body, { childId: v.childId });
    Modal.confirm({
      title: `确定：${ACTIONS.find((a) => a.value === v.action)?.label}？`,
      content: "这一步会记进账本或赛季状态，并写进操作日志。",
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          await request("POST", `/v1/admin/servers/${serverId}/interventions`, body);
          message.success("已完成");
          form.resetFields();
          onDone();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };
  return (
    <Card size="small" style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" initialValues={{ currency: "grain" }}>
        <Form.Item name="action" label="做什么" rules={[{ required: true, message: "选一项" }]}>
          <Select options={ACTIONS} aria-label="干预类型" />
        </Form.Item>
        {action && action !== "withdraw" && (
          <Form.Item name="teamId" label="组" rules={[{ required: action !== "set_land_owner", message: "选组" }]}>
            <Select allowClear={action === "set_land_owner"} options={teamOpts} placeholder={action === "set_land_owner" ? "不选 = 无主" : undefined} />
          </Form.Item>
        )}
        {action === "adjust_ledger" && (
          <Space>
            <Form.Item name="currency" label="账">
              <Radio.Group>
                <Radio.Button value="grain">粮草</Radio.Button>
                <Radio.Button value="points">团队分</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="amount" label="加减多少（减用负数）" rules={[{ required: true, message: "填数" }]}>
              <InputNumber step={1} />
            </Form.Item>
          </Space>
        )}
        {action === "set_land_owner" && (
          <Form.Item name="landId" label="地块" rules={[{ required: true, message: "选地块" }]}>
            <Select options={d.lands.map((l) => ({ value: l.id, label: `${l.name}（${l.id}）`, disabled: !!l.contestId }))} />
          </Form.Item>
        )}
        {action === "give_item" && (
          <Form.Item name="itemId" label="法宝" rules={[{ required: true, message: "选法宝" }]}>
            <Select options={ITEM_OPTIONS} />
          </Form.Item>
        )}
        {action === "remove_item" && (
          <Form.Item name="uid" label="收回哪一件" rules={[{ required: true, message: "选一件" }]}>
            <Select options={(team?.items ?? []).map((i) => ({ value: i.uid, label: i.name }))} />
          </Form.Item>
        )}
        {action === "set_role" && (
          <Space>
            <Form.Item name="role" label="职务" rules={[{ required: true, message: "选职务" }]}>
              <Select style={{ width: 120 }} options={[{ value: "leader", label: "组长" }, { value: "deputy", label: "副组长" }]} />
            </Form.Item>
            <Form.Item name="childId" label="谁（不选 = 空出来）">
              <Select allowClear style={{ width: 160 }} options={(team?.members ?? []).filter((m) => m.active).map((m) => ({ value: m.childId, label: m.nickname }))} />
            </Form.Item>
          </Space>
        )}
        {action === "withdraw" && (
          <Form.Item name="childId" label="谁退赛" rules={[{ required: true, message: "选人" }]}>
            <Select showSearch optionFilterProp="label" options={d.teams.flatMap((t) => t.members.filter((m) => m.active).map((m) => ({ value: m.childId, label: `${m.nickname}（${t.name}）` })))} />
          </Form.Item>
        )}
        <Form.Item name="reason" label="原因（进操作日志）" rules={[{ required: true, message: "要填原因" }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Button type="primary" onClick={() => void submit()}>
          执行
        </Button>
      </Form>
    </Card>
  );
}

function FeedPreview({ serverId }: { serverId: string }) {
  const [since] = useState(() => new Date(Date.now() - 3 * 24 * 3600_000).toISOString());
  const f = useLoad(() => request<{ lines: { id: string; kind: string; broadcast: boolean; at: string; text: string; hidden: boolean }[] }>("GET", `/v1/admin/servers/${serverId}/feed?since=${encodeURIComponent(since)}`), [serverId]);
  return (
    <Table
      rowKey="id"
      size="small"
      loading={f.loading}
      dataSource={[...(f.data?.lines ?? [])].reverse()}
      locale={{ emptyText: "最近 3 天没有战报内容" }}
      pagination={{ pageSize: 30 }}
      columns={[
        { title: "时间", render: (_, l) => <Time iso={l.at} /> },
        { title: "内容", render: (_, l) => (l.hidden ? <Typography.Text delete>{l.text}</Typography.Text> : l.text) },
        { title: "", render: (_, l) => (l.broadcast ? <Tag>全服</Tag> : <Tag>组内</Tag>) },
        {
          title: "",
          render: (_, l) =>
            !l.hidden && (
              <Button size="small" onClick={() => withReason("隐藏这一条？孩子们不会再看到。", (reason) => request("POST", `/v1/admin/feed/${l.id}/hide`, { reason }), f.reload)}>
                隐藏
              </Button>
            ),
        },
      ]}
    />
  );
}
