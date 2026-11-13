/**
 * What to show, in order (PRD part 5 §2.1):
 * privacy pop-up (first open) → login → 家长确认 → 我是谁 → the five tabs.
 * The three documents can be read at any step.
 */

import { useState } from "react";
import { Link, Navigate, Outlet, Route, Routes } from "react-router";
import { Button } from "antd-mobile";
import { Empty } from "./components/ui";
import { SessionProvider, useSession } from "./session";
import { ChildForm, ChooseChild, EditChild } from "./pages/Children";
import { Consent } from "./pages/Consent";
import { acceptPrivacy, DocPage, privacyAccepted, PrivacyGate, Splash } from "./pages/Gate";
import { Login } from "./pages/Login";
import { AboutPage, MeTab, PrivacyPage, Settings } from "./pages/Me";
import { Shell } from "./pages/Shell";
import { Home, ReportTab } from "./pages/Tabs";
import { LandPage, LedgerPage, SeasonMap, SeasonTeam } from "./pages/season/SeasonPages";
import { DailyHome, DailyNew, DailyResult } from "./pages/DailyPages";
import { WorkSlot, WorksList } from "./pages/season/WorksPages";
import { ItemsPage } from "./pages/season/ItemsPage";
import { ContestPage, RoundPage } from "./pages/season/TeamPages";
import { BigBattlePage, ShopPage, SupplyPage, WarsPage, WarWeekPage } from "./pages/season/BattlePages";

export function App() {
  const [privacyOk, setPrivacyOk] = useState(privacyAccepted);
  return (
    <Routes>
      <Route path="/docs/:slug" element={<DocPage />} />
      <Route
        path="*"
        element={
          privacyOk ? (
            <SessionProvider>
              <Gate />
            </SessionProvider>
          ) : (
            <PrivacyGate
              onAccept={() => {
                acceptPrivacy();
                setPrivacyOk(true);
              }}
            />
          )
        }
      />
    </Routes>
  );
}

function Plain() {
  return (
    <div className="page">
      <Outlet />
    </div>
  );
}

function Gate() {
  const { state, refresh } = useSession();
  if (state.status === "loading") return <Splash />;
  if (state.status === "error")
    return (
      <div className="page">
        <Empty title="没有连上">
          <p>{state.message}</p>
          <Button onClick={() => void refresh()}>再试一次</Button>
        </Empty>
      </div>
    );
  if (state.status === "out") return <Login />;
  const me = state.me;
  if (me.needsConsent) return <Consent />;
  const hasChild = me.children.some((c) => c.id === me.activeChildId);
  if (!hasChild)
    return (
      <Routes>
        <Route path="/children/new" element={<ChildForm />} />
        <Route path="*" element={<ChooseChild />} />
      </Routes>
    );
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="map" element={<SeasonMap />} />
        <Route path="team" element={<SeasonTeam />} />
        <Route path="report" element={<ReportTab />} />
        <Route path="me" element={<MeTab />} />
      </Route>
      <Route path="map/:landId" element={<LandPage />} />
      <Route path="daily" element={<DailyHome />} />
      <Route path="daily/new/:templateId" element={<DailyNew />} />
      <Route path="daily/:id" element={<DailyResult />} />
      <Route path="team/ledger" element={<LedgerPage />} />
      <Route path="team/works" element={<WorksList />} />
      <Route path="team/works/:slot" element={<WorkSlot />} />
      {/* Message links from the server use /season/… (apps/server notify). */}
      <Route path="season" element={<Navigate to="/team" replace />} />
      <Route path="season/team" element={<Navigate to="/team" replace />} />
      <Route path="season/works" element={<WorksList />} />
      <Route path="season/works/:slot" element={<WorkSlot />} />
      <Route path="season/items" element={<ItemsPage />} />
      <Route path="season/contests/:id" element={<ContestPage />} />
      <Route path="season/rounds/:round" element={<RoundPage />} />
      <Route path="season/wars" element={<WarsPage />} />
      <Route path="season/wars/:week" element={<WarWeekPage />} />
      <Route path="season/supply" element={<SupplyPage />} />
      <Route path="season/shop" element={<ShopPage />} />
      <Route path="season/big-battle" element={<BigBattlePage />} />
      <Route path="season/reports/:id" element={<Navigate to="/report?tab=reports" replace />} />
      <Route path="choose" element={<ChooseChild />} />
      <Route path="children/new" element={<ChildForm />} />
      <Route element={<Plain />}>
        <Route path="me/edit" element={<EditChild />} />
        <Route path="me/settings" element={<Settings />} />
        <Route path="me/privacy" element={<PrivacyPage />} />
        <Route path="me/about" element={<AboutPage />} />
      </Route>
      <Route path="*" element={<NotOpen />} />
    </Routes>
  );
}

function NotOpen() {
  return (
    <div className="page">
      <Empty title="这个页面还没有开放">
        <Link to="/">回到首页</Link>
      </Empty>
    </div>
  );
}
