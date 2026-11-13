/**
 * The tab pages. 首页、地图、小组、战报 show what is ready now; the season
 * parts (map, team, reports) fill in as the server's season endpoints land.
 */

import { Link, useOutletContext, useSearchParams } from "react-router";
import { Tabs } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { Avatar, Empty, ReadAloud, Seal } from "../components/ui";
import { greeting } from "../format";
import { useChild } from "../session";
import { MessageList } from "./Messages";
import type { ShellContext } from "./Shell";

export function Home() {
  const child = useChild();
  const { unread } = useOutletContext<ShellContext>();
  const hello = `${greeting()}，${child.nickname}`;
  return (
    <>
      <div className="row" style={{ marginTop: 8 }}>
        <Avatar id={child.avatar} size={52} />
        <div className="grow">
          <h1 className="title" style={{ margin: 0 }}>
            {hello}
          </h1>
        </div>
        <ReadAloud text={`${hello}。今天要做的事都在这里。`} />
      </div>

      {unread > 0 && (
        <Link to="/report?tab=messages" className="panel row" style={{ marginTop: 18, textDecoration: "none", color: "inherit", borderColor: "var(--vermilion)" }}>
          <span className="unread-dot" />
          <span className="grow">你有 {unread} 条新消息</span>
          <RightOutline />
        </Link>
      )}

      <h2 className="section-title">今天要做的事</h2>
      <div className="panel">
        <Empty title="今天还没有要做的事" icon={<Seal text="闲" size={48} tilt={3} outline />}>
          每日任务开放、赛季开始以后，要做的事会按截止时间排在这里。
        </Empty>
      </div>
    </>
  );
}

export function MapTab() {
  return (
    <>
      <h1 className="title">地图</h1>
      <Empty title="赛季地图还没有打开">分组公布以后，这里会显示本服的地图：每块地的主人、产出，以及正在进行的争夺。</Empty>
    </>
  );
}

export function TeamTab() {
  return (
    <>
      <h1 className="title">小组</h1>
      <Empty title="还没有分组">开通赛季资格、分好组以后，这里会显示你的小组：组员、粮草、团队分、法宝囊和作品工坊。</Empty>
    </>
  );
}

const REPORT_TABS = [
  { key: "reports", title: "战报" },
  { key: "broadcast", title: "全服广播" },
  { key: "ranking", title: "排行榜" },
  { key: "messages", title: "我的消息" },
];

export function ReportTab() {
  const [params, setParams] = useSearchParams();
  const { reloadUnread } = useOutletContext<ShellContext>();
  const tab = REPORT_TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "reports";
  return (
    <>
      <h1 className="title">战报</h1>
      <Tabs activeKey={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} style={{ "--title-font-size": "16px", "--active-line-color": "var(--ochre)", "--active-title-color": "var(--ink)" } as React.CSSProperties}>
        {REPORT_TABS.map((t) => (
          <Tabs.Tab key={t.key} title={t.title} />
        ))}
      </Tabs>
      <div style={{ marginTop: 16 }}>
        {tab === "reports" && <Empty title="还没有战报">赛季开始后，每天早、中、晚三次公布战报：争夺结果、周战争、法宝使用和排名变化。</Empty>}
        {tab === "broadcast" && <Empty title="还没有广播">谁发起了进攻、谁用了法宝、谁买下了中心地，会实时出现在这里。</Empty>}
        {tab === "ranking" && <Empty title="还没有排行榜">赛季开始后，这里显示本服各组的团队分和名次。</Empty>}
        {tab === "messages" && <MessageList onChange={reloadUnread} />}
      </div>
    </>
  );
}
