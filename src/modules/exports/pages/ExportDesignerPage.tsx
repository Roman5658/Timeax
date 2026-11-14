import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FileSpreadsheet, Info, Save, Star, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ExcelExportTemplate, ExportColumnConfig, ExportColumnKey, ExportScopeKind } from "../domain/types";
import { workerHasProductionOnDate } from "../domain/employment-scope";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDate } from "../../../shared/formatters";
import { getActiveMember, getWorkerProductionAssignments, isAgencyVisibleAbsence, useDemoWorkspace } from "../../workflows/demo-store";
import { formatDuration } from "../../workflows/workflow-utils";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { useToast } from "../../../app/ToastProvider";

const STORAGE_KEY = "timeax-demo-export-templates-v1";
const initialColumns: ExportColumnConfig[] = [
  { key: "worker", enabled: true, order: 0 }, { key: "agency", enabled: true, order: 1 }, { key: "folder", enabled: false, order: 2 },
  { key: "factory", enabled: true, order: 3 }, { key: "shiftDate", enabled: true, order: 4 }, { key: "weekday", enabled: true, order: 5 },
  { key: "startTime", enabled: true, order: 6 }, { key: "endTime", enabled: true, order: 7 }, { key: "grossDuration", enabled: true, order: 8 },
  { key: "breaks", enabled: true, order: 9 }, { key: "paidTime", enabled: true, order: 10 }, { key: "shiftNote", enabled: true, order: 11 },
  { key: "confirmation", enabled: true, order: 12 }, { key: "absence", enabled: true, order: 13 }, { key: "comment", enabled: true, order: 14 },
];
const columnLabelKeys: Record<ExportColumnKey, string> = {
  worker: "exports.colWorker", agency: "exports.colAgency", folder: "exports.colFolder", factory: "exports.colFactory", shiftDate: "exports.colDate", weekday: "exports.colWeekday",
  startTime: "exports.colStart", endTime: "exports.colEnd", grossDuration: "exports.colGross", breaks: "exports.colBreak", paidTime: "exports.colPaid", shiftNote: "exports.colShiftNote", comment: "exports.colComment", confirmation: "exports.colStatus", absence: "exports.colAbsence",
};
type PeriodKind = "month" | "date" | "date-range";
type PreviewRow = { key: string; sortDate: string; workerId?: string; values: Record<ExportColumnKey, string> };

function readTemplates(organizationId: string): ExcelExportTemplate[] {
  try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as ExcelExportTemplate[]; return Array.isArray(value) ? value.filter((item) => item.organizationId === organizationId && !item.archivedAt) : []; }
  catch { return []; }
}
function writeTemplates(templates: ExcelExportTemplate[], organizationId: string): boolean {
  try { const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as ExcelExportTemplate[]; const otherOrganizations = Array.isArray(all) ? all.filter((item) => item.organizationId !== organizationId) : []; window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...otherOrganizations, ...templates])); return true; }
  catch { return false; }
}
function localIsoDate(date: Date): string { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }
function withinPeriod(value: string, kind: PeriodKind, month: string, date: string, fromDate: string, toDate: string): boolean {
  if (kind === "month") return value.startsWith(month);
  if (kind === "date") return value === date;
  return (!fromDate || value >= fromDate) && (!toDate || value <= toDate);
}
function periodDates(kind: PeriodKind, month: string, date: string, fromDate: string, toDate: string): string[] {
  let start: Date; let end: Date;
  if (kind === "date") return date ? [date] : [];
  if (kind === "month") {
    if (!month) return [];
    const [year, selectedMonth] = month.split("-").map(Number);
    start = new Date(year, selectedMonth - 1, 1); end = new Date(year, selectedMonth, 0);
  } else {
    if (!fromDate || !toDate || toDate < fromDate) return [];
    start = new Date(`${fromDate}T12:00:00`); end = new Date(`${toDate}T12:00:00`);
  }
  const dates: string[] = [];
  while (start <= end && dates.length < 3660) { dates.push(localIsoDate(start)); start.setDate(start.getDate() + 1); }
  return dates;
}
function mergeColumns(saved?: ExportColumnConfig[]): ExportColumnConfig[] {
  return initialColumns.map((column) => {
    const existing = saved?.find((item) => item.key === column.key);
    return existing ? { ...column, ...existing } : { ...column };
  }).sort((a, b) => a.order - b.order).map((column, order) => ({ ...column, order }));
}
function ToggleRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><i /></span></label>;
}

export function ExportDesignerPage() {
  const { t, i18n } = useTranslation();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const workers = workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "worker");
  const factories = workspace.factories.filter((item) => item.organizationId === workspace.organization.id);
  const folders = (workspace.folders ?? []).filter((item) => item.organizationId === workspace.organization.id && !item.archivedAt);
  const linkedFactories = (searchParams.get("factories") ?? "").split(",").filter((id) => factories.some((item) => item.id === id));
  const linkedWorkers = (searchParams.get("workers") ?? "").split(",").filter((id) => workers.some((item) => item.id === id));
  const [templates, setTemplates] = useState(() => readTemplates(workspace.organization.id));
  const defaultTemplate = templates.find((item) => item.isDefault);
  const [columns, setColumns] = useState<ExportColumnConfig[]>(() => mergeColumns(defaultTemplate?.columns));
  const defaultFactoryIds = defaultTemplate?.factoryIds?.length ? defaultTemplate.factoryIds : defaultTemplate?.factoryId ? [defaultTemplate.factoryId] : [];
  const defaultHasFactoryScope = defaultFactoryIds.length > 0 || defaultTemplate?.scope === "factory" || defaultTemplate?.scope === "selected-factories";
  const [productionMode, setProductionMode] = useState<"all" | "selected">(() => linkedFactories.length || defaultHasFactoryScope ? "selected" : "all");
  const [selectedFactories, setSelectedFactories] = useState<string[]>(() => linkedFactories.length ? linkedFactories : defaultFactoryIds.filter((id) => factories.some((item) => item.id === id)));
  const [workerMode, setWorkerMode] = useState<"all" | "selected">(() => linkedWorkers.length || defaultTemplate?.scope === "selected-workers" ? "selected" : "all");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(() => linkedWorkers.length ? linkedWorkers : defaultTemplate?.workerUids?.filter((id) => workers.some((item) => item.id === id)) ?? []);
  const [workerSearch, setWorkerSearch] = useState("");
  const requestedPeriod = searchParams.get("periodKind");
  const [periodKind, setPeriodKind] = useState<PeriodKind>(() => requestedPeriod === "date" || requestedPeriod === "date-range" ? requestedPeriod : defaultTemplate?.period?.kind === "date" || defaultTemplate?.period?.kind === "date-range" ? defaultTemplate.period.kind : "month");
  const [month, setMonth] = useState(() => searchParams.get("month") ?? defaultTemplate?.period?.month ?? localIsoDate(new Date()).slice(0, 7));
  const [date, setDate] = useState(() => searchParams.get("date") ?? defaultTemplate?.period?.date ?? localIsoDate(new Date()));
  const [fromDate, setFromDate] = useState(() => searchParams.get("fromDate") ?? defaultTemplate?.period?.fromDate ?? localIsoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [toDate, setToDate] = useState(() => searchParams.get("toDate") ?? defaultTemplate?.period?.toDate ?? localIsoDate(new Date()));
  const [dateFormat, setDateFormat] = useState<ExcelExportTemplate["dateFormat"]>(defaultTemplate?.dateFormat ?? "dd.MM.yyyy");
  const [timeFormat, setTimeFormat] = useState<ExcelExportTemplate["timeFormat"]>(defaultTemplate?.timeFormat ?? "24-hour");
  const [templateName, setTemplateName] = useState(defaultTemplate?.name ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplate?.id ?? "");
  const [message, setInlineMessage] = useState("");
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (!value) return;
    const errors = ["exports.noProductionsSelected", "exports.noWorkersSelected", "exports.invalidPeriod", "exports.previewEmpty", "exports.exportError", "exports.templateSaveError", "exports.templateNameRequired"].map((key) => t(key));
    showToast(value, errors.includes(value) ? "error" : "success");
  };
  const [isExporting, setIsExporting] = useState(false);

  function workerHasFactoryHistory(workerId: string, factoryIds: string[]) {
    return getWorkerProductionAssignments(workspace, workerId).some((assignment) => factoryIds.includes(assignment.factoryId))
      || workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === workerId && period.placements.some((placement) => factoryIds.includes(placement.factoryId)));
  }
  function workerFactoryIdsOn(workerId: string, localDate: string) {
    const periods = workspace.employmentPeriods.filter((period) => period.organizationId === workspace.organization.id && period.workerId === workerId);
    if (periods.length) {
      return [...new Set(periods.flatMap((period) => period.placements
        .filter((placement) => workerHasProductionOnDate([period], { organizationId: workspace.organization.id, workerId, factoryId: placement.factoryId, date: localDate, employmentId: period.id }))
        .map((placement) => placement.factoryId)))];
    }
    return getWorkerProductionAssignments(workspace, workerId).map((assignment) => assignment.factoryId);
  }

  const availableWorkers = workers.filter((worker) => productionMode === "all" || workerHasFactoryHistory(worker.id, selectedFactories));
  const visibleWorkers = availableWorkers.filter((worker) => worker.name.toLowerCase().includes(workerSearch.trim().toLowerCase()));
  const activeWorkerIds = workerMode === "all" ? availableWorkers.map((worker) => worker.id) : selectedWorkers.filter((id) => availableWorkers.some((worker) => worker.id === id));
  const selectedFactoryIds = productionMode === "all" ? factories.map((factory) => factory.id) : selectedFactories;
  const inScope = (workerId: string, factoryId: string) => activeWorkerIds.includes(workerId) && selectedFactoryIds.includes(factoryId);
  const orderedEnabledColumns = useMemo(() => columns.filter((column) => column.enabled).sort((a, b) => a.order - b.order), [columns]);
  const isValidEmploymentDate = (workerId: string, factoryId: string, localDate: string, employmentId?: string) => {
    if (!workers.some((item) => item.id === workerId)) return false;
    const periods = workspace.employmentPeriods.filter((period) => period.organizationId === workspace.organization.id && period.workerId === workerId);
    const legacyFactories = getWorkerProductionAssignments(workspace, workerId).map((assignment) => assignment.factoryId);
    return workerHasProductionOnDate(periods, { organizationId: workspace.organization.id, workerId, factoryId, date: localDate, employmentId }, legacyFactories);
  };
  const matchingShifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.agencyId === workspace.organization.id
    && !record.shift.deletedAt && inScope(record.shift.workerUid, record.shift.factoryId ?? "")
    && withinPeriod(record.shift.localStartDate, periodKind, month, date, fromDate, toDate)
    && isValidEmploymentDate(record.shift.workerUid, record.shift.factoryId ?? "", record.shift.localStartDate, record.shift.employmentId));
  const matchingAbsences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && isAgencyVisibleAbsence(workspace, absence)
    && inScope(absence.workerId, absence.factoryId) && withinPeriod(absence.localDate, periodKind, month, date, fromDate, toDate)
    && isValidEmploymentDate(absence.workerId, absence.factoryId, absence.localDate, absence.employmentId));
  const selectedWorkerList = workers.filter((worker) => activeWorkerIds.includes(worker.id));

  function updateColumn(key: ExportColumnKey, patch: Partial<ExportColumnConfig>) { setColumns((current) => current.map((column) => column.key === key ? { ...column, ...patch } : column)); }
  function moveColumn(key: ExportColumnKey, direction: -1 | 1) {
    setColumns((current) => { const ordered = [...current].sort((a, b) => a.order - b.order); const index = ordered.findIndex((column) => column.key === key); const target = index + direction; if (index < 0 || target < 0 || target >= ordered.length) return current; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; return ordered.map((column, order) => ({ ...column, order })); });
  }
  function toggleFactory(id: string) {
    const next = selectedFactories.includes(id) ? selectedFactories.filter((value) => value !== id) : [...selectedFactories, id];
    setSelectedFactories(next);
    setSelectedWorkers((current) => current.filter((workerId) => workers.some((worker) => worker.id === workerId && workerHasFactoryHistory(workerId, next))));
  }
  function toggleWorker(id: string) { setSelectedWorkers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function setVisibleWorkersSelected(selected: boolean) {
    const visibleIds = visibleWorkers.map((worker) => worker.id);
    setSelectedWorkers((current) => selected ? [...new Set([...current, ...visibleIds])] : current.filter((id) => !visibleIds.includes(id)));
  }
  function formatCellDate(value: string): string {
    const dateValue = new Date(`${value}T12:00:00`);
    return dateFormat === "yyyy-MM-dd" ? value : dateFormat === "localized-long" ? formatDate(dateValue, { dateStyle: "long" }) : formatDate(dateValue, { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function blankValues(workerId: string, factoryId: string, localDate: string): Record<ExportColumnKey, string> {
    const worker = workers.find((item) => item.id === workerId);
    const factory = factories.find((item) => item.id === factoryId);
    const folder = folders.find((item) => item.id === worker?.folderId);
    return { worker: worker?.name ?? "—", agency: workspace.organization.name, folder: folder?.name ?? "—", factory: factory?.name ?? "—", shiftDate: formatCellDate(localDate), weekday: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(`${localDate}T12:00:00`)), startTime: "—", endTime: "—", grossDuration: "—", breaks: "—", paidTime: "—", shiftNote: "—", comment: "—", confirmation: "—", absence: "—" };
  }
  const shiftRows: PreviewRow[] = matchingShifts.map(({ shift }) => {
    const values = blankValues(shift.workerUid, shift.factoryId ?? "", shift.localStartDate);
    values.startTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12-hour" }).format(new Date(shift.startAt));
    values.endTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12-hour" }).format(new Date(shift.endAt));
    values.grossDuration = formatDuration(shift.grossDurationMinutes, t);
    values.breaks = shift.actualBreak.status === "taken" ? formatDuration(shift.totalBreakDurationMinutes, t) : t("workflow.breakReport.none");
    values.paidTime = formatDuration(shift.paidDurationMinutes, t);
    values.comment = shift.comment || "—";
    values.confirmation = t(`workflow.shiftStatus.${shift.workerConfirmation}`);
    return { key: shift.id, sortDate: shift.localStartDate, workerId: shift.workerUid, values };
  });
  const extraRows: PreviewRow[] = matchingAbsences.map((absence) => {
    const values = blankValues(absence.workerId, absence.factoryId, absence.localDate);
    values.comment = absence.agencyNote ?? "—";
    values.confirmation = t(`workflow.absence.state.${absence.state}`);
    values.absence = t(`workflow.absence.agencyCategory.${absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention")}`);
    return { key: absence.id, sortDate: absence.localDate, workerId: absence.workerId, values };
  });
  if (columns.some((column) => column.key === "absence" && column.enabled)) {
    for (const localDay of periodDates(periodKind, month, date, fromDate, toDate)) {
      const weekday = new Date(`${localDay}T12:00:00`).getDay();
      for (const worker of selectedWorkerList) for (const factoryId of workerFactoryIdsOn(worker.id, localDay).filter((id) => selectedFactoryIds.includes(id))) {
        const factory = factories.find((item) => item.id === factoryId);
        const works = factory?.workCalendar?.exceptions.find((item) => item.localDate === localDay)?.isWorkingDay ?? (factory?.workCalendar?.workingWeekdays ?? [1, 2, 3, 4, 5]).includes(weekday);
        if (works || matchingShifts.some((record) => record.shift.workerUid === worker.id && record.shift.factoryId === factoryId && record.shift.localStartDate === localDay) || matchingAbsences.some((item) => item.workerId === worker.id && item.factoryId === factoryId && item.localDate === localDay)) continue;
        const values = blankValues(worker.id, factoryId, localDay); values.absence = t("exports.weekendRow");
        extraRows.push({ key: `weekend-${worker.id}-${localDay}-${factoryId}`, sortDate: localDay, workerId: worker.id, values });
      }
    }
  }
  const previewRows = [...shiftRows, ...extraRows].sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.values.worker.localeCompare(b.values.worker));
  const visiblePreviewRows = previewRows.slice(0, 40);
  const totalPaidMinutes = matchingShifts.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
  const confirmedMinutes = matchingShifts.filter((record) => record.shift.workerConfirmation === "confirmed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
  const pendingMinutes = matchingShifts.filter((record) => record.shift.workerConfirmation === "pending").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
  const absenceReasons = new Map<string, number>();
  matchingAbsences.forEach((absence) => { const key = t(`workflow.absence.agencyCategory.${absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention")}`); absenceReasons.set(key, (absenceReasons.get(key) ?? 0) + 1); });

  function currentTemplatePayload(name: string, templateId: string): ExcelExportTemplate {
    const now = new Date().toISOString(); const previous = templates.find((item) => item.id === templateId);
    const templateScope: ExportScopeKind = workerMode === "selected" ? "selected-workers" : productionMode === "selected" ? "selected-factories" : "all-workers";
    return { id: templateId || `excel-template-${crypto.randomUUID()}`, organizationId: workspace.organization.id, ownerType: "agency", agencyId: workspace.organization.id, name: name.trim(), schemaVersion: 4, columns: columns.map((column) => ({ ...column })), scope: templateScope, workerUids: workerMode === "selected" ? [...selectedWorkers] : [], folderIds: [], groupIds: [], factoryIds: productionMode === "selected" ? [...selectedFactories] : [], period: { kind: periodKind, month, date, fromDate, toDate }, dateFormat, timeFormat, showComments: Boolean(columns.find((column) => column.key === "comment")?.enabled), breakDisplay: columns.find((column) => column.key === "breaks")?.enabled ? "intervals-and-duration" : "hidden", showPaidTime: Boolean(columns.find((column) => column.key === "paidTime")?.enabled), showGrossDuration: Boolean(columns.find((column) => column.key === "grossDuration")?.enabled), showWeekendsAndAbsences: Boolean(columns.find((column) => column.key === "absence")?.enabled), isDefault: previous?.isDefault ?? false, createdByUid: previous?.createdByUid ?? member.id, createdAt: previous?.createdAt ?? now, updatedByUid: member.id, updatedAt: now };
  }
  function saveTemplate() {
    if (!templateName.trim()) { setMessage(t("exports.templateNameRequired")); return; }
    const template = currentTemplatePayload(templateName, selectedTemplateId);
    const next = templates.some((item) => item.id === template.id) ? templates.map((item) => item.id === template.id ? template : item) : [...templates, template];
    if (!writeTemplates(next, workspace.organization.id)) { setMessage(t("exports.templateSaveError")); return; }
    setTemplates(next); setSelectedTemplateId(template.id); setMessage(t("exports.templatesSaved"));
  }
  function loadTemplate(id: string) {
    setSelectedTemplateId(id); const template = templates.find((item) => item.id === id);
    if (!template) { setTemplateName(""); return; }
    setTemplateName(template.name); setColumns(mergeColumns(template.columns)); setDateFormat(template.dateFormat); setTimeFormat(template.timeFormat);
    const factoryIds = template.factoryIds?.length ? template.factoryIds : template.factoryId ? [template.factoryId] : [];
    setProductionMode(factoryIds.length || template.scope === "factory" || template.scope === "selected-factories" ? "selected" : "all"); setSelectedFactories(factoryIds);
    setWorkerMode(template.scope === "selected-workers" || Boolean(template.workerUids?.length) ? "selected" : "all"); setSelectedWorkers(template.workerUids ?? []);
    if (template.period) { if (template.period.kind === "date" || template.period.kind === "date-range") setPeriodKind(template.period.kind); else setPeriodKind("month"); if (template.period.month) setMonth(template.period.month); if (template.period.date) setDate(template.period.date); if (template.period.fromDate) setFromDate(template.period.fromDate); if (template.period.toDate) setToDate(template.period.toDate); }
    setMessage(t("exports.templateLoaded"));
  }
  function duplicateTemplate() {
    const selected = templates.find((item) => item.id === selectedTemplateId); if (!selected) return;
    const now = new Date().toISOString(); const copy = { ...selected, id: `excel-template-${crypto.randomUUID()}`, name: `${selected.name} (${t("exports.duplicateTemplate")})`, isDefault: false, createdAt: now, updatedAt: now, createdByUid: member.id, updatedByUid: member.id };
    const next = [...templates, copy]; if (!writeTemplates(next, workspace.organization.id)) { setMessage(t("exports.templateSaveError")); return; } setTemplates(next); setSelectedTemplateId(copy.id); setTemplateName(copy.name); setMessage(t("exports.templateDuplicated"));
  }
  function markDefault() {
    if (!selectedTemplateId) return; const next = templates.map((item) => ({ ...item, isDefault: item.id === selectedTemplateId })); if (!writeTemplates(next, workspace.organization.id)) { setMessage(t("exports.templateSaveError")); return; } setTemplates(next); setMessage(t("exports.templateDefaultSet"));
  }
  function deleteTemplate() {
    if (!selectedTemplateId) return; const next = templates.filter((item) => item.id !== selectedTemplateId); if (!writeTemplates(next, workspace.organization.id)) { setMessage(t("exports.templateSaveError")); return; } setTemplates(next); setSelectedTemplateId(""); setTemplateName(""); setMessage(t("exports.templateDeleted"));
  }

  async function downloadWorkbook() {
    setMessage("");
    if (productionMode === "selected" && !selectedFactoryIds.length) { setMessage(t("exports.noProductionsSelected")); return; }
    if (workerMode === "selected" && !activeWorkerIds.length) { setMessage(t("exports.noWorkersSelected")); return; }
    if (periodKind === "month" && !month || periodKind === "date" && !date || periodKind === "date-range" && (!fromDate || !toDate || fromDate > toDate)) { setMessage(t("exports.invalidPeriod")); return; }
    if (!orderedEnabledColumns.length) { setMessage(t("exports.previewEmpty")); return; }
    const dates = periodDates(periodKind, month, date, fromDate, toDate);
    if (!dates.length || periodKind === "date-range" && dates[dates.length - 1] !== toDate) { setMessage(t("exports.invalidPeriod")); return; }
    setIsExporting(true);
    try {
      const { createExportWorkbook } = await import("../domain/workbook");
      const headers = Object.fromEntries(Object.entries(columnLabelKeys).map(([key, translationKey]) => [key, t(translationKey)])) as Record<ExportColumnKey, string>;
      const buffer = await createExportWorkbook({
        organizationName: workspace.organization.name,
        workers: selectedWorkerList,
        factories: factories.filter((factory) => selectedFactoryIds.includes(factory.id)),
        folders,
        employmentPeriods: workspace.employmentPeriods.filter((period) => period.organizationId === workspace.organization.id && activeWorkerIds.includes(period.workerId)),
        shifts: matchingShifts,
        absences: matchingAbsences,
        factoryIds: selectedFactoryIds,
        dates,
        columns: orderedEnabledColumns,
        dateFormat,
        timeFormat,
        language: i18n.resolvedLanguage ?? i18n.language,
        columnHeaders: headers,
        translate: t,
      });
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const periodPart = periodKind === "month" ? month : periodKind === "date" ? date : `${fromDate}_${toDate}`;
      const organizationPart = workspace.organization.name.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
      anchor.href = url;
      anchor.download = `timeax_${organizationPart || "agency"}_${periodPart || "period"}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(t("exports.downloadComplete"));
    } catch {
      setMessage(t("exports.exportError"));
    } finally {
      setIsExporting(false);
    }
  }

  return <PortalShell role="agency">
    <Link className="back-link portal-back-link" to="/agency"><ArrowLeft size={15} />{t("nav.agencyHome")}</Link>
    <PageHeading eyebrow={t("nav.exports")} title={t("exports.title")} description={t("exports.lead")} />
    <div className="designer-prototype"><Info size={16} /><span>{t("exports.prototypeNote")}</span></div>
    {message && <div className="sr-only">{message}</div>}

    <div className="designer-layout"><main className="designer-panel designer-panel--main">
      <section className="designer-section"><div className="designer-section-head"><span className="section-step">01</span><div><h2>{t("exports.productionField")}</h2><p>{t("exports.productionFieldHint")}</p></div></div>
        <div className="export-choice-row"><label><input type="radio" name="production-mode" checked={productionMode === "all"} onChange={() => setProductionMode("all")} />{t("exports.allProductions")}</label><label><input type="radio" name="production-mode" checked={productionMode === "selected"} onChange={() => setProductionMode("selected")} />{t("exports.chooseProductions")}</label></div>
        {productionMode === "selected" && <fieldset className="export-checkbox-list"><legend>{t("exports.chooseProductions")}</legend>{factories.map((factory) => <label key={factory.id}><input type="checkbox" checked={selectedFactories.includes(factory.id)} onChange={() => toggleFactory(factory.id)} />{factory.name}</label>)}</fieldset>}
      </section>
      <section className="designer-section"><div className="designer-section-head"><span className="section-step">02</span><div><h2>{t("exports.workersField")}</h2><p>{t("exports.workersFieldHint")}</p></div></div>
        <div className="export-choice-row"><label><input type="radio" name="worker-mode" checked={workerMode === "all"} onChange={() => setWorkerMode("all")} />{t("exports.allWorkers")}</label><label><input type="radio" name="worker-mode" checked={workerMode === "selected"} onChange={() => setWorkerMode("selected")} />{t("exports.chooseWorkers")}</label></div>
        {workerMode === "selected" && <div className="export-worker-picker"><div className="export-picker-toolbar"><label className="field-label"><span>{t("exports.searchWorkers")}</span><input value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} /></label><div><button type="button" className="button button--quiet button--small" onClick={() => setVisibleWorkersSelected(true)}>{t("exports.selectAll")}</button><button type="button" className="button button--quiet button--small" onClick={() => setVisibleWorkersSelected(false)}>{t("exports.clearAll")}</button></div><span>{t("exports.selectedCount", { selected: activeWorkerIds.length, total: availableWorkers.length })}</span></div><fieldset className="export-checkbox-list">{visibleWorkers.map((worker) => <label key={worker.id}><input type="checkbox" checked={selectedWorkers.includes(worker.id)} onChange={() => toggleWorker(worker.id)} /><span>{worker.name}</span><small>{getWorkerProductionAssignments(workspace, worker.id).filter((item) => selectedFactoryIds.includes(item.factoryId)).map((item) => factories.find((factory) => factory.id === item.factoryId)?.name).filter(Boolean).join(", ")}</small></label>)}{visibleWorkers.length === 0 && <p className="muted-copy">{t("workflow.timekeeping.noMatches")}</p>}</fieldset></div>}
      </section>
      <section className="designer-section"><div className="designer-section-head"><span className="section-step">03</span><div><h2>{t("exports.periodTitle")}</h2><p>{t("exports.periodHint")}</p></div></div>
        <div className="period-switch" role="group" aria-label={t("exports.periodTitle")}><button type="button" className={periodKind === "month" ? "is-selected" : ""} onClick={() => setPeriodKind("month")}>{t("exports.periodMonth")}</button><button type="button" className={periodKind === "date" ? "is-selected" : ""} onClick={() => setPeriodKind("date")}>{t("exports.periodDate")}</button><button type="button" className={periodKind === "date-range" ? "is-selected" : ""} onClick={() => setPeriodKind("date-range")}>{t("exports.periodRange")}</button></div>
        {periodKind === "month" ? <label className="field-label period-input"><span>{t("exports.periodMonth")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label> : periodKind === "date" ? <label className="field-label period-input"><span>{t("exports.periodDate")}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label> : <div className="scope-controls period-input"><label className="field-label"><span>{t("common.from")}</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field-label"><span>{t("common.to")}</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>}
      </section>
    </main><aside className="designer-side"><section className="designer-panel"><div className="side-panel-heading"><span className="side-panel-icon"><FileSpreadsheet size={18} /></span><div><span className="eyebrow">TIMEAX</span><h2>{t("exports.templatesTitle")}</h2></div></div>
      {templates.length > 0 && <label className="field-label"><span>{t("exports.selectTemplate")}</span><select value={selectedTemplateId} onChange={(event) => loadTemplate(event.target.value)}><option value="">{t("exports.newTemplate")}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.isDefault ? ` · ${t("exports.defaultLabel")}` : ""}</option>)}</select></label>}
      <label className="field-label"><span>{t("exports.templateName")}</span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label><div className="template-actions"><button className="button button--dark button--full" type="button" disabled={!templateName.trim()} onClick={saveTemplate}><Save size={15} />{t("exports.saveTemplate")}</button><div className="template-action-row"><button type="button" disabled={!selectedTemplateId} onClick={duplicateTemplate}><Copy size={13} />{t("exports.duplicateTemplate")}</button><button type="button" disabled={!selectedTemplateId} onClick={markDefault}><Star size={13} />{t("exports.setDefault")}</button><button type="button" disabled={!selectedTemplateId} onClick={deleteTemplate}><Trash2 size={13} />{t("exports.deleteTemplate")}</button></div></div>
    </section></aside></div>

    <details className="designer-panel export-advanced"><summary>{t("exports.advancedSettings")}</summary><div className="designer-layout"><section className="designer-panel designer-panel--main"><div className="designer-section-head"><div><h2>{t("exports.columnsTitle")}</h2><p>{t("exports.columnsHint")}</p></div></div><div className="column-list">{[...columns].sort((a, b) => a.order - b.order).map((column, index, ordered) => <div className={`column-config${column.enabled ? " is-enabled" : ""}`} key={column.key}><label className="column-check"><input type="checkbox" checked={column.enabled} onChange={(event) => updateColumn(column.key, { enabled: event.target.checked })} /><span className="checkbox-visual" /></label><div className="column-name"><span>{t(columnLabelKeys[column.key])}</span><input aria-label={`${t(columnLabelKeys[column.key])}: ${t("exports.rename")}`} value={column.headerOverride ?? ""} onChange={(event) => updateColumn(column.key, { headerOverride: event.target.value || undefined })} placeholder={t("exports.rename")} /></div><div className="column-order"><button type="button" aria-label={t("exports.moveUp")} disabled={index === 0} onClick={() => moveColumn(column.key, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={t("exports.moveDown")} disabled={index === ordered.length - 1} onClick={() => moveColumn(column.key, 1)}><ArrowDown size={14} /></button></div></div>)}</div></section><aside className="designer-panel settings-panel"><span className="eyebrow">{t("exports.displayOptions")}</span><label className="field-label"><span>{t("exports.dateFormat")}</span><select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as ExcelExportTemplate["dateFormat"])}><option value="dd.MM.yyyy">{t("exports.dateDMY")}</option><option value="yyyy-MM-dd">{t("exports.dateYMD")}</option><option value="localized-long">{t("exports.dateLong")}</option></select></label><label className="field-label"><span>{t("exports.timeFormat")}</span><select value={timeFormat} onChange={(event) => setTimeFormat(event.target.value as ExcelExportTemplate["timeFormat"])}><option value="24-hour">{t("exports.time24")}</option><option value="12-hour">{t("exports.time12")}</option></select></label><div className="toggle-list"><ToggleRow checked={Boolean(columns.find((column) => column.key === "comment")?.enabled)} label={t("exports.comments")} onChange={(value) => updateColumn("comment", { enabled: value })} /><ToggleRow checked={Boolean(columns.find((column) => column.key === "breaks")?.enabled)} label={t("exports.breaks")} onChange={(value) => updateColumn("breaks", { enabled: value })} /><ToggleRow checked={Boolean(columns.find((column) => column.key === "paidTime")?.enabled)} label={t("exports.paidHours")} onChange={(value) => updateColumn("paidTime", { enabled: value })} /><ToggleRow checked={Boolean(columns.find((column) => column.key === "grossDuration")?.enabled)} label={t("exports.grossDuration")} onChange={(value) => updateColumn("grossDuration", { enabled: value })} /><ToggleRow checked={Boolean(columns.find((column) => column.key === "absence")?.enabled)} label={t("exports.weekends")} onChange={(value) => updateColumn("absence", { enabled: value })} /></div></aside></div></details>

    <section className="designer-panel export-preview-panel"><div className="designer-section-head"><span className="section-step">04</span><div><span className="eyebrow">{t("exports.previewTitle")}</span><h2>{t("exports.previewDisclaimer")}</h2></div><span className="preview-badge">XLSX</span></div>
      {orderedEnabledColumns.length && previewRows.length ? <div className="table-scroll"><table className="export-preview-table"><thead><tr>{orderedEnabledColumns.map((column) => <th key={column.key}>{column.headerOverride || t(columnLabelKeys[column.key])}</th>)}</tr></thead><tbody>{visiblePreviewRows.map((row) => <tr key={row.key}>{orderedEnabledColumns.map((column) => <td key={column.key}>{column.key === "worker" && row.workerId ? <WorkerProfileTrigger workerId={row.workerId} className="worker-profile-open">{row.values[column.key]}</WorkerProfileTrigger> : row.values[column.key]}</td>)}</tr>)}</tbody></table></div> : <div className="preview-empty-state">{orderedEnabledColumns.length ? t("exports.noPreviewRows") : t("exports.previewEmpty")}</div>}
      <div className="export-summary-grid"><article><span>{t("exports.totalPaidHours")}</span><strong>{formatDuration(totalPaidMinutes, t)}</strong></article><article><span>{t("workflow.timekeeping.shifts")}</span><strong>{matchingShifts.length}</strong></article><article><span>{t("workflow.timekeeping.confirmed")}</span><strong>{formatDuration(confirmedMinutes, t)}</strong></article><article><span>{t("workflow.timekeeping.pending")}</span><strong>{formatDuration(pendingMinutes, t)}</strong></article><article><span>{t("exports.absenceDays")}</span><strong>{matchingAbsences.length}</strong><small>{Array.from(absenceReasons.entries()).map(([reason, total]) => `${reason}: ${total}`).join(" · ") || "—"}</small></article></div>
      <div className="export-summary-lists"><section><h3>{t("exports.totalsByWorker")}</h3>{selectedWorkerList.map((worker) => { const minutes = matchingShifts.filter((record) => record.shift.workerUid === worker.id).reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0); return <p key={worker.id}><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger><strong>{formatDuration(minutes, t)}</strong></p>; })}</section><section><h3>{t("exports.totalsByProduction")}</h3>{factories.filter((factory) => selectedFactoryIds.includes(factory.id)).map((factory) => { const minutes = matchingShifts.filter((record) => record.shift.factoryId === factory.id).reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0); return <p key={factory.id}><span>{factory.name}</span><strong>{formatDuration(minutes, t)}</strong></p>; })}</section></div>
      <div className="export-preview-footer"><span>{t("exports.previewRows", { total: previewRows.length })}{previewRows.length > 40 ? " · …" : ""}</span><button className="button button--primary" type="button" onClick={downloadWorkbook} disabled={isExporting || activeWorkerIds.length === 0 || orderedEnabledColumns.length === 0}>{isExporting ? t("exports.generating") : t("exports.runExport")}</button></div>
    </section>
  </PortalShell>;
}
