/** Console frame: menu on the left (PRD part 7 sections), account and notifications on top. */

import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { Badge, Button, Dropdown, Layout, Menu, Typography } from "antd";
import {
  AuditOutlined,
  BellOutlined,
  BookOutlined,
  CalendarOutlined,
  DashboardOutlined,
  EyeOutlined,
  FlagOutlined,
  MonitorOutlined,
  NotificationOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { AdminRole } from "@zhiyouji/shared";
import { api } from "../api";
import { useAdmin, useAuth } from "../auth";

export interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  roles: AdminRole[];
}

/** Menu by PRD part 7 section; reviewers see only what part 7 §0 allows. */
export const NAV: NavItem[] = [
  { key: "/", label: "看板", icon: <DashboardOutlined />, roles: ["admin", "reviewer"] },
  { key: "/review", label: "复核", icon: <AuditOutlined />, roles: ["admin", "reviewer"] },
  { key: "/season", label: "赛季", icon: <CalendarOutlined />, roles: ["admin"] },
  { key: "/players", label: "玩家与分组", icon: <TeamOutlined />, roles: ["admin"] },
  { key: "/content", label: "题库与评分", icon: <BookOutlined />, roles: ["admin", "reviewer"] },
  { key: "/reviewers", label: "复核员看板", icon: <FlagOutlined />, roles: ["admin"] },
  { key: "/monitor", label: "赛季监控与干预", icon: <MonitorOutlined />, roles: ["admin"] },
  { key: "/ops", label: "内容与运营", icon: <NotificationOutlined />, roles: ["admin"] },
  { key: "/final", label: "终局与导出", icon: <TrophyOutlined />, roles: ["admin"] },
  { key: "/users", label: "管理端账号", icon: <UserOutlined />, roles: ["admin"] },
  { key: "/view-log", label: "查看记录", icon: <EyeOutlined />, roles: ["admin"] },
];

export function useAdminUnread(): [number, () => void] {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    api.unreadCount().then(
      (r) => setN(r.unread),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  return [n, load];
}

export function ConsoleLayout() {
  const me = useAdmin();
  const { signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [unread, reloadUnread] = useAdminUnread();
  const items = NAV.filter((n) => n.roles.includes(me.role));
  const selected = items.filter((n) => n.key === "/" ? pathname === "/" : pathname.startsWith(n.key)).map((n) => n.key);
  useEffect(reloadUnread, [pathname, reloadUnread]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider breakpoint="lg" collapsedWidth={0} width={208} theme="light" style={{ borderRight: "1px solid #eadcc6" }}>
        <div style={{ padding: "18px 20px", fontWeight: 700, fontSize: 17 }}>智游记管理端</div>
        <Menu mode="inline" selectedKeys={selected} items={items.map((n) => ({ key: n.key, icon: n.icon, label: n.label }))} onClick={(e) => nav(e.key)} style={{ borderInlineEnd: "none" }} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: "#fff", borderBottom: "1px solid #eadcc6", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, paddingInline: 24 }}>
          <Badge count={unread} size="small">
            <Button type="text" icon={<BellOutlined />} aria-label="通知中心" onClick={() => nav("/notifications")} />
          </Badge>
          <Dropdown
            menu={{
              items: [
                { key: "role", label: me.role === "admin" ? "管理员" : "复核员", disabled: true },
                { key: "logout", label: "退出登录" },
              ],
              onClick: (e) => e.key === "logout" && void signOut(),
            }}
          >
            <Typography.Text style={{ cursor: "pointer" }}>{me.name}</Typography.Text>
          </Dropdown>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Outlet context={{ reloadUnread }} />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
