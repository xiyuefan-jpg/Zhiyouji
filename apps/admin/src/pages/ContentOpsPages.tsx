/**
 * 题库与评分 (PRD part 7 §4), 内容与运营 (§8), 终局与导出 (§9):
 * - land templates (import the 12 defaults; rename, subject, rubric, order),
 *   prompts (draft / enabled / disabled — changes reach running servers),
 *   batch import (JSON), lands running out of prompts;
 * - announcements (all / a season / a server, timed, withdraw before sent),
 *   the content-safety queue (pass / remove; reviewers forward to an admin),
 *   AI configuration per task (model, fallback, shadow, prompt version) and
 *   calls / errors / cost / human-minus-AI by rubric family;
 * - final settlement with the scholarship pool, the scholarship sheet,
 *   season reviews (generate, preview, release), data exports (CSV), the
 *   parents' data requests.
 */

import { useState } from "react";
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { ApiError, request } from "../api";
import { useAdmin } from "../auth";
import { Time } from "../time";
import { downloadText, useLoad } from "../useLoad";
import { ServerPicker } from "./MonitorPages";
import { useParams } from "react-router";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const run = async (fn: () => Promise<unknown>, ok: string, then?: () => void) => {
  try {
    await fn();
    message.success(ok);
    then?.();
  } catch (e) {
    message.error(errText(e));
  }
};

// ---- 题库与评分 (§4) -------------------------------------------------------------------------------------

interface Template {
  id: string;
  code: string | null;
  name: string;
  subject: string;
  rubric: string;
  questionType: string;
  status: string;
  sort: number;
  prompts: { enabled: number; total: number };
}

interface Prompt {
  id: string;
  category: string;
  landTemplateId: string | null;
  questionType: string | null;
  title: string;
  body: string;
  audience: string | null;
  rubric: string | null;
  status: "draft" | "enabled" | "disabled";
  todo: boolean;
}

const CATEGORY: Record<string, string> = { land: "地块题目", war_theme: "周战争主题", supply: "军需任务", battle_line: "大团战战线", battle_main: "大团战主战场" };
const PSTATUS: Record<string, { color: string; text: string }> = { draft: { color: "default", text: "草稿" }, enabled: { color: "green", text: "启用" }, disabled: { color: "red", text: "停用" } };

export function ContentPage() {
  const me = useAdmin();
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        题库与评分
      </Typography.Title>
      <Tabs
        items={[
          { key: "prompts", label: "题目", children: <Prompts canEdit={me.role === "admin"} /> },
          { key: "templates", label: "地块模板", children: <Templates canEdit={me.role === "admin"} /> },
          ...(me.role === "admin" ? [{ key: "low", label: "题库不足", children: <LowStock /> }] : []),
        ]}
      />
    </Space>
  );
}

function Templates({ canEdit }: { canEdit: boolean }) {
  const t = useLoad(() => request<{ templates: Template[] }>("GET", "/v1/admin/land-templates"));
  const patch = (id: string, body: Partial<Template>) => run(() => request("PATCH", `/v1/admin/land-templates/${id}`, body), "已保存", t.reload);
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {canEdit && t.data?.templates.length === 0 && (
        <Button type="primary" onClick={() => void run(() => request("POST", "/v1/admin/land-templates/seed-defaults"), "已导入内容库的 12 个地块", t.reload)}>
          一键导入内容库的 12 个地块
        </Button>
      )}
      <Table<Template>
        rowKey="id"
        size="small"
        loading={t.loading}
        dataSource={t.data?.templates ?? []}
        pagination={false}
        columns={[
          { title: "顺序", render: (_, r) => (canEdit ? <InputNumber size="small" min={0} max={100} defaultValue={r.sort} onBlur={(e) => Number(e.target.value) !== r.sort && void patch(r.id, { sort: Number(e.target.value) })} /> : r.sort) },
          { title: "地块", render: (_, r) => (canEdit ? <Typography.Text editable={{ onChange: (v) => v.trim() && v !== r.name && void patch(r.id, { name: v.trim() }) }}>{r.name}</Typography.Text> : r.name) },
          { title: "学科", dataIndex: "subject" },
          { title: "评分族", dataIndex: "rubric" },
          { title: "题型", dataIndex: "questionType" },
          { title: "题目（启用 / 全部）", render: (_, r) => `${r.prompts.enabled} / ${r.prompts.total}` },
        ]}
      />
    </Space>
  );
}

function Prompts({ canEdit }: { canEdit: boolean }) {
  const [category, setCategory] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const qs = new URLSearchParams(Object.entries({ category, status }).filter(([, v]) => v) as [string, string][]).toString();
  const p = useLoad(() => request<{ prompts: Prompt[] }>("GET", `/v1/admin/prompts${qs ? `?${qs}` : ""}`), [qs]);
  const t = useLoad(() => request<{ templates: Template[] }>("GET", "/v1/admin/land-templates"));
  const [editing, setEditing] = useState<Partial<Prompt> | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const tName = (id: string | null) => t.data?.templates.find((x) => x.id === id)?.name ?? "";
  const [form] = Form.useForm();

  const save = async () => {
    const v = await form.validateFields();
    const body = { ...v, landTemplateId: v.landTemplateId ?? null, audience: v.audience || null, rubric: v.rubric ?? null, questionType: v.questionType || null };
    await run(() => (editing?.id ? request("PATCH", `/v1/admin/prompts/${editing.id}`, body) : request("POST", "/v1/admin/prompts", body)), "已保存", () => {
      setEditing(null);
      p.reload();
      t.reload();
    });
  };
  const doImport = async () => {
    let list: unknown;
    try {
      list = JSON.parse(importText);
    } catch {
      return void message.error("不是有效的 JSON");
    }
    await run(() => request("POST", "/v1/admin/prompts/import", { prompts: Array.isArray(list) ? list : [list] }), "已导入", () => {
      setImporting(false);
      p.reload();
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Select allowClear placeholder="类别" style={{ width: 160 }} value={category} onChange={setCategory} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
        <Select allowClear placeholder="状态" style={{ width: 120 }} value={status} onChange={setStatus} options={Object.entries(PSTATUS).map(([value, x]) => ({ value, label: x.text }))} />
        {canEdit && (
          <>
            <Button
              type="primary"
              onClick={() => {
                t.reload();
                form.resetFields();
                form.setFieldsValue({ category: "land", status: "draft" });
                setEditing({});
              }}
            >
              新建题目
            </Button>
            <Button onClick={() => setImporting(true)}>批量导入</Button>
          </>
        )}
      </Space>
      <Table<Prompt>
        rowKey="id"
        size="small"
        loading={p.loading}
        dataSource={p.data?.prompts ?? []}
        pagination={{ pageSize: 30 }}
        columns={[
          { title: "标题", render: (_, r) => (canEdit ? <a onClick={() => (form.setFieldsValue(r), setEditing(r))}>{r.title}</a> : r.title) },
          { title: "类别", render: (_, r) => CATEGORY[r.category] ?? r.category },
          { title: "地块", render: (_, r) => tName(r.landTemplateId) },
          { title: "评分族", dataIndex: "rubric" },
          { title: "状态", render: (_, r) => <Tag color={PSTATUS[r.status]?.color}>{PSTATUS[r.status]?.text}</Tag> },
          {
            title: "",
            render: (_, r) =>
              canEdit && (
                <Space>
                  {r.status !== "enabled" && (
                    <Button size="small" onClick={() => void run(() => request("PATCH", `/v1/admin/prompts/${r.id}`, { status: "enabled" }), "已启用", p.reload)}>
                      启用
                    </Button>
                  )}
                  {r.status === "enabled" && (
                    <Button size="small" danger onClick={() => void run(() => request("PATCH", `/v1/admin/prompts/${r.id}`, { status: "disabled" }), "已停用", p.reload)}>
                      停用
                    </Button>
                  )}
                </Space>
              ),
          },
        ]}
      />
      <Modal open={!!editing} title={editing?.id ? "改题目" : "新建题目"} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={() => setEditing(null)} width={720}>
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="category" label="类别" rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="landTemplateId" label="地块" rules={[({ getFieldValue }) => ({ required: getFieldValue("category") === "land", message: "地块题目要选地块" })]}>
              <Select allowClear style={{ width: 160 }} options={(t.data?.templates ?? []).map((x) => ({ value: x.id, label: x.name }))} />
            </Form.Item>
            <Form.Item name="rubric" label="评分族">
              <Select allowClear style={{ width: 100 }} options={["A", "B", "C", "D", "E"].map((x) => ({ value: x, label: x }))} />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select style={{ width: 100 }} options={Object.entries(PSTATUS).map(([value, x]) => ({ value, label: x.text }))} />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "填标题" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="body" label="题目正文（孩子看到的）" rules={[{ required: true, message: "填正文" }]}>
            <Input.TextArea rows={5} maxLength={5000} />
          </Form.Item>
          <Form.Item name="audience" label="受众（讲给谁）">
            <Input maxLength={100} placeholder="一个没学过这个知识的初中生或普通成年人" />
          </Form.Item>
          <Form.Item name="questionType" label="题型">
            <Input maxLength={60} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={importing} title="批量导入（JSON 数组）" okText="导入" cancelText="取消" onOk={() => void doImport()} onCancel={() => setImporting(false)} width={720}>
        <Typography.Paragraph type="secondary">每条：{`{ "category": "land", "landTemplateId": "…", "title": "…", "body": "…", "audience": "…", "rubric": "A", "status": "draft" }`}</Typography.Paragraph>
        <Input.TextArea rows={12} value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="导入内容" />
      </Modal>
    </Space>
  );
}

function LowStock() {
  const l = useLoad(() => request<{ lands: { serverId: string; server: string; landId: string; land: string; available: number }[] }>("GET", "/v1/admin/prompts/low-stock"));
  return (
    <Table
      rowKey={(r) => `${r.serverId}-${r.landId}`}
      size="small"
      dataSource={l.data?.lands ?? []}
      pagination={false}
      locale={{ emptyText: "每块地都还有足够的题" }}
      columns={[
        { title: "服", dataIndex: "server" },
        { title: "地块", dataIndex: "land" },
        { title: "还能抽的题", dataIndex: "available" },
      ]}
    />
  );
}

// ---- 内容与运营 (§8) ------------------------------------------------------------------------------------

interface Announcement {
  id: string;
  scope: string;
  title: string;
  body: string;
  publishAt: string;
  sentAt: string | null;
  withdrawnAt: string | null;
}

export function OpsPage() {
  const me = useAdmin();
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        内容与运营
      </Typography.Title>
      <Tabs
        items={[
          ...(me.role === "admin" ? [{ key: "ann", label: "公告", children: <Announcements /> }] : []),
          { key: "safety", label: "内容安全", children: <SafetyQueue isAdmin={me.role === "admin"} /> },
          ...(me.role === "admin" ? [{ key: "ai", label: "AI 配置", children: <AiConfig /> }] : []),
        ]}
      />
    </Space>
  );
}

function Announcements() {
  const a = useLoad(() => request<{ announcements: Announcement[] }>("GET", "/v1/admin/announcements"));
  const seasons = useLoad(() => request<{ seasons: { id: string; name: string }[] }>("GET", "/v1/admin/seasons"));
  const [form] = Form.useForm();
  const scope = Form.useWatch("scope", form) as string | undefined;
  const create = async () => {
    const v = await form.validateFields();
    await run(
      () => request("POST", "/v1/admin/announcements", { scope: v.scope, seasonId: v.seasonId ?? null, title: v.title, body: v.body, publishAt: (v.publishAt ?? null)?.toISOString() ?? new Date().toISOString() }),
      "已保存，到时间会发到孩子们的消息中心",
      () => {
        form.resetFields();
        a.reload();
      },
    );
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card size="small" title="发公告" style={{ maxWidth: 640 }}>
        <Form form={form} layout="vertical" initialValues={{ scope: "all" }}>
          <Space wrap>
            <Form.Item name="scope" label="发给">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: "all", label: "所有孩子" },
                  { value: "season", label: "某个赛季" },
                ]}
              />
            </Form.Item>
            {scope === "season" && (
              <Form.Item name="seasonId" label="赛季" rules={[{ required: true }]}>
                <Select style={{ width: 160 }} options={(seasons.data?.seasons ?? []).map((s) => ({ value: s.id, label: s.name }))} />
              </Form.Item>
            )}
            <Form.Item name="publishAt" label="发送时间（不选 = 现在）">
              <DatePicker showTime />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "填标题" }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="body" label="内容" rules={[{ required: true, message: "填内容" }]}>
            <Input.TextArea rows={4} maxLength={3000} />
          </Form.Item>
          <Button type="primary" onClick={() => void create()}>
            保存
          </Button>
        </Form>
      </Card>
      <Table<Announcement>
        rowKey="id"
        size="small"
        dataSource={a.data?.announcements ?? []}
        pagination={false}
        columns={[
          { title: "标题", dataIndex: "title" },
          { title: "发送时间", render: (_, r) => <Time iso={r.publishAt} /> },
          { title: "状态", render: (_, r) => (r.withdrawnAt ? <Tag>已撤回</Tag> : r.sentAt ? <Tag color="green">已发</Tag> : <Tag color="gold">等待发送</Tag>) },
          {
            title: "",
            render: (_, r) =>
              !r.sentAt &&
              !r.withdrawnAt && (
                <Popconfirm title="撤回这条公告？" onConfirm={() => void run(() => request("POST", `/v1/admin/announcements/${r.id}/withdraw`), "已撤回", a.reload)}>
                  <Button size="small">撤回</Button>
                </Popconfirm>
              ),
          },
        ]}
      />
    </Space>
  );
}

function SafetyQueue({ isAdmin }: { isAdmin: boolean }) {
  const q = useLoad(() => request<{ items: { id: string; objectKind: string; objectId: string; labels: string[]; status: string; forwardNote: string | null; createdAt: string }[] }>("GET", "/v1/admin/safety"));
  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={q.data?.items ?? []}
      pagination={false}
      locale={{ emptyText: "没有待处理的内容" }}
      columns={[
        { title: "时间", render: (_, r) => <Time iso={r.createdAt} /> },
        { title: "类型", render: (_, r) => ({ work: "团队作品", daily_task: "每日任务", card: "知识卡片" })[r.objectKind] ?? r.objectKind },
        { title: "标签", render: (_, r) => (r.labels as string[]).join("、") },
        { title: "复核员备注", dataIndex: "forwardNote" },
        { title: "状态", render: (_, r) => ({ pending: "待处理", passed: "已通过", removed: "已删除" })[r.status] ?? r.status },
        {
          title: "",
          render: (_, r) =>
            r.status === "pending" &&
            (isAdmin ? (
              <Space>
                <Button size="small" onClick={() => void run(() => request("POST", `/v1/admin/safety/${r.id}/pass`), "已通过", q.reload)}>
                  通过
                </Button>
                <Button size="small" danger onClick={() => void run(() => request("POST", `/v1/admin/safety/${r.id}/remove`), "已删除", q.reload)}>
                  删除
                </Button>
              </Space>
            ) : (
              <Button
                size="small"
                onClick={() => {
                  let note = "";
                  Modal.confirm({
                    title: "转给管理员",
                    content: <Input aria-label="备注" onChange={(e) => (note = e.target.value)} />,
                    onOk: () => run(() => request("POST", `/v1/admin/safety/${r.id}/forward`, { note: note || "请管理员看一下" }), "已转给管理员", q.reload),
                  });
                }}
              >
                转给管理员
              </Button>
            )),
        },
      ]}
    />
  );
}

const TASK: Record<string, string> = { daily_review: "每日任务审核", work_score: "作品初评", supply_score: "军需打分", summary: "周月报告" };

function AiConfig() {
  const c = useLoad(() => request<{ configs: { task: string; provider: string; model: string; promptVersion: number; fallbackModel: string | null; shadowModel: string | null }[] }>("GET", "/v1/admin/ai/config"));
  const [from] = useState(() => new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
  const [to] = useState(() => new Date().toISOString());
  const s = useLoad(() => request<{ byTaskAndModel: { task: string; model: string; role: string; calls: number; errorRate: number; avgLatencyMs: number; costYuan: number }[]; humanMinusAiByRubric: Record<string, { works: number; average: number }> }>("GET", `/v1/admin/ai/stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
  const [edit, setEdit] = useState<string | null>(null);
  const [form] = Form.useForm();
  const save = async () => {
    const v = await form.validateFields();
    await run(() => request("PUT", `/v1/admin/ai/config/${edit}`, { ...v, fallbackModel: v.fallbackModel || null, shadowModel: v.shadowModel || null }), "已保存", () => {
      setEdit(null);
      c.reload();
    });
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Table
        rowKey="task"
        size="small"
        dataSource={c.data?.configs ?? []}
        pagination={false}
        columns={[
          { title: "任务", render: (_, r) => TASK[r.task] ?? r.task },
          { title: "服务商 / 模型", render: (_, r) => `${r.provider} / ${r.model}` },
          { title: "提示词版本", dataIndex: "promptVersion" },
          { title: "备用", render: (_, r) => r.fallbackModel ?? "—" },
          { title: "影子", render: (_, r) => r.shadowModel ?? "—" },
          { title: "", render: (_, r) => <Button size="small" onClick={() => (form.setFieldsValue(r), setEdit(r.task))}>改</Button> },
        ]}
      />
      <Card size="small" title="最近 7 天">
        <Table
          rowKey={(r) => `${r.task}-${r.model}-${r.role}`}
          size="small"
          dataSource={s.data?.byTaskAndModel ?? []}
          pagination={false}
          locale={{ emptyText: "还没有调用" }}
          columns={[
            { title: "任务", render: (_, r) => TASK[r.task] ?? r.task },
            { title: "模型", dataIndex: "model" },
            { title: "角色", dataIndex: "role" },
            { title: "调用", dataIndex: "calls" },
            { title: "出错率", render: (_, r) => `${Math.round(r.errorRate * 100)}%` },
            { title: "平均耗时", render: (_, r) => `${r.avgLatencyMs} ms` },
            { title: "费用（元）", render: (_, r) => r.costYuan.toFixed(2) },
          ]}
        />
        {s.data && Object.keys(s.data.humanMinusAiByRubric).length > 0 && (
          <Typography.Paragraph style={{ marginTop: 8 }}>
            人工分 − AI 分（按评分族）：
            {Object.entries(s.data.humanMinusAiByRubric)
              .map(([k, v]) => `${k} ${v.average > 0 ? "+" : ""}${v.average}（${v.works} 件）`)
              .join("；")}
          </Typography.Paragraph>
        )}
      </Card>
      <Modal open={!!edit} title={`AI 配置：${TASK[edit ?? ""] ?? edit}`} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={() => setEdit(null)}>
        <Form form={form} layout="vertical">
          <Form.Item name="provider" label="服务商" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="promptVersion" label="提示词版本">
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="fallbackModel" label="备用模型">
            <Input />
          </Form.Item>
          <Form.Item name="shadowModel" label="影子模型（只记录不使用）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

// ---- 终局与导出 (§9) ------------------------------------------------------------------------------------

export function FinalPage() {
  const { serverId } = useParams();
  const seasons = useLoad(() => request<{ seasons: { id: string; name: string; statusLabel: string }[] }>("GET", "/v1/admin/seasons"));
  const [pool, setPool] = useState<number | null>(null);
  const [reviewSeason, setReviewSeason] = useState<string | null>(null);
  const reviews = useLoad(() => (reviewSeason ? request<{ reviews: { id: string; childId: string; releasedAt: string | null }[] }>("GET", `/v1/admin/seasons/${reviewSeason}/reviews`) : Promise.resolve({ reviews: [] })), [reviewSeason]);
  const requests = useLoad(() => request<{ requests: { id: string; kind: string; status: string; requestedAt: string; dueAt: string }[] }>("GET", "/v1/admin/data-requests"));
  const dl = (path: string, name: string) => void downloadText(path, name).catch((e) => message.error(errText(e)));
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        终局与导出
      </Typography.Title>
      <Card size="small" title="终局结算和奖学金">
        <Space direction="vertical">
          <ServerPicker base="/final" value={serverId} />
          {serverId && (
            <Space wrap>
              <InputNumber aria-label="奖池（元）" placeholder="奖池（元）" min={0} value={pool} onChange={setPool} />
              <Popconfirm
                title="确认终局结算？剩余粮草折成团队分，按名次分奖学金，之后赛季只读。"
                onConfirm={() => void run(() => request("POST", `/v1/admin/servers/${serverId}/finalize`, { poolYuan: pool ?? 0 }), "已结算")}
              >
                <Button type="primary" disabled={pool === null}>
                  终局结算
                </Button>
              </Popconfirm>
              <Button onClick={() => dl(`/v1/admin/servers/${serverId}/scholarship.csv`, "奖学金发放表.csv")}>下载奖学金发放表</Button>
            </Space>
          )}
        </Space>
      </Card>
      <Card size="small" title="赛季回顾">
        <Space wrap>
          <Select placeholder="选赛季" style={{ width: 200 }} value={reviewSeason} onChange={setReviewSeason} options={(seasons.data?.seasons ?? []).map((s) => ({ value: s.id, label: `${s.name}（${s.statusLabel}）` }))} />
          {reviewSeason && (
            <>
              <Button onClick={() => void run(() => request("POST", `/v1/admin/seasons/${reviewSeason}/reviews/generate`), "已生成（还没发）", reviews.reload)}>生成</Button>
              <Popconfirm title="发给所有赛季玩家？" onConfirm={() => void run(() => request("POST", `/v1/admin/seasons/${reviewSeason}/reviews/release`), "已发放", reviews.reload)}>
                <Button type="primary" disabled={!reviews.data?.reviews.some((r) => !r.releasedAt)}>
                  统一发放
                </Button>
              </Popconfirm>
              <Typography.Text type="secondary">
                已生成 {reviews.data?.reviews.length ?? 0} 份，已发 {reviews.data?.reviews.filter((r) => r.releasedAt).length ?? 0} 份
              </Typography.Text>
            </>
          )}
        </Space>
      </Card>
      <Card size="small" title="数据导出（CSV，导出会记进查看记录）">
        <Space wrap>
          <Button onClick={() => dl("/v1/admin/exports/daily.csv", "每日任务.csv")}>每日任务</Button>
          <Button onClick={() => dl("/v1/admin/exports/works.csv", "作品和分数.csv")}>作品和分数</Button>
          <Button onClick={() => dl("/v1/admin/exports/ledger.csv", "账本.csv")}>账本</Button>
          <Button onClick={() => dl("/v1/admin/exports/survey.csv", "问卷.csv")}>问卷</Button>
        </Space>
      </Card>
      <Card size="small" title="家长的导出 / 删除申请">
        {requests.error && <Alert type="error" message={requests.error} />}
        <Table
          rowKey="id"
          size="small"
          dataSource={requests.data?.requests ?? []}
          pagination={false}
          locale={{ emptyText: "没有申请" }}
          columns={[
            { title: "类型", render: (_, r) => (r.kind === "export" ? "导出" : "删除") },
            { title: "状态", render: (_, r) => ({ pending: "等待执行", done: "已完成", cancelled: "已撤回" })[r.status] ?? r.status },
            { title: "申请时间", render: (_, r) => <Time iso={r.requestedAt} /> },
            { title: "执行时间", render: (_, r) => <Time iso={r.dueAt} /> },
          ]}
        />
      </Card>
    </Space>
  );
}
