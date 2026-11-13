/**
 * 新手引导 (PRD part 5 A5): 3–4 screens — how the daily task works, what the
 * 修行日志 is; season players also get the map, the team, grain and team
 * points. Can be skipped, and replayed from 我 → 设置.
 *
 * The first-time cards on the home page: the guide (until seen or skipped,
 * remembered per child on this device) and 土地公问卷 (until done).
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "antd-mobile";
import { request } from "../api";
import { PageHeader, ReadAloud, Seal } from "../components/ui";
import { useChild } from "../session";
import { useLoad } from "./season/useSeason";

const COMMON = [
  { glyph: "修", title: "每日任务", text: "每天用 AI 学一个新知识，再用自己的话讲出来：交一张证据图片，按住说话讲一讲，再说一句你是怎么用 AI 的。土地公看过以后，会给你一张知识卡片。" },
  { glyph: "日", title: "修行日志", text: "你的每一张知识卡片都收在修行日志里：按日历、按学科都能找到，还能听到自己当时的讲解。每周、每月还有一份小结。" },
];

const SEASON = [
  { glyph: "图", title: "地图和小组", text: "赛季里，你和小组的伙伴一起争夺地盘：发起进攻、做作品、把知识讲明白，就能拿下或守住一块地。组长和副组长负责花粮草和提交。" },
  { glyph: "分", title: "粮草和团队分", text: "粮草用来进攻、买法宝，每日任务和军需任务能挣粮草；团队分决定小组的名次，地块每天都会产出团队分。" },
];

export function guideKey(childId: string): string {
  return `zyj_guide_${childId}`;
}

function markSeen(childId: string) {
  try {
    localStorage.setItem(guideKey(childId), "1");
  } catch {
    /* storage blocked: the card shows again next time */
  }
}

export function GuidePage() {
  const child = useChild();
  const nav = useNavigate();
  const me = useLoad(() => request<{ status: string }>("GET", "/v1/season/me"));
  const screens = [...COMMON, ...(me.data && me.data.status !== "none" ? SEASON : [])];
  const [i, setI] = useState(0);
  const s = screens[Math.min(i, screens.length - 1)]!;
  const done = () => {
    markSeen(child.id);
    nav("/", { replace: true });
  };
  return (
    <div className="page">
      <PageHeader title="怎么玩" right={<Button size="small" onClick={done}>跳过</Button>} />
      <div className="panel" style={{ textAlign: "center", padding: 24 }}>
        <Seal text={s.glyph} size={64} tilt={-3} />
        <h2 className="section-title">{s.title}</h2>
        <p style={{ textAlign: "left" }}>{s.text}</p>
        <ReadAloud text={`${s.title}。${s.text}`} />
      </div>
      <div className="hint" style={{ textAlign: "center" }}>
        {i + 1} / {screens.length}
      </div>
      {i + 1 < screens.length ? (
        <Button color="primary" block className="big-button" style={{ marginTop: 16 }} onClick={() => setI(i + 1)}>
          下一页
        </Button>
      ) : (
        <Button color="primary" block className="big-button" style={{ marginTop: 16 }} onClick={done}>
          知道了
        </Button>
      )}
    </div>
  );
}

/** Home page cards for a new child: the guide and 土地公问卷. */
export function FirstSteps() {
  const child = useChild();
  const survey = useLoad(() => request<{ done: boolean }>("GET", "/v1/survey"), [child.id]);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(guideKey(child.id)) === "1";
    } catch {
      return true;
    }
  });
  const link = { textDecoration: "none", color: "inherit" } as const;
  return (
    <>
      {!seen && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600 }}>第一次来？看看怎么玩（1 分钟）</div>
          <div className="row" style={{ marginTop: 8 }}>
            <Link to="/guide">
              <Button size="small" color="primary">
                看看
              </Button>
            </Link>
            <Button
              size="small"
              onClick={() => {
                markSeen(child.id);
                setSeen(true);
              }}
            >
              跳过
            </Button>
          </div>
        </div>
      )}
      {survey.data && !survey.data.done && (
        <Link to="/survey" className="panel row" style={{ ...link, marginTop: 12 }}>
          <Seal text="土" size={40} tilt={-3} />
          <span className="grow">
            <span style={{ fontWeight: 600 }}>和土地公认识一下</span>
            <span className="hint">（7 个问题，3 分钟）</span>
          </span>
        </Link>
      )}
    </>
  );
}
