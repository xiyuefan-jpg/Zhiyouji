/** Console pages that work now: dashboard, accounts, view log, notification center; the rest wait for server endpoints. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { Alert, Button, Card, DatePicker, Empty, Form, Input, List, Modal, Popconfirm, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import type { MessageView } from "@zhiyouji/shared";
import { api, request, type AdminUserRow, type ViewLogEntry } from "../api";
import { useAdmin } from "../auth";
import { Time } from "../time";
import { NAV } from "./Layout";

interface Ctx {
  reloadUnread: () => void;
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    fn().then(
      (d) => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload, loading };
}

// ---- 看板 (part 7 §1) ------------------------------------------------------------

interface DashboardData {
  today: { day: string; dailyTasks: { passed: number; failed: number; error: number; reviewing: number }; worksSubmitted: number; newChildren: number; activeChildren: number };
  attention: { reviewsDueSoon: number; reviewsPending: number; dailyExceptions: number; failedPlannedEvents: { serverId: string; key: string }[]; lowPromptLands: number };
  servers: { id: string; name: string; season: string; status: string; day: number; paused: boolean; activeContests: number; nextPublication: string; top: { rank: number; name: string; points: number }[] }[];
  ai: { workScores: number; dailyReviews: number };
}

export function DashboardPage() {
  const me = useAdmin();
  const nav = useNavigate();
  const { data } = useLoad(() => api.messages());
  const dash = useLoad(() => request<DashboardData>("GET", "/v1/admin/dashboard"));
  const open = (data?.messages ?? []).filter((m) => !m.read);
  const d = dash.data;
  const todo = d
    ? [
        d.attention.reviewsDueSoon ? { text: `${d.attention.reviewsDueSoon} 件复核快到时限`, to: "/review" } : null,
        d.attention.reviewsPending ? { text: `${d.attention.reviewsPending} 件作品待复核`, to: "/review" } : null,
        d.attention.dailyExceptions ? { text: `${d.attention.dailyExceptions} 条每日任务卡住了`, to: "/review" } : null,
        d.attention.failedPlannedEvents.length ? { text: `${d.attention.failedPlannedEvents.length} 个计划事件失败`, to: `/monitor/${d.attention.failedPlannedEvents[0]!.serverId}` } : null,
        d.attention.lowPromptLands ? { text: `${d.attention.lowPromptLands} 块地题库不足`, to: "/content" } : null,
      ].filter((x): x is { text: string; to: string } => x !== null)
    : [];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        看板
      </Typography.Title>
      <Card title="需要处理">
        {todo.length === 0 && open.length === 0 ? (
          <Typography.Text type="secondary">现在没有要处理的事。计划事件失败、复核快到时限、内容安全不通过这些情况会出现在这里。</Typography.Text>
        ) : (
          <List
            dataSource={[...todo.map((t) => ({ key: t.text, title: t.text, body: "", to: t.to })), ...open.map((m) => ({ key: m.id, title: m.title, body: m.body, to: "/notifications" }))]}
            renderItem={(m) => (
              <List.Item actions={[<Button key="see" type="link" onClick={() => nav(m.to)}>查看</Button>]}>
                <List.Item.Meta title={<Typography.Text type="danger">{m.title}</Typography.Text>} description={m.body} />
              </List.Item>
            )}
          />
        )}
      </Card>
      {d && me.role === "admin" && (
        <>
          <Card title={`今天（${d.today.day}）`}>
            <Space size={32} wrap>
              <Statistic title="每日任务通过" value={d.today.dailyTasks.passed} />
              <Statistic title="不通过" value={d.today.dailyTasks.failed} />
              <Statistic title="审核中 / 卡住" value={`${d.today.dailyTasks.reviewing} / ${d.today.dailyTasks.error}`} />
              <Statistic title="交了作品" value={d.today.worksSubmitted} />
              <Statistic title="活跃孩子" value={d.today.activeChildren} />
              <Statistic title="新孩子" value={d.today.newChildren} />
              <Statistic title="AI 初评 / 审核" value={`${d.ai.workScores} / ${d.ai.dailyReviews}`} />
            </Space>
          </Card>
          <Card title="各服">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={d.servers}
              locale={{ emptyText: "没有进行中的服" }}
              onRow={(s) => ({ onClick: () => nav(`/monitor/${s.id}`), style: { cursor: "pointer" } })}
              columns={[
                { title: "赛季 · 服", render: (_, s) => `${s.season} · ${s.name}` },
                { title: "第几天", render: (_, s) => `第 ${s.day} 天${s.paused ? "（暂停）" : ""}` },
                { title: "进行中的争夺", dataIndex: "activeContests" },
                { title: "下一次公布", render: (_, s) => <Time iso={s.nextPublication} /> },
                { title: "前三名", render: (_, s) => s.top.map((t) => `${t.rank}. ${t.name} ${(t.points / 100).toFixed(1)}`).join("  ") },
              ]}
            />
          </Card>
        </>
      )}
    </Space>
  );
}

// ---- 管理端账号 (part 7 §0) --------------------------------------------------------

const ROLE_TEXT = { admin: "管理员", reviewer: "复核员" } as const;
const STATUS_TAG: Record<string, { color: string; text: string }> = {
  invited: { color: "gold", text: "待开通" },
  active: { color: "green", text: "在用" },
  disabled: { color: "default", text: "已停用" },
};
const ZONES = [
  { value: "America/New_York", label: "美国东部" },
  { value: "America/Chicago", label: "美国中部" },
  { value: "America/Los_Angeles", label: "美国西部" },
  { value: "Asia/Shanghai", label: "北京" },
];

export function UsersPage() {
  const me = useAdmin();
  const { data, error, reload, loading } = useLoad(() => api.users());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  async function invite(v: { email: string; name: string; role: "admin" | "reviewer"; timezone?: string }) {
    setBusy(true);
    try {
      const r = await api.invite(v);
      setLink({ url: `${window.location.origin}/invite?token=${encodeURIComponent(r.inviteToken)}`, email: r.user.email, expiresAt: r.expiresAt });
      form.resetFields();
      reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          管理端账号
        </Typography.Title>
        <Button
          type="primary"
          onClick={() => {
            setLink(null);
            setInviteOpen(true);
          }}
        >
          邀请
        </Button>
      </div>
      {error && <Alert type="error" message={error} />}
      <Table<AdminUserRow>
        rowKey="id"
        loading={loading}
        dataSource={data?.users ?? []}
        pagination={false}
        columns={[
          { title: "名字", dataIndex: "name" },
          { title: "邮箱", dataIndex: "email" },
          { title: "角色", dataIndex: "role", render: (r: "admin" | "reviewer") => ROLE_TEXT[r] },
          { title: "状态", dataIndex: "status", render: (s: string) => <Tag color={STATUS_TAG[s]?.color}>{STATUS_TAG[s]?.text ?? s}</Tag> },
          { title: "最后登录", dataIndex: "lastLoginAt", render: (t: string | null) => (t ? <Time iso={t} /> : "—") },
          {
            title: "",
            key: "actions",
            render: (_, u) =>
              u.id !== me.id && u.status !== "disabled" ? (
                <Popconfirm
                  title={`停用 ${u.name}？`}
                  description="停用后立即下线，不能再登录。"
                  okText="停用"
                  cancelText="取消"
                  onConfirm={async () => {
                    await api.disable(u.id).catch((e: Error) => message.error(e.message));
                    reload();
                  }}
                >
                  <Button type="link" danger>
                    停用
                  </Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />
      <Modal title="邀请新账号" open={inviteOpen} onCancel={() => setInviteOpen(false)} footer={null} destroyOnClose>
        {link ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert type="success" showIcon message={`把这个链接发给 ${link.email}，对方打开后设密码、绑定验证器就能登录。`} />
            <Typography.Paragraph copyable={{ text: link.url }} style={{ wordBreak: "break-all" }}>
              {link.url}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              有效期到 <Time iso={link.expiresAt} />，只能用一次。
            </Typography.Text>
            <Button block onClick={() => setInviteOpen(false)}>
              好了
            </Button>
          </Space>
        ) : (
          <Form form={form} layout="vertical" onFinish={invite} requiredMark={false} initialValues={{ role: "reviewer", timezone: "America/New_York" }}>
            <Form.Item label="邮箱" name="email" rules={[{ required: true, type: "email", message: "请输入邮箱" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="名字" name="name" rules={[{ required: true, message: "请输入名字" }]}>
              <Input maxLength={40} />
            </Form.Item>
            <Form.Item label="角色" name="role">
              <Select options={[{ value: "reviewer", label: "复核员" }, { value: "admin", label: "管理员" }]} />
            </Form.Item>
            <Form.Item label="所在时区" name="timezone" extra="管理端的时间会同时显示北京时间和这个时区的时间。">
              <Select options={ZONES} />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              生成邀请链接
            </Button>
          </Form>
        )}
      </Modal>
    </Space>
  );
}

// ---- 查看记录 (part 8 §3.1) ------------------------------------------------------

const CONTENT_TEXT: Record<string, string> = {
  work: "作品",
  recording: "录音",
  daily_task: "每日任务",
  survey: "问卷",
  child_profile: "孩子档案",
};

export function ViewLogPage() {
  const users = useLoad(() => api.users());
  const [filters, setFilters] = useState<{ adminUserId?: string; childId?: string; from?: string; to?: string }>({});
  const { data, error, loading } = useLoad(() => api.viewLog({ ...filters, limit: 500 }), [JSON.stringify(filters)]);
  const names = useMemo(() => Object.fromEntries((users.data?.users ?? []).map((u) => [u.id, u.name])), [users.data]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        查看记录
      </Typography.Title>
      <Typography.Text type="secondary">管理员和复核员每一次查看、下载孩子的数据都记在这里，只能看，不能改。</Typography.Text>
      <Space wrap>
        <Select
          allowClear
          placeholder="全部账号"
          style={{ width: 180 }}
          options={(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
          onChange={(v?: string) => setFilters((f) => ({ ...f, adminUserId: v }))}
        />
        <Input.Search allowClear placeholder="孩子编号" style={{ width: 300 }} onSearch={(v) => setFilters((f) => ({ ...f, childId: v.trim() || undefined }))} />
        <DatePicker.RangePicker
          onChange={(r) => setFilters((f) => ({ ...f, from: r?.[0]?.startOf("day").toISOString(), to: r?.[1]?.endOf("day").toISOString() }))}
        />
      </Space>
      {error && <Alert type="error" message={error} />}
      <Table<ViewLogEntry>
        rowKey="id"
        loading={loading}
        dataSource={data?.entries ?? []}
        pagination={{ pageSize: 50 }}
        columns={[
          { title: "时间", dataIndex: "at", render: (t: string) => <Time iso={t} /> },
          { title: "账号", dataIndex: "adminUserId", render: (id: string) => names[id] ?? id.slice(0, 8) },
          { title: "动作", dataIndex: "action", render: (a: string) => (a === "download" ? <Tag color="orange">下载</Tag> : <Tag>查看</Tag>) },
          { title: "内容", dataIndex: "contentKind", render: (k: string) => CONTENT_TEXT[k] ?? k },
          { title: "对象", dataIndex: "objectId", render: (o: string | null) => o ?? "—" },
          { title: "孩子", dataIndex: "childId", render: (c: string | null) => (c ? c.slice(0, 8) : "—") },
        ]}
      />
    </Space>
  );
}

// ---- 通知中心 (part 8 §1.2) ------------------------------------------------------

export function NotificationsPage() {
  const { reloadUnread } = useOutletContext<Ctx>();
  const nav = useNavigate();
  const [items, setItems] = useState<MessageView[] | null>(null);
  const load = useCallback(() => {
    api.messages().then((r) => setItems(r.messages), () => setItems([]));
  }, []);
  useEffect(load, [load]);

  async function open(m: MessageView) {
    if (!m.read) {
      await api.readMessage(m.id).catch(() => undefined);
      setItems((cur) => cur?.map((x) => (x.id === m.id ? { ...x, read: true } : x)) ?? cur);
      reloadUnread();
    }
    if (m.link?.startsWith("/")) nav(m.link);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          通知中心
        </Typography.Title>
        <Button
          onClick={async () => {
            await api.readAll().catch(() => undefined);
            load();
            reloadUnread();
          }}
        >
          全部标为已读
        </Button>
      </div>
      <Card>
        {items && items.length === 0 ? (
          <Empty description="没有通知" />
        ) : (
          <List
            loading={!items}
            dataSource={items ?? []}
            renderItem={(m) => (
              <List.Item onClick={() => void open(m)} style={{ cursor: "pointer" }} extra={<Time iso={m.createdAt} />}>
                <List.Item.Meta title={<span style={{ fontWeight: m.read ? 400 : 700 }}>{!m.read && <Tag color="red">未读</Tag>}{m.title}</span>} description={m.body} />
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  );
}

// ---- sections waiting for server endpoints ---------------------------------------

const COMING: Record<string, string> = {
  "/review": "我的复核队列、复核一件作品、每日任务异常队列、双人复核（第 5 节）。",
  "/season": "赛季列表和状态、参数（每次修改存一个版本）、日历和三个公布时刻、计划事件列表和失败重跑（第 2 节）。",
  "/players": "开通赛季资格、分组、组长调整、上传小组和阵营的微信群二维码（第 3 节）。",
  "/content": "题库、评分族和版本、AI 配置和提示词（第 4 节）。",
  "/reviewers": "每位复核员的工作量、时限、分差（第 6 节）。",
  "/monitor": "各服实时状态、争夺、账本、改判、账本调整、取消争夺、暂停和恢复（第 7 节）。",
  "/ops": "公告、美术资源替换和作者署名（第 8 节）。",
  "/final": "终局结算、奖学金、数据导出（第 9 节）。",
};

export function ComingPage({ path }: { path: string }) {
  const label = NAV.find((n) => n.key === path)?.label ?? "";
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {label}
      </Typography.Title>
      <Card>
        <Empty description={<span>这部分等服务器的接口做好后接上：{COMING[path]}</span>} />
      </Card>
    </Space>
  );
}
