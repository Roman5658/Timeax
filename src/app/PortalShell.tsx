import { ArrowUpRight, Building2, CalendarDays, ClipboardList, LayoutDashboard, Menu, MessageCircle, Settings2, UsersRound, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandMark } from "../components/BrandMark";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { PrototypeNotice } from "../components/PrototypeNotice";
import { ThemeToggle } from "../components/ThemeToggle";
import { DemoRoleSwitcher } from "../modules/workflows/components/DemoRoleSwitcher";
import { SignOutButton } from "../modules/auth/pages/SupabasePages";
import { portalHome as roleRoute, type PortalRole } from "../modules/auth/portal-access";
import { demoMode } from "../modules/auth/supabase-auth";
import { NotificationCenter } from "../modules/workflows/components/NotificationCenter";
import { useTargetHighlight } from "../shared/useTargetHighlight";

export type { PortalRole } from "../modules/auth/portal-access";

interface PortalShellProps {
  role: PortalRole;
  children: ReactNode;
  navigationMode?: "factory-leader";
}

function HashTargetFocus() {
  const { hash } = useLocation();
  let targetId = "";
  try { targetId = decodeURIComponent(hash.slice(1)); } catch { targetId = hash.slice(1); }
  useTargetHighlight(targetId, Boolean(targetId));
  return null;
}

export function PortalShell({ role, children, navigationMode }: PortalShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const roleHomeLabel = role === "factory-admin" || navigationMode === "factory-leader" ? t("nav.factoryHome") : t(`nav.${role}Home`);
  type NavGroup = "workspace" | "people" | "operations" | "reports" | "account";
  const navItems: Array<{ path: string; label: string; icon: ReactNode; group?: NavGroup }> = role === "agency"
    ? [
      { path: "/agency", label: t("nav.agencyHome"), icon: <LayoutDashboard size={17} aria-hidden="true" />, group: "workspace" },
      { path: "/agency/productions", label: t("nav.productions"), icon: <Building2 size={17} aria-hidden="true" />, group: "people" },
      { path: "/agency/workers", label: t("nav.workers"), icon: <UsersRound size={17} aria-hidden="true" />, group: "people" },
      { path: "/agency/timekeeping", label: t("nav.timekeeping"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
      { path: "/agency/reviews", label: t("workflow.agency.operationalEvents"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "operations" },
      { path: "/agency/schedule", label: t("nav.schedule"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
      { path: "/agency/messages", label: t("nav.messages"), icon: <MessageCircle size={17} aria-hidden="true" />, group: "operations" },
      { path: "/agency/monthly-timesheets", label: t("nav.monthlyTimesheets"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
      { path: "/agency/payroll", label: t("payroll.agencyTitle"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
      { path: "/agency/exports", label: t("nav.exports"), icon: <ArrowUpRight size={17} aria-hidden="true" />, group: "reports" },
      { path: "/agency/subscription", label: t("agencySubscription.title"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
      { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
    ]
    : role === "worker"
      ? [
        { path: "/worker", label: t("nav.workerHome"), icon: <LayoutDashboard size={17} aria-hidden="true" />, group: "workspace" },
        { path: "/worker/shifts", label: t("nav.shifts"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
        { path: "/worker/work", label: t("nav.myWork"), icon: <UsersRound size={17} aria-hidden="true" />, group: "operations" },
        { path: "/worker/schedule", label: t("nav.schedule"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
        { path: "/worker/messages", label: t("nav.messages"), icon: <MessageCircle size={17} aria-hidden="true" />, group: "operations" },
        { path: "/worker/payroll", label: t("payroll.workerTitle"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
        { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
      ]
      : role === "factory-admin" ? [
        { path: "/factory", label: t("nav.factoryHome"), icon: <LayoutDashboard size={17} aria-hidden="true" />, group: "workspace" },
        { path: "/factory/connections", label: t("workflow.factory.sections.agencies"), icon: <Building2 size={17} aria-hidden="true" />, group: "people" },
        { path: "/factory/workers", label: t("nav.workers"), icon: <UsersRound size={17} aria-hidden="true" />, group: "people" },
        { path: "/factory/teams", label: t("workflow.factory.sections.teams"), icon: <UsersRound size={17} aria-hidden="true" />, group: "people" },
        { path: "/factory/timekeeping", label: t("nav.timekeeping"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
        { path: "/factory/schedule", label: t("nav.schedule"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
        { path: "/factory/messages", label: t("nav.messages"), icon: <MessageCircle size={17} aria-hidden="true" />, group: "operations" },
        { path: "/factory/timesheets", label: t("workflow.factory.sections.timesheets"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
        { path: "/factory/monthly-timesheets", label: t("nav.monthlyTimesheets"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
        { path: "/factory/settings", label: t("workflow.factory.sections.settings"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
        { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
      ]
      : role === "leader" && navigationMode === "factory-leader" ? [
        { path: "/factory", label: t("nav.factoryHome"), icon: <LayoutDashboard size={17} aria-hidden="true" />, group: "workspace" },
        { path: "/factory/workers", label: t("workflow.factory.roster"), icon: <UsersRound size={17} aria-hidden="true" />, group: "people" },
        { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
      ] : role === "leader" ? [
        { path: roleRoute[role], label: t(`nav.${role}Home`), icon: <LayoutDashboard size={17} aria-hidden="true" />, group: "workspace" },
        { path: "/leader/team", label: t("nav.teams"), icon: <UsersRound size={17} aria-hidden="true" />, group: "people" },
        { path: "/leader/reviews", label: t("nav.reviews"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "operations" },
        { path: "/leader/schedule", label: t("nav.schedule"), icon: <CalendarDays size={17} aria-hidden="true" />, group: "operations" },
        { path: "/leader/messages", label: t("nav.messages"), icon: <MessageCircle size={17} aria-hidden="true" />, group: "operations" },
        { path: "/leader/monthly-timesheets", label: t("nav.monthlyTimesheets"), icon: <ClipboardList size={17} aria-hidden="true" />, group: "reports" },
        { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" />, group: "account" },
      ] : [
        { path: roleRoute[role], label: t(`nav.${role}Home`), icon: <LayoutDashboard size={17} aria-hidden="true" /> },
        { path: `${roleRoute[role]}#schedule-center`, label: t("nav.schedule"), icon: <CalendarDays size={17} aria-hidden="true" /> },
        { path: `${roleRoute[role]}#messages-center`, label: t("nav.messages"), icon: <MessageCircle size={17} aria-hidden="true" /> },
        { path: "/settings", label: t("nav.profile"), icon: <Settings2 size={17} aria-hidden="true" /> },
      ];
  const isItemActive = (path: string) => {
    const hashAt = path.indexOf("#");
    if (hashAt >= 0) return location.pathname === path.slice(0, hashAt) && location.hash === path.slice(hashAt);
    const factoryLeaderHome = role === "leader" && navigationMode === "factory-leader" && path === "/factory";
    if (path === "/settings" || path === roleRoute[role] || factoryLeaderHome) return location.pathname === path && !location.hash;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className={`portal-layout portal-layout--${role}`}>
      <HashTargetFocus />
      {mobileOpen && <button className="portal-sidebar-backdrop" type="button" aria-label={t("common.closeMenu")} onClick={() => setMobileOpen(false)} />}
      <aside className={`portal-sidebar${mobileOpen ? " is-open" : ""}`}>
        <BrandMark />
        <button className="portal-mobile-close" type="button" aria-label={t("common.closeMenu")} onClick={() => setMobileOpen(false)}><X size={18} /></button>
        <div className="sidebar-divider" />
        <div className="sidebar-section-label">{t("common.preview")}</div>
        <nav className="portal-nav">
          {navItems.map((item, index) => (
            <Fragment key={item.path}>
              {item.group && item.group !== navItems[index - 1]?.group && <div className="portal-nav-group-label">{t(`nav.groups.${item.group}`)}</div>}
              <Link to={item.path} aria-current={isItemActive(item.path) ? "page" : undefined} onClick={() => setMobileOpen(false)} className={`portal-nav-link${isItemActive(item.path) ? " is-active" : ""}`}>
                {item.icon}<span>{item.label}</span>
              </Link>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <Link className="sidebar-support" to="/support"><span>{t("common.support")}</span><ArrowUpRight size={15} /></Link>
        <div className="sidebar-user">
          <span className="sidebar-avatar"><Settings2 size={16} /></span>
          <span><strong>{t("common.preview")}</strong><small>{t("dashboard.scopeNote")}</small></span>
        </div>
      </aside>
      <div className="portal-main-column">
        <header className="portal-topline">
          <div className="portal-topline-left"><button className="portal-mobile-menu" type="button" aria-label={t("common.openMenu")} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={19} /></button><div className="portal-breadcrumb"><span className="breadcrumb-dot" />{roleHomeLabel}</div></div>
          <div className="portal-top-actions">{demoMode ? <DemoRoleSwitcher /> : <SignOutButton />}<NotificationCenter /><LanguageSwitcher compact /><ThemeToggle /></div>
        </header>
        <main className="portal-content">
          <PrototypeNotice subtle />
          {children}
        </main>
      </div>
    </div>
  );
}
