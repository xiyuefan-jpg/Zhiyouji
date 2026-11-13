/** 我的消息 (PRD part 5 F6): notifications for this child and the family. */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button, DotLoading } from "antd-mobile";
import type { MessageView } from "@zhiyouji/shared";
import { api } from "../api";
import { Empty } from "../components/ui";
import { shortTime } from "../format";

const PAGE = 30;

export function MessageList({ onChange }: { onChange?: () => void }) {
  const nav = useNavigate();
  const [items, setItems] = useState<MessageView[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    try {
      const r = await api.messages(before);
      setItems((cur) => (before && cur ? [...cur, ...r.messages] : r.messages));
      setMore(r.messages.length >= PAGE);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(m: MessageView) {
    if (!m.read) {
      setItems((cur) => cur?.map((x) => (x.id === m.id ? { ...x, read: true } : x)) ?? cur);
      await api.readMessage(m.id).catch(() => undefined);
      onChange?.();
    }
    if (m.link?.startsWith("/")) nav(m.link);
  }

  async function readAll() {
    await api.readAll().catch(() => undefined);
    setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    onChange?.();
  }

  if (error && !items)
    return (
      <Empty title="消息没有加载出来">
        <p>{error}</p>
        <Button size="small" onClick={() => void load()}>
          再试一次
        </Button>
      </Empty>
    );
  if (!items)
    return (
      <div className="empty">
        <DotLoading />
      </div>
    );
  if (items.length === 0)
    return (
      <Empty title="还没有消息">
        被进攻、审核结果、公告这些通知都会出现在这里。紧急的提醒还会发短信到家长手机。
      </Empty>
    );

  const unread = items.some((m) => !m.read);
  return (
    <div>
      {unread && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <Button size="small" fill="none" style={{ color: "var(--ochre)" }} onClick={() => void readAll()}>
            全部标为已读
          </Button>
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {items.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="panel"
              onClick={() => void open(m)}
              style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", display: "block" }}
            >
              <div className="row" style={{ alignItems: "baseline" }}>
                {!m.read && <span className="unread-dot" aria-label="未读" />}
                <span className="grow" style={{ fontWeight: m.read ? 500 : 700 }}>
                  {m.title}
                </span>
                <span className="hint" style={{ flex: "none" }}>
                  {shortTime(m.createdAt)}
                </span>
              </div>
              <div style={{ color: "var(--ink-2)", marginTop: 4 }}>{m.body}</div>
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <Button block fill="none" style={{ marginTop: 12, color: "var(--ochre)" }} onClick={() => void load(items[items.length - 1]!.createdAt)}>
          加载更多
        </Button>
      )}
    </div>
  );
}
