/**
 * 复核 (PRD part 7 §5) and 复核员看板 (§6):
 * - my queue, by due time, "快到时限" in red; registering leave;
 * - one work, blind (no team, no names): text, files with transcripts, the
 *   debate opening, the rubric with each dimension's maximum, the AI's draft
 *   to compare; submitting is final (corrections are an admin ruling);
 * - 每日任务异常: tasks the AI could not review; decide pass / fail with tag,
 *   difficulty and feedback;
 * - the reviewers' dashboard (admin).
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { TAXONOMY } from "@zhiyouji/shared";
import { ApiError, request } from "../api";
import { useAdmin } from "../auth";
import { Time } from "../time";
import { useLoad } from "../useLoad";

const KIND: Record<string, string> = { contest: "区域争夺", war: "周战争", line: "大团战战线", main: "大团战主战场" };
const FLAG: Record<string, string> = { plagiarism: "疑似抄袭", inappropriate: "内容不当", needs_admin: "需要管理员看" };

const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

interface QueueRow {
  assignmentId: string;
  workId: string;
  kind: string;
  promptId: string | null;
  second: boolean;
  dueAt: string;
  dueSoon: boolean;
}

export function ReviewPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        复核
      </Typography.Title>
      <Tabs
        items={[
          { key: "works", label: "作品", children: <ReviewQueue /> },
          { key: "daily", label: "每日任务异常", children: <DailyExceptions /> },
        ]}
      />
    </Space>
  );
}

function ReviewQueue() {
  const q = useLoad(() => request<{ reviews: QueueRow[] }>("GET", "/v1/admin/reviews"));
  const nav = useNavigate();
  const [leave, setLeave] = useState<[string, string] | null>(null);
  const saveLeave = async () => {
    if (!leave) return;
    try {
      await request("POST", "/v1/admin/reviews/leave", { from: leave[0], to: leave[1] });
      message.success("请假已登记，这几天不会给你分作品");
      setLeave(null);
    } catch (e) {
      message.error(errText(e));
    }
  };
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {q.error && <Alert type="error" message={q.error} />}
      <Table<QueueRow>
        rowKey="assignmentId"
        loading={q.loading}
        dataSource={q.data?.reviews ?? []}
        locale={{ emptyText: "现在没有要复核的作品" }}
        pagination={false}
        onRow={(r) => ({ onClick: () => nav(`/review/${r.assignmentId}`), style: { cursor: "pointer" } })}
        columns={[
          { title: "类型", render: (_, r) => KIND[r.kind] ?? r.kind },
          { title: "", render: (_, r) => (r.second ? <Tag>抽查（第二人）</Tag> : null) },
          {
            title: "时限",
            render: (_, r) => (
              <Space>
                <Time iso={r.dueAt} />
                {r.dueSoon && <Tag color="red">快到时限</Tag>}
              </Space>
            ),
          },
          { title: "", render: (_, r) => <Link to={`/review/${r.assignmentId}`}>打开</Link> },
        ]}
      />
      <Card size="small" title="请假">
        <Space wrap>
          <DatePicker.RangePicker onChange={(_, s) => setLeave(s[0] && s[1] ? [s[0], s[1]] : null)} />
          <Button disabled={!leave} onClick={() => void saveLeave()}>
            登记请假
          </Button>
          <Typography.Text type="secondary">请假的日子不分新作品；已经分到的照常要交。</Typography.Text>
        </Space>
      </Card>
    </Space>
  );
}

interface FileView {
  id: string;
  kind: string;
  contentType: string;
  transcript: string | null;
  url: string;
}

interface ReviewView {
  assignmentId: string;
  status: string;
  second: boolean;
  dueAt: string;
  opening: { text: string | null; mediaKind: string; files: FileView[] } | null;
  work: { id: string; kind: string; promptId: string | null; mediaKind: string; text: string | null; aiNote: string | null; submittedAt: string; files: FileView[] };
  rubric: { id: string; name: string; version: number; dims: { key: string; name: string; max: number }[] };
  ai: { total: number; dims: Record<string, number>; comment: string; flags: string[]; model: string } | null;
}

function Files({ files }: { files: FileView[] }) {
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {files.map((f) => (
        <div key={f.id}>
          {f.kind === "image" ? (
            <img src={f.url} alt="作品图片" style={{ maxWidth: "100%", maxHeight: 480 }} />
          ) : f.kind === "video" ? (
            <video src={f.url} controls style={{ maxWidth: "100%", maxHeight: 480 }} />
          ) : f.kind === "audio" ? (
            <audio src={f.url} controls />
          ) : (
            <a href={f.url} target="_blank" rel="noreferrer">
              打开文件
            </a>
          )}
          {f.transcript && <Typography.Paragraph type="secondary">转写：{f.transcript}</Typography.Paragraph>}
        </div>
      ))}
    </Space>
  );
}

export function ReviewWorkPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const v = useLoad(() => request<ReviewView>("GET", `/v1/admin/reviews/${id}`), [id]);
  const [dims, setDims] = useState<Record<string, number | null>>({});
  const [comment, setComment] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const d = v.data;
  const total = Object.values(dims).reduce<number>((s, x) => s + (x ?? 0), 0);

  const submit = () => {
    if (!d) return;
    if (d.rubric.dims.some((x) => dims[x.key] === undefined || dims[x.key] === null)) return void message.warning("每个维度都要打分");
    if (!comment.trim()) return void message.warning("写几句评语：哪里好、哪里扣分、下次怎么改");
    Modal.confirm({
      title: `交分 ${total} 分？`,
      content: "交了以后不能改；要改只能请管理员裁定。",
      okText: "交分",
      cancelText: "再看看",
      onOk: async () => {
        setBusy(true);
        try {
          await request("POST", `/v1/admin/reviews/${id}`, { dims, comment, flags });
          message.success("已交分");
          nav("/review");
        } catch (e) {
          message.error(errText(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        复核作品
      </Typography.Title>
      {v.error && <Alert type="error" message={v.error} />}
      {d && (
        <>
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="类型">{KIND[d.work.kind] ?? d.work.kind}</Descriptions.Item>
            <Descriptions.Item label="评分族">
              {d.rubric.id} · {d.rubric.name}（v{d.rubric.version}）
            </Descriptions.Item>
            <Descriptions.Item label="时限">
              <Time iso={d.dueAt} />
            </Descriptions.Item>
          </Descriptions>
          {d.status !== "pending" && <Alert type="info" message={d.status === "timeout" ? "已超时，按 AI 分结算了" : "已经交过分了"} />}
          {d.opening && (
            <Card title="同一组的立论（辩论）" size="small">
              {d.opening.text && <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{d.opening.text}</Typography.Paragraph>}
              <Files files={d.opening.files} />
            </Card>
          )}
          <Card title={d.opening ? "驳论（这件作品）" : "作品"} size="small">
            {d.work.text && <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{d.work.text}</Typography.Paragraph>}
            <Files files={d.work.files} />
            {d.work.aiNote && <Typography.Paragraph type="secondary">人机协作说明：{d.work.aiNote}</Typography.Paragraph>}
          </Card>
          <Card title="打分" size="small">
            <Table
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={d.rubric.dims}
              columns={[
                { title: "维度", dataIndex: "name" },
                { title: "满分", dataIndex: "max" },
                {
                  title: "我的分",
                  render: (_, x) => (
                    <InputNumber aria-label={`${x.name}得分`} min={0} max={x.max} precision={0} value={dims[x.key] ?? null} disabled={d.status !== "pending"} onChange={(n) => setDims({ ...dims, [x.key]: n })} />
                  ),
                },
                { title: "AI 初评（参考）", render: (_, x) => (d.ai ? (d.ai.dims[x.key] ?? "—") : "—") },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>{d.rubric.dims.reduce((s, x) => s + x.max, 0)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2}>{total}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3}>{d.ai?.total ?? "—"}</Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
            {d.ai && <Typography.Paragraph type="secondary">AI 评语（{d.ai.model}）：{d.ai.comment}</Typography.Paragraph>}
            <Form layout="vertical" style={{ marginTop: 12 }}>
              <Form.Item label="评语（孩子会看到：哪里好、哪里扣分、下次怎么改）">
                <Input.TextArea aria-label="评语" rows={4} value={comment} disabled={d.status !== "pending"} onChange={(e) => setComment(e.target.value)} />
              </Form.Item>
              <Form.Item label="标记">
                <Checkbox.Group options={Object.entries(FLAG).map(([value, label]) => ({ value, label }))} value={flags} onChange={(v) => setFlags(v as string[])} disabled={d.status !== "pending"} />
              </Form.Item>
              <Button type="primary" loading={busy} disabled={d.status !== "pending"} onClick={submit}>
                交分
              </Button>
            </Form>
          </Card>
        </>
      )}
    </Space>
  );
}

// ---- 每日任务异常队列 -----------------------------------------------------------------------------------

interface DailyTask {
  id: string;
  childId: string;
  templateId: number;
  grade: number;
  submittedAt: string;
  explainText: string | null;
  aiNote: string | null;
  noAi: boolean;
  files: { id: string; kind: string; transcript: string | null; url: string }[];
}

function DailyExceptions() {
  const q = useLoad(() => request<{ tasks: DailyTask[] }>("GET", "/v1/admin/daily/exceptions"));
  const [open, setOpen] = useState<DailyTask | null>(null);
  return (
    <>
      <Table<DailyTask>
        rowKey="id"
        loading={q.loading}
        dataSource={q.data?.tasks ?? []}
        locale={{ emptyText: "没有卡住的每日任务" }}
        pagination={false}
        columns={[
          { title: "交的时间", render: (_, t) => <Time iso={t.submittedAt} /> },
          { title: "模板", dataIndex: "templateId" },
          { title: "年级", dataIndex: "grade" },
          { title: "讲解", render: (_, t) => (t.explainText ? t.explainText.slice(0, 30) : "语音") },
          { title: "", render: (_, t) => <Button onClick={() => setOpen(t)}>处理</Button> },
        ]}
      />
      {open && (
        <DecideModal
          task={open}
          onClose={(done) => {
            setOpen(null);
            if (done) q.reload();
          }}
        />
      )}
    </>
  );
}

const SUBJECTS = Object.keys(TAXONOMY);

function DecideModal({ task, onClose }: { task: DailyTask; onClose: (done: boolean) => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const subject = Form.useWatch("subject", form) as string | undefined;
  const passed = Form.useWatch("passed", form) as boolean | undefined;
  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      await request("POST", `/v1/admin/daily/${task.id}/decide`, {
        passed: v.passed,
        expression: v.expression,
        aiLevel: task.noAi ? null : v.aiLevel,
        mainTag: `${v.subject}/${v.sub}`,
        difficulty: v.difficulty,
        feedbackGood: v.feedbackGood || undefined,
        feedbackBetter: v.feedbackBetter || undefined,
        failReason: v.passed ? undefined : v.failReason,
        cardTitle: v.cardTitle || undefined,
      });
      message.success("已处理，孩子马上能看到结果");
      onClose(true);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="处理每日任务" okText="保存" cancelText="取消" confirmLoading={busy} onOk={() => void save()} onCancel={() => onClose(false)} width={720}>
      <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{task.explainText ?? "（语音讲解，见下面的录音和转写）"}</Typography.Paragraph>
      {task.aiNote && <Typography.Paragraph type="secondary">人机协作：{task.aiNote}</Typography.Paragraph>}
      <Files files={task.files.map((f) => ({ ...f, contentType: "" }))} />
      <Form form={form} layout="vertical" initialValues={{ passed: true, expression: 2, aiLevel: 2, difficulty: 2 }}>
        <Form.Item name="passed" label="结果">
          <Radio.Group
            options={[
              { value: true, label: "通过" },
              { value: false, label: "不通过" },
            ]}
          />
        </Form.Item>
        {passed === false && (
          <Form.Item name="failReason" label="不通过的原因和改法（孩子会看到）" rules={[{ required: true, message: "写一下原因" }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        )}
        <Space wrap>
          <Form.Item name="subject" label="学科" rules={[{ required: true, message: "选学科" }]}>
            <Select style={{ width: 200 }} options={SUBJECTS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="sub" label="子领域" rules={[{ required: true, message: "选子领域" }]}>
            <Select style={{ width: 200 }} options={(subject ? (TAXONOMY[subject] ?? []) : []).map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="difficulty" label="难度（1–6）">
            <InputNumber min={1} max={6} />
          </Form.Item>
          <Form.Item name="expression" label="表达（0–4）">
            <InputNumber min={0} max={4} />
          </Form.Item>
          {!task.noAi && (
            <Form.Item name="aiLevel" label="人机协作（0–4）">
              <InputNumber min={0} max={4} />
            </Form.Item>
          )}
        </Space>
        <Form.Item name="cardTitle" label="知识卡片标题（可空）">
          <Input maxLength={15} />
        </Form.Item>
        <Form.Item name="feedbackGood" label="做得好的">
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="feedbackBetter" label="可以更好的">
          <Input maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---- 复核员看板 (§6) ------------------------------------------------------------------------------------

interface ReviewerRow {
  reviewerId: string;
  name: string;
  assigned: number;
  pending: number;
  doneOnTime: number;
  timedOutToAi: number;
  averageMinutes: number | null;
  averageGapWithSecond: number | null;
  averageGapWithAi: number | null;
}

export function ReviewersPage() {
  const me = useAdmin();
  const d = useLoad(() => request<{ reviewers: ReviewerRow[]; total: { settled: number; timedOutToAi: number } }>("GET", "/v1/admin/reviewers/dashboard"));
  if (me.role !== "admin") return null;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        复核员看板
      </Typography.Title>
      {d.data && (
        <Typography.Text>
          已结算 {d.data.total.settled} 件，其中超时按 AI 分结算 {d.data.total.timedOutToAi} 件
        </Typography.Text>
      )}
      <Table<ReviewerRow>
        rowKey="reviewerId"
        loading={d.loading}
        dataSource={d.data?.reviewers ?? []}
        pagination={false}
        locale={{ emptyText: "还没有分配过作品" }}
        columns={[
          { title: "复核员", dataIndex: "name" },
          { title: "分到", dataIndex: "assigned" },
          { title: "待交", dataIndex: "pending" },
          { title: "按时完成", dataIndex: "doneOnTime" },
          { title: "超时按 AI 结算", dataIndex: "timedOutToAi", render: (n: number) => (n ? <Typography.Text type="danger">{n}</Typography.Text> : 0) },
          { title: "平均用时（分钟）", render: (_, r) => r.averageMinutes ?? "—" },
          { title: "和第二人平均分差", render: (_, r) => r.averageGapWithSecond ?? "—" },
          { title: "和 AI 平均分差", render: (_, r) => r.averageGapWithAi ?? "—" },
        ]}
      />
    </Space>
  );
}
