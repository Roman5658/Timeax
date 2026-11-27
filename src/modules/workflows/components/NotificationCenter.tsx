import { getVisibleMessageThreads } from "../demo-store";
import { Bell, Check, Circle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/ToastProvider";
import type { DemoMember, DemoNotification, DemoWorkspace } from "../domain/demo-types";
import { getAbsenceLeaderRecipients, getActiveMember, getLeaderProductionParticipants, markNotificationRead, useDemoWorkspace } from "../demo-store";

function routeFor(role: DemoMember["role"]): string | undefined {
  if (role === "worker") return "/worker";
  if (role === "agency") return "/agency";
  if (role === "leader") return "/leader";
  if (role === "factory-admin") return "/factory";
  return undefined;
}

function notificationDestination(notice: DemoNotification, workspace: DemoWorkspace, member: DemoMember) {
  const organizationId = workspace.organization.id;
  const route = routeFor(member.role);
  if (!route || notice.organizationId !== organizationId || notice.recipientId !== member.id) return undefined;

  const subjectId = notice.subjectId;
  let focus = "";
  switch (notice.kind) {
    case "agency-connection-requested": {
      const request = workspace.worksiteConnectionRequests?.find((item) => item.id === subjectId && item.state === "pending");
      if (member.role !== "factory-admin" || !request || request.businessEntityId !== member.businessEntityId || (request.direction ?? "agency-request") !== "agency-request") return undefined;
      return `/factory/connections#factory-request-${request.id}`;
    }
    case "agency-connection-invited": {
      const request = workspace.worksiteConnectionRequests?.find((item) => item.id === subjectId && item.state === "pending" && item.direction === "factory-invitation");
      if (member.role !== "agency" || !request || request.organizationId !== organizationId) return undefined;
      return `/agency/productions#agency-invitation-${request.id}`;
    }
    case "agency-connection-accepted":
    case "agency-invitation-declined": {
      const request = workspace.worksiteConnectionRequests?.find((item) => item.id === subjectId && item.direction === "factory-invitation");
      if (member.role !== "factory-admin" || !request || request.businessEntityId !== member.businessEntityId) return undefined;
      return "/factory/connections#factory-connections";
    }
    case "leader-connection-requested": {
      const request = workspace.leaderConnectionRequests?.find((item) => item.id === subjectId && item.state === "pending");
      if (member.role !== "factory-admin" || !request || request.businessEntityId !== member.businessEntityId) return undefined;
      return "/factory/teams#factory-departments";
    }
    case "agency-connection-declined":
    case "agency-connected": {
      const request = workspace.worksiteConnectionRequests?.find((item) => item.id === subjectId && item.organizationId === organizationId);
      if (member.role !== "agency" || !request) return undefined;
      return "/agency/productions";
    }
    case "factory-invitation-registered": {
      const invitation = workspace.factoryInvitations?.find((item) => item.id === subjectId && item.organizationId === organizationId && item.state === "accepted");
      if (member.role !== "agency" || !invitation) return undefined;
      return "/agency/productions";
    }
    case "agency-worker-join-requested": {
      const invitation = workspace.workerInvitations?.find((item) => item.id === subjectId && item.organizationId === organizationId && item.state === "awaiting-approval");
      if (member.role !== "agency" || !invitation) return undefined;
      return "/agency/workers#worker-join-requests";
    }
    case "leader-invitation-accepted": {
      const invitation = workspace.leaderInvitations?.find((item) => item.id === subjectId && item.state === "accepted");
      if (member.role !== "factory-admin" || invitation?.businessEntityId !== member.businessEntityId) return undefined;
      return "/factory/teams#factory-departments";
    }
    case "worksite-worker-assigned": {
      const period = workspace.employmentPeriods.find((item) => item.id === subjectId && (member.role === "factory-admin" || item.organizationId === organizationId));
      if (!period) return undefined;
      const factory = workspace.factories.find((item) => item.organizationId === period.organizationId && item.id === period.placements.find((placement) => placement.factoryId)?.factoryId);
      const site = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
      if (member.role === "agency") return `/agency/workers?worker=${period.workerId}`;
      if (member.role === "worker" && member.id === period.workerId) return "/worker/work#worker-work-summary";
      if (member.role === "leader" && member.factoryId === factory?.id && period.placements.some((placement) => placement.factoryId === member.factoryId && (placement.leaderAccountUid ?? workspace.members.find((item) => item.id === placement.leaderId)?.accountUid) === (member.accountUid ?? member.id))) return "/leader/team#leader-team-panel";
      if (member.role === "factory-admin" && site?.businessEntityId === member.businessEntityId) return "/factory/workers#factory-roster";
      return undefined;
    }
    case "worksite-worker-available": {
      const entry = workspace.employmentPeriods.flatMap((period) => period.organizationId === organizationId || member.role === "factory-admin"
        ? period.placements.filter((placement) => placement.id === subjectId).map((placement) => ({ period, placement }))
        : [])[0];
      const { period, placement } = entry ?? {};
      const factory = period && placement && workspace.factories.find((item) => item.organizationId === period.organizationId && item.id === placement.factoryId);
      const site = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
      if (!period || !factory || !site) return undefined;
      if (member.role === "agency") return `/agency/workers?worker=${period.workerId}`;
      if (member.role === "factory-admin" && site.businessEntityId === member.businessEntityId) return "/factory/workers#factory-roster";
      const accountUid = member.accountUid ?? member.id;
      const leaderMembership = (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === site.businessEntityId && item.worksiteId === site.id && item.accountUid === accountUid && item.state === "active" && item.permissions.canViewWorkers && item.organizationIds?.includes(period.organizationId));
      const agencyMembership = workspace.members.find((item) => item.role === "leader" && item.organizationId === period.organizationId && item.factoryId === factory.id && (item.accountUid ?? item.id) === accountUid && item.accessState !== "suspended" && item.accessState !== "revoked");
      if (member.role === "leader" && leaderMembership && agencyMembership) return "/factory/workers#factory-roster";
      return undefined;
    }
    case "timesheet-ready":
    case "timesheet-submitted":
    case "timesheet-resent":
    case "timesheet-accepted":
    case "timesheet-returned":
    case "timesheet-reopened": {
      const timesheet = workspace.monthlyTimesheets?.find((item) => item.id === subjectId && item.organizationId === organizationId);
      if (!timesheet) return undefined;
      const agencyNotice = notice.kind === "timesheet-ready" || notice.kind === "timesheet-submitted" || notice.kind === "timesheet-resent";
      const allowedAgency = member.role === "agency" && agencyNotice;
      const allowedLeader = member.role === "leader" && member.factoryId === timesheet.factoryId && !agencyNotice;
      if (!allowedAgency && !allowedLeader) return undefined;
      const targetRoute = member.role === "agency" ? "/agency/monthly-timesheets" : "/leader/monthly-timesheets";
      const params = new URLSearchParams({ factory: timesheet.factoryId, month: timesheet.month, timesheet: timesheet.id });
      return `${targetRoute}?${params.toString()}#timesheet-${timesheet.id}`;
    }
    case "message-received": {
      const thread = getVisibleMessageThreads(workspace).find((item) => item.id === subjectId);
      if (!thread) return undefined;
      focus = "message";
      break;
    }
    case "schedule-updated": {
      const schedule = workspace.schedules.find((item) => item.id === subjectId && item.organizationId === organizationId);
      const canOpen = member.role === "worker" ? schedule?.workerIds.includes(member.id) : member.role === "leader" && schedule?.factoryId === member.factoryId;
      if (!schedule || !canOpen) return undefined;
      focus = "schedule";
      break;
    }
    case "employment-updated": {
      const period = workspace.employmentPeriods.find((item) => item.id === subjectId && item.organizationId === organizationId && item.workerId === member.id);
      if (member.role !== "worker" || !period) return undefined;
      focus = "employment";
      break;
    }
    case "team-assignment-needed": {
      const placement = workspace.employmentPeriods.flatMap((period) => period.organizationId === organizationId
        ? period.placements.filter((item) => item.id === subjectId).map((item) => ({ period, placement: item }))
        : [])[0];
      const canOpen = member.role === "leader" && Boolean(member.factoryId && placement?.placement.factoryId === member.factoryId
        && getLeaderProductionParticipants(workspace, member.id, member.factoryId).some((item) => item.worker.id === placement.period.workerId && item.accessState === "active"));
      if (!placement || !canOpen) return undefined;
      const params = new URLSearchParams({ focus: "new-workers", id: placement.period.workerId });
      return `/leader/team?${params.toString()}#leader-team-panel`;
    }
    case "absence-reported": {
      const absence = workspace.absences.find((item) => item.id === subjectId && item.organizationId === organizationId);
      const absenceLeaders = absence ? getAbsenceLeaderRecipients(workspace, absence.workerId, absence.factoryId) : [];
      const canOpen = member.role === "leader" && absence?.factoryId === member.factoryId && absenceLeaders.includes(member.id)
        || member.role === "agency" && absence?.organizationId === member.organizationId;
      if (!absence || !canOpen) return undefined;
      focus = "absence";
      break;
    }
    case "absence-agency-decision": {
      const absence = workspace.absences.find((item) => item.id === subjectId && item.organizationId === organizationId && item.workerId === member.id);
      if (member.role !== "worker" || !absence) return undefined;
      focus = "absence-report";
      break;
    }
    case "absence-agency-update": {
      const absence = workspace.absences.find((item) => item.id === subjectId && item.organizationId === organizationId);
      if (member.role !== "agency" || !absence || !absence.agencyCategory) return undefined;
      focus = "absence";
      break;
    }
    case "absence-clarification-requested": {
      const absence = workspace.absences.find((item) => item.id === subjectId && item.organizationId === organizationId);
      if (member.role !== "worker" || !absence || absence.workerId !== member.id || absence.state !== "clarification-requested") return undefined;
      focus = "absence-clarification";
      break;
    }
    case "change-requested":
    case "change-request-approved":
    case "change-request-rejected": {
      const request = (workspace.changeRequests ?? []).find((item) => item.id === subjectId && item.organizationId === organizationId);
      const shiftExists = request && workspace.shifts.some((record) => record.organizationId === organizationId && record.shift.id === request.shiftId);
      const canOpen = member.role === "worker" ? request?.workerId === member.id
        : member.role === "leader" ? request?.approverType === "leader" && request.approverId === member.id
          : member.role === "agency" && request?.approverType === "agency";
      if (!request || !shiftExists || !canOpen) return undefined;
      focus = "request";
      break;
    }
    default: {
      const shift = workspace.shifts.find((record) => record.organizationId === organizationId && record.shift.id === subjectId);
      const canOpen = member.role === "worker" ? shift?.shift.workerUid === member.id
        : member.role === "leader" ? shift?.shift.factoryId === member.factoryId
          : member.role === "agency";
      if (!shift || !canOpen) return undefined;
      focus = notice.kind === "shift-disputed" ? "dispute" : "shift";
      break;
    }
  }
  const targetRoute = member.role === "worker"
    ? focus === "message" ? "/worker/messages" : focus === "schedule" ? "/worker/schedule" : focus === "employment" ? "/worker/work" : "/worker/shifts"
    : member.role === "agency"
      ? focus === "message" ? "/agency/messages" : "/agency/reviews"
      : member.role === "leader"
        ? focus === "message" ? "/leader/messages" : focus === "schedule" ? "/leader/schedule" : "/leader/reviews"
        : "/factory/timekeeping";
  return `${targetRoute}?${new URLSearchParams({ focus, id: subjectId }).toString()}`;
}

export function NotificationCenter() {
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const navigate = useNavigate();
  const showToast = useToast();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const notifications = workspace.notifications.filter((notice) => notice.organizationId === workspace.organization.id && notice.recipientId === member.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = notifications.filter((notice) => !notice.readAt).length;

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(undefined);
      return;
    }

    function positionPopover() {
      const toggle = toggleRef.current;
      const popover = popoverRef.current;
      if (!toggle || !popover) return;

      const margin = 12;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.max(0, Math.min(365, viewportWidth - margin * 2));
      const toggleBounds = toggle.getBoundingClientRect();
      const left = Math.max(margin, Math.min(toggleBounds.right - width, viewportWidth - width - margin));
      const belowTop = toggleBounds.bottom + 10;
      const belowSpace = Math.max(0, viewportHeight - margin - belowTop);
      const aboveSpace = Math.max(0, toggleBounds.top - 10 - margin);
      const placeBelow = belowSpace >= aboveSpace;
      const maxHeight = Math.max(0, Math.min(440, viewportHeight - margin * 2, placeBelow ? belowSpace : aboveSpace));
      const popoverHeight = Math.min(popover.scrollHeight, maxHeight);
      const top = placeBelow ? belowTop : Math.max(margin, toggleBounds.top - popoverHeight - 10);

      setPopoverPosition((current) => current?.left === left && current.top === top && current.width === width && current.maxHeight === maxHeight
        ? current
        : { left, top, width, maxHeight });
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open, notifications.length, unread, i18n.language]);

  function openNotification(notice: DemoNotification) {
    const destination = notificationDestination(notice, workspace, member);
    if (!destination) {
      showToast(t("workflow.notifications.targetUnavailable"), "error");
      return;
    }
    if (!notice.readAt) markNotificationRead(notice.id);
    setOpen(false);
    navigate(destination);
  }
  return (
    <div className="notification-center">
      <button ref={toggleRef} className="icon-button notification-toggle" type="button" aria-label={t("workflow.notifications.title")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Bell size={16} />{unread > 0 && <span className="notification-count">{unread}</span>}
      </button>
      {open && <section ref={popoverRef} className={`notification-popover${popoverPosition ? " is-positioned" : ""}`} aria-label={t("workflow.notifications.title")} style={{
        left: popoverPosition?.left,
        top: popoverPosition?.top,
        width: popoverPosition?.width,
        maxHeight: popoverPosition?.maxHeight,
        visibility: popoverPosition ? undefined : "hidden",
      }}>
        <div className="notification-popover-head"><strong>{t("workflow.notifications.title")}</strong><span>{unread} {t("workflow.notifications.unread")}</span></div>
        {notifications.length === 0 ? <p className="muted-copy">{t("workflow.notifications.empty")}</p> : <ul className="notification-list">
          {notifications.slice(0, 8).map((notice) => {
            const changeRequest = (workspace.changeRequests ?? []).find((item) => item.id === notice.subjectId);
            const subject = workspace.shifts.find((item) => item.shift.id === notice.subjectId || item.shift.id === changeRequest?.shiftId)?.shift;
            const absence = workspace.absences.find((item) => item.id === notice.subjectId);
            const thread = workspace.messageThreads.find((item) => item.id === notice.subjectId);
            const schedule = workspace.schedules.find((item) => item.id === notice.subjectId);
            const employment = workspace.employmentPeriods.find((item) => item.id === notice.subjectId);
            const teamPlacement = notice.kind === "team-assignment-needed" ? workspace.employmentPeriods.flatMap((item) => item.placements.map((placement) => ({ period: item, placement }))).find((item) => item.placement.id === notice.subjectId) : undefined;
            const timesheet = workspace.monthlyTimesheets?.find((item) => item.id === notice.subjectId);
            const signer = timesheet?.versions.find((version) => version.number === timesheet.currentVersion)?.signature;
            const person = workspace.members.find((item) => item.id === (subject?.workerUid ?? absence?.workerId ?? thread?.workerId ?? schedule?.workerIds[0] ?? employment?.workerId ?? teamPlacement?.period.workerId ?? signer?.signerId));
            const notificationKind = notice.kind === "shift-updated" && subject?.deletedAt ? "shift-cancelled" : notice.kind;
            return <li key={notice.id} className={notice.readAt ? "notification-item is-read" : "notification-item is-unread"}>
              <Circle size={8} aria-hidden="true" />
              <button type="button" className="notification-open" onClick={() => openNotification(notice)}><strong>{t(`workflow.notifications.${notificationKind}`)}</strong><span>{person?.name ?? "Timeax"}</span><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(notice.createdAt))}</time></button>
              {!notice.readAt && <button type="button" className="notification-mark" aria-label={t("workflow.notifications.markRead")} onClick={() => markNotificationRead(notice.id)}><Check size={15} /></button>}
            </li>;
          })}
        </ul>}
      </section>}
    </div>
  );
}
