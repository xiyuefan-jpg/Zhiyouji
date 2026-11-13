/** Routes of the admin console. */

import { Navigate, Route, Routes } from "react-router";
import { Spin } from "antd";
import { useAdmin, useAuth } from "./auth";
import { InvitePage, LoginPage } from "./pages/Auth";
import { ConsoleLayout, NAV } from "./pages/Layout";
import { ComingPage, DashboardPage, NotificationsPage, UsersPage, ViewLogPage } from "./pages/Pages";
import { ReviewersPage, ReviewPage, ReviewWorkPage } from "./pages/ReviewPages";
import { MonitorPage } from "./pages/MonitorPages";

const BUILT = new Set(["/", "/users", "/view-log", "/review", "/reviewers", "/monitor"]);

export function App() {
  return (
    <Routes>
      <Route path="/invite" element={<InvitePage />} />
      <Route path="*" element={<Gate />} />
    </Routes>
  );
}

function Gate() {
  const { state } = useAuth();
  if (state.status === "loading")
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin />
      </div>
    );
  if (state.status === "out") return <LoginPage />;
  return <Console />;
}

function Console() {
  const me = useAdmin();
  const allowed = NAV.filter((n) => n.roles.includes(me.role));
  return (
    <Routes>
      <Route element={<ConsoleLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        {me.role === "admin" && <Route path="users" element={<UsersPage />} />}
        {me.role === "admin" && <Route path="view-log" element={<ViewLogPage />} />}
        <Route path="review" element={<ReviewPage />} />
        <Route path="review/:id" element={<ReviewWorkPage />} />
        <Route path="reviews/:id" element={<ReviewWorkPage />} />
        {me.role === "admin" && <Route path="reviewers" element={<ReviewersPage />} />}
        {me.role === "admin" && <Route path="monitor" element={<MonitorPage />} />}
        {me.role === "admin" && <Route path="monitor/:serverId" element={<MonitorPage />} />}
        {me.role === "admin" && <Route path="servers/:serverId" element={<MonitorPage />} />}
        {allowed
          .filter((n) => !BUILT.has(n.key))
          .map((n) => (
            <Route key={n.key} path={n.key.slice(1)} element={<ComingPage path={n.key} />} />
          ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
