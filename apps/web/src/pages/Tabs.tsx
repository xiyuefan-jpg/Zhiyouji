/**
 * The tab pages. 首页、地图、小组、战报 show what is ready now; the season
 * parts (map, team, reports) fill in as the server's season endpoints land.
 */

import { Link, useOutletContext, useSearchParams } from "react-router";
import { Tabs } from "antd-mobile";
import { RightOutline } from "antd-mobile-icons";
import { Avatar, Empty, ReadAloud } from "../components/ui";
import { greeting } from "../format";
import { useChild } from "../session";
import { MessageList } from "./Messages";
import { BroadcastList, RankingList, ReportsList } from "./season/SeasonPages";
import { FeaturedWatch, WatchBroadcasts, WatchRanking } from "./WatchPages";
import { HomeBody } from "./season/HomePage";
import { useSeasonMe } from "./season/useSeason";
import { FirstSteps } from "./GuidePage";
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


      <FirstSteps />
      <HomeBody />
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

/** Free users (part 5 §1): the watched server's broadcasts, ranking and published works, and their messages. */
const WATCH_TABS = [
  { key: "broadcast", title: "全服广播" },
  { key: "ranking", title: "排行榜" },
  { key: "showcase", title: "作品展" },
  { key: "messages", title: "我的消息" },
];

export function ReportTab() {
  const [params, setParams] = useSearchParams();
  const { reloadUnread } = useOutletContext<ShellContext>();
  const me = useSeasonMe();
  const watching = !!me.data && me.data.status !== "playing";
  const tabs = watching ? WATCH_TABS : REPORT_TABS;
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab")! : tabs[0]!.key;
  return (
    <>
      <h1 className="title">战报</h1>
      <Tabs activeKey={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} style={{ "--title-font-size": "16px", "--active-line-color": "var(--ochre)", "--active-title-color": "var(--ink)" } as React.CSSProperties}>
        {tabs.map((t) => (
          <Tabs.Tab key={t.key} title={t.title} />
        ))}
      </Tabs>
      <div style={{ marginTop: 16 }}>
        {tab === "messages" && <MessageList onChange={reloadUnread} />}
        {!watching && tab === "reports" && <ReportsList />}
        {!watching && tab === "broadcast" && <BroadcastList />}
        {!watching && tab === "ranking" && <RankingList />}
        {watching && tab !== "messages" && (
          <FeaturedWatch>
            {(s) =>
              tab === "broadcast" ? (
                <WatchBroadcasts serverId={s.id} />
              ) : tab === "ranking" ? (
                <WatchRanking serverId={s.id} />
              ) : (
                <Link to={`/watch/${s.id}/showcase`} className="panel row" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="grow">看这个服结算后公开的作品</span>
                </Link>
              )
            }
          </FeaturedWatch>
        )}
      </div>
    </>
  );
}
