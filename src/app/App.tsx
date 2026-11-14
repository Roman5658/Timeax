import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { StartPage } from "../modules/auth/pages/StartPage";
import { NotFoundPage } from "./NotFoundPage";
import { ThemeProvider } from "./ThemeContext";
import { WorkerProfileProvider } from "../modules/workflows/components/WorkerProfile";
import { ToastProvider } from "./ToastProvider";

const LoginPage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.LoginPage })));
const RegistrationChoicePage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.RegistrationChoicePage })));
const RegistrationPage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.RegistrationPage })));
const FactoryRegistrationPage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.FactoryRegistrationPage })));
const LeaderRegistrationPage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.LeaderRegistrationPage })));
const ForgotPasswordPage = lazy(() => import("../modules/auth/pages/AuthPages").then((module) => ({ default: module.ForgotPasswordPage })));
const SettingsPage = lazy(() => import("../modules/auth/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const WorkerDashboardPage = lazy(() => import("../modules/workers/pages/WorkerDashboardPage").then((module) => ({ default: module.WorkerDashboardPage })));
const AgencyDashboardPage = lazy(() => import("../modules/agencies/pages/AgencyDashboardPage").then((module) => ({ default: module.AgencyDashboardPage })));
const AgencyWorkersPage = lazy(() => import("../modules/agencies/pages/AgencyWorkersPage").then((module) => ({ default: module.AgencyWorkersPage })));
const AgencyTimekeepingPage = lazy(() => import("../modules/agencies/pages/AgencyTimekeepingPage").then((module) => ({ default: module.AgencyTimekeepingPage })));
const MonthlyTimesheetPage = lazy(() => import("../modules/monthly-timesheets/pages/MonthlyTimesheetPage").then((module) => ({ default: module.MonthlyTimesheetPage })));
const AgencyProductionsPage = lazy(() => import("../modules/agencies/pages/AgencyProductionsPage").then((module) => ({ default: module.AgencyProductionsPage })));
const FactoryDashboardPage = lazy(() => import("../modules/factories/pages/FactoryDashboardPage").then((module) => ({ default: module.FactoryDashboardPage })));
const LeaderDashboardPage = lazy(() => import("../modules/reviews/pages/LeaderDashboardPage").then((module) => ({ default: module.LeaderDashboardPage })));
const SuperAdminPage = lazy(() => import("../modules/admin/pages/SuperAdminPage").then((module) => ({ default: module.SuperAdminPage })));
const ExportDesignerPage = lazy(() => import("../modules/exports/pages/ExportDesignerPage").then((module) => ({ default: module.ExportDesignerPage })));
const SupportPage = lazy(() => import("../modules/support/pages/SupportPage").then((module) => ({ default: module.SupportPage })));

function AppRoutes() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `Timeax — ${t("home.eyebrow")}`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = t("home.lead");
  }, [t]);

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegistrationChoicePage />} />
        <Route path="/register/:role" element={<RegistrationPage />} />
        <Route path="/factory/register" element={<FactoryRegistrationPage />} />
        <Route path="/leader/register" element={<LeaderRegistrationPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/worker" element={<WorkerDashboardPage section="overview" />} />
        <Route path="/worker/shifts" element={<WorkerDashboardPage section="shifts" />} />
        <Route path="/worker/work" element={<WorkerDashboardPage section="work" />} />
        <Route path="/worker/schedule" element={<WorkerDashboardPage section="schedule" />} />
        <Route path="/worker/messages" element={<WorkerDashboardPage section="messages" />} />
        <Route path="/agency" element={<AgencyDashboardPage section="overview" />} />
        <Route path="/agency/reviews" element={<AgencyDashboardPage section="operations" />} />
        <Route path="/agency/schedule" element={<AgencyDashboardPage section="schedule" />} />
        <Route path="/agency/messages" element={<AgencyDashboardPage section="messages" />} />
        <Route path="/agency/subscription" element={<AgencyDashboardPage section="subscription" />} />
        <Route path="/agency/workers" element={<AgencyWorkersPage />} />
        <Route path="/agency/timekeeping" element={<AgencyTimekeepingPage />} />
        <Route path="/agency/monthly-timesheets" element={<MonthlyTimesheetPage />} />
        <Route path="/agency/productions" element={<AgencyProductionsPage />} />
        <Route path="/agency/productions/:factoryId" element={<AgencyProductionsPage />} />
        <Route path="/agency/productions/:factoryId/settings" element={<AgencyProductionsPage />} />
        <Route path="/agency/exports" element={<ExportDesignerPage />} />
        <Route path="/factory" element={<FactoryDashboardPage section="overview" />} />
        <Route path="/factory/connections" element={<FactoryDashboardPage section="agencies" />} />
        <Route path="/factory/workers" element={<FactoryDashboardPage section="workers" />} />
        <Route path="/factory/teams" element={<FactoryDashboardPage section="teams" />} />
        <Route path="/factory/timekeeping" element={<FactoryDashboardPage section="timekeeping" />} />
        <Route path="/factory/schedule" element={<FactoryDashboardPage section="schedule" />} />
        <Route path="/factory/messages" element={<FactoryDashboardPage section="messages" />} />
        <Route path="/factory/timesheets" element={<FactoryDashboardPage section="timesheets" />} />
        <Route path="/factory/settings" element={<FactoryDashboardPage section="settings" />} />
        <Route path="/factory/monthly-timesheets" element={<MonthlyTimesheetPage />} />
        <Route path="/leader" element={<LeaderDashboardPage section="overview" />} />
        <Route path="/leader/team" element={<LeaderDashboardPage section="team" />} />
        <Route path="/leader/reviews" element={<LeaderDashboardPage section="reviews" />} />
        <Route path="/leader/schedule" element={<LeaderDashboardPage section="schedule" />} />
        <Route path="/leader/messages" element={<LeaderDashboardPage section="messages" />} />
        <Route path="/leader/monthly-timesheets" element={<MonthlyTimesheetPage />} />
        <Route path="/super-admin" element={<SuperAdminPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export function App() {
  return <ThemeProvider><ToastProvider><WorkerProfileProvider><AppRoutes /></WorkerProfileProvider></ToastProvider></ThemeProvider>;
}
