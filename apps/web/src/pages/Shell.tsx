/** The five tabs (PRD part 5 §1): 首页、地图、小组、战报、我. */

import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Badge, TabBar } from "antd-mobile";
import { AppOutline, EnvironmentOutline, FileOutline, TeamOutline, UserOutline } from "antd-mobile-icons";
import { api } from "../api";

const TABS = [
  { key: "/", title: "首页", icon: <AppOutline /> },
  { key: "/map", title: "地图", icon: <EnvironmentOutline /> },
  { key: "/team", title: "小组", icon: <TeamOutline /> },
  { key: "/report", title: "战报", icon: <FileOutline /> },
  { key: "/me", title: "我", icon: <UserOutline /> },
];

/** Unread messages, refreshed when the page comes back into view. */
export function useUnread(): [number, () => void] {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    api.unreadCount().then(
      (r) => setN(r.unread),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  return [n, load];
}

export function Shell() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [unread, reload] = useUnread();
  const active = TABS.find((t) => t.key !== "/" && pathname.startsWith(t.key))?.key ?? "/";
  useEffect(reload, [pathname, reload]);

  return (
    <>
      <div className="page with-tabbar">
        <Outlet context={{ unread, reloadUnread: reload }} />
      </div>
      <nav className="tabbar" aria-label="主菜单">
        <TabBar activeKey={active} onChange={(k) => nav(k)}>
          {TABS.map((t) => (
            <TabBar.Item key={t.key} title={t.title} icon={t.key === "/report" ? <Badge content={unread > 0 ? (unread > 99 ? "99+" : unread) : null}>{t.icon}</Badge> : t.icon} />
          ))}
        </TabBar>
      </nav>
    </>
  );
}

export interface ShellContext {
  unread: number;
  reloadUnread: () => void;
}
