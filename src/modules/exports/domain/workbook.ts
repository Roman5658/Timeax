import ExcelJS from "exceljs";
import type { TFunction } from "i18next";
import type { ExcelExportTemplate, ExportColumnConfig, ExportColumnKey } from "./types";
import type { DemoAbsence, DemoEmploymentPeriod, DemoFactory, DemoMember, DemoShiftRecord } from "../../workflows/domain/demo-types";
import { workerHasProductionOnDate } from "./employment-scope.ts";

export interface ExportWorkbookInput {
  organizationName: string;
  workers: DemoMember[];
  factories: DemoFactory[];
  folders: Array<{ id: string; name: string }>;
  employmentPeriods: DemoEmploymentPeriod[];
  shifts: DemoShiftRecord[];
  absences: DemoAbsence[];
  factoryIds: string[];
  dates: string[];
  columns: ExportColumnConfig[];
  dateFormat: ExcelExportTemplate["dateFormat"];
  timeFormat: ExcelExportTemplate["timeFormat"];
  language: string;
  columnHeaders: Record<ExportColumnKey, string>;
  translate: TFunction;
}

type DataRow =
  | { type: "shift"; date: string; factoryId: string; shift: DemoShiftRecord["shift"] }
  | { type: "absence"; date: string; factoryId: string; absence: DemoAbsence }
  | { type: "rest" | "unrecorded"; date: string; factoryId: string; label?: string };

const fills = {
  header: "FF385A48",
  shift: "FFDDF1DF",
  rest: "FFFFDADA",
  unrecorded: "FFFFF1C2",
  absence: "FFE8DEFF",
  pending: "FFFFD98A",
  disputed: "FFFFB3B3",
  confirmed: "FFBDE6C4",
  total: "FFDCE7F2",
} as const;

const dateNumberFormats: Record<ExcelExportTemplate["dateFormat"], string> = {
  "dd.MM.yyyy": "dd.mm.yyyy",
  "yyyy-MM-dd": "yyyy-mm-dd",
  "localized-long": "dddd, d mmmm yyyy",
};

const durationNumberFormat = "[h]:mm";
const columnWidths: Record<ExportColumnKey, number> = {
  worker: 24,
  agency: 26,
  folder: 20,
  factory: 23,
  shiftDate: 15,
  weekday: 16,
  startTime: 13,
  endTime: 13,
  grossDuration: 19,
  breaks: 18,
  paidTime: 20,
  shiftNote: 27,
  comment: 38,
  confirmation: 23,
  absence: 28,
};

function dateValue(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function localTimeFraction(isoDateTime: string, locale: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(isoDateTime));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return (hour * 60 + minute) / 1440;
}

function safeSheetName(name: string, usedNames: Set<string>): string {
  const base = name.replace(/[\\/*?:\[\]]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Worker";
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    const marker = ` (${suffix++})`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function applyFill(row: ExcelJS.Row, color: string, columnCount: number) {
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFD5DDD7" } },
      right: { style: "thin", color: { argb: "FFD5DDD7" } },
    };
  }
}

function worksheetRows(input: ExportWorkbookInput, worker: DemoMember): DataRow[] {
  const selectedFactories = new Set(input.factoryIds);
  const workerPeriods = input.employmentPeriods.filter((period) => period.organizationId === worker.organizationId && period.workerId === worker.id);
  const selectedDates = new Set(input.dates);
  const rows: DataRow[] = [];
  const activity = new Set<string>();
  const seenRecords = new Set<string>();

  for (const record of input.shifts) {
    const { shift } = record;
    const factoryId = shift.factoryId;
    if (record.organizationId !== worker.organizationId || shift.agencyId !== worker.organizationId
      || shift.workerUid !== worker.id || shift.deletedAt || !factoryId || !selectedFactories.has(factoryId)
      || !selectedDates.has(shift.localStartDate) || seenRecords.has(`shift:${shift.id}`)) continue;
    if (!workerHasProductionOnDate(workerPeriods, {
      organizationId: worker.organizationId,
      workerId: worker.id,
      factoryId,
      date: shift.localStartDate,
      employmentId: shift.employmentId,
    }, worker.productionAssignments?.map((assignment) => assignment.factoryId))) continue;
    seenRecords.add(`shift:${shift.id}`);
    rows.push({ type: "shift", date: shift.localStartDate, factoryId, shift });
    activity.add(`${factoryId}|${shift.localStartDate}`);
  }
  for (const absence of input.absences) {
    if (absence.organizationId !== worker.organizationId || absence.workerId !== worker.id
      || !selectedFactories.has(absence.factoryId) || !selectedDates.has(absence.localDate)
      || seenRecords.has(`absence:${absence.id}`)) continue;
    if (!workerHasProductionOnDate(workerPeriods, {
      organizationId: worker.organizationId,
      workerId: worker.id,
      factoryId: absence.factoryId,
      date: absence.localDate,
      employmentId: absence.employmentId,
    }, worker.productionAssignments?.map((assignment) => assignment.factoryId))) continue;
    seenRecords.add(`absence:${absence.id}`);
    rows.push({ type: "absence", date: absence.localDate, factoryId: absence.factoryId, absence });
    activity.add(`${absence.factoryId}|${absence.localDate}`);
  }

  for (const date of input.dates) {
    const assignedFactories = new Set<string>();
    for (const period of workerPeriods) {
      for (const placement of period.placements) {
        if (selectedFactories.has(placement.factoryId) && workerHasProductionOnDate([period], {
          organizationId: worker.organizationId,
          workerId: worker.id,
          factoryId: placement.factoryId,
          date,
          employmentId: period.id,
        })) assignedFactories.add(placement.factoryId);
      }
    }
    // Older demo records may have current assignments without an employment placement.
    if (workerPeriods.length === 0 && worker.productionAssignments) {
      worker.productionAssignments.filter((assignment) => selectedFactories.has(assignment.factoryId)
        && workerHasProductionOnDate([], { organizationId: worker.organizationId, workerId: worker.id, factoryId: assignment.factoryId, date }, [assignment.factoryId]))
        .forEach((assignment) => assignedFactories.add(assignment.factoryId));
    }
    for (const factoryId of assignedFactories) {
      if (activity.has(`${factoryId}|${date}`)) continue;
      const factory = input.factories.find((item) => item.id === factoryId);
      const exception = factory?.workCalendar?.exceptions.find((item) => item.localDate === date);
      const weekday = dateValue(date).getUTCDay();
      const isWorkingDay = exception?.isWorkingDay ?? (factory?.workCalendar?.workingWeekdays ?? [1, 2, 3, 4, 5]).includes(weekday);
      rows.push(isWorkingDay ? { type: "unrecorded", date, factoryId } : { type: "rest", date, factoryId, label: exception?.label });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date)
    || (a.type === "shift" ? a.shift.startAt : "").localeCompare(b.type === "shift" ? b.shift.startAt : "")
    || a.factoryId.localeCompare(b.factoryId));
}

function rowValues(input: ExportWorkbookInput, worker: DemoMember, row: DataRow, key: ExportColumnKey): ExcelJS.CellValue {
  const { t } = { t: input.translate };
  const factory = input.factories.find((item) => item.id === row.factoryId);
  const folderName = input.folders.find((folder) => folder.id === worker.folderId)?.name ?? "";
  const shift = row.type === "shift" ? row.shift : undefined;
  const absence = row.type === "absence" ? row.absence : undefined;
  switch (key) {
    case "worker": return worker.name;
    case "agency": return input.organizationName;
    case "folder": return folderName;
    case "factory": return factory?.name ?? "";
    case "shiftDate": return dateValue(row.date);
    case "weekday": return new Intl.DateTimeFormat(input.language, { weekday: "long", timeZone: "UTC" }).format(dateValue(row.date));
    case "startTime": return shift ? localTimeFraction(shift.startAt, input.language, shift.timeZone) : "";
    case "endTime": return shift ? localTimeFraction(shift.endAt, input.language, shift.timeZone) : "";
    case "grossDuration": return shift ? shift.grossDurationMinutes / 1440 : "";
    case "breaks":
      if (shift) return shift.actualBreak.status === "taken" ? (shift.totalBreakDurationMinutes / 1440) : shift.actualBreak.status === "not-taken" ? t("breaks.notTaken") : t("workflow.breakReport.notReported");
      return "";
    case "paidTime": return shift ? shift.paidDurationMinutes / 1440 : "";
    case "shiftNote": return shift ? t("exports.shiftLabel") : absence ? t("exports.absenceLabel") : row.type === "rest" ? t("exports.weekendRow") : t("exports.notRecorded");
    case "comment": return shift?.comment ?? absence?.agencyNote ?? "";
    case "confirmation": return shift ? t(`workflow.shiftStatus.${shift.workerConfirmation}`) : absence ? t(`workflow.absence.state.${absence.state}`) : "";
    case "absence":
      if (absence) return t(`workflow.absence.agencyCategory.${absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention")}`);
      if (row.type === "rest") return row.label || t("exports.weekendRow");
      if (row.type === "unrecorded") return t("exports.notRecorded");
      return "";
  }
}

function styleDataRow(row: ExcelJS.Row, data: DataRow, statusColumn: number | undefined, input: ExportWorkbookInput) {
  const rowFill = data.type === "shift" ? fills.shift : data.type === "absence" ? fills.absence : data.type === "rest" ? fills.rest : fills.unrecorded;
  applyFill(row, rowFill, input.columns.length);
  let rowHeight = 22;
  input.columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    const centered = ["shiftDate", "weekday", "startTime", "endTime", "grossDuration", "breaks", "paidTime", "confirmation"].includes(column.key);
    cell.alignment = { horizontal: centered ? "center" : "left", vertical: "middle", wrapText: true };
    if (typeof cell.value === "string") {
      rowHeight = Math.max(rowHeight, Math.ceil(cell.value.length / Math.max(8, columnWidths[column.key] - 2)) * 15 + 7);
    }
  });
  row.height = Math.min(96, rowHeight);
  if (statusColumn && data.type === "shift") {
    const status = data.shift.workerConfirmation;
    const color = status === "disputed" ? fills.disputed : status === "pending" ? fills.pending : status === "confirmed" ? fills.confirmed : undefined;
    if (color) row.getCell(statusColumn).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
}

export async function createExportWorkbook(input: ExportWorkbookInput): Promise<ArrayBuffer> {
  const columns = input.columns.filter((column) => column.enabled).slice().sort((a, b) => a.order - b.order);
  if (!columns.length) throw new Error("No export columns are enabled.");
  const factoryIds = [...new Set(input.factoryIds)];
  const workerMap = new Map<string, DemoMember>();
  for (const worker of input.workers) workerMap.set(`${worker.organizationId}:${worker.id}`, worker);
  const workers = [...workerMap.values()];
  const scopedInput = { ...input, factoryIds };
  const rowsByWorker = new Map(workers.map((worker) => [`${worker.organizationId}:${worker.id}`, worksheetRows(scopedInput, worker)]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Timeax";
  workbook.subject = input.translate("exports.title");
  workbook.title = `${input.translate("exports.title")} — ${input.organizationName}`;
  workbook.company = input.organizationName;
  workbook.created = new Date();
  const usedSheetNames = new Set<string>();
  const summarySheet = workbook.addWorksheet(safeSheetName(input.translate("monthlyTimesheets.productionTotal"), usedSheetNames));
  summarySheet.properties.defaultRowHeight = 20;
  summarySheet.pageSetup.orientation = "landscape";
  summarySheet.pageSetup.fitToPage = true;
  summarySheet.pageSetup.fitToWidth = 1;
  summarySheet.pageSetup.fitToHeight = 0;
  summarySheet.columns = [
    { key: "factory", width: 26 }, { key: "worker", width: 26 }, { key: "shifts", width: 12 },
    { key: "gross", width: 20 }, { key: "breaks", width: 18 }, { key: "paid", width: 20 }, { key: "absences", width: 14 },
  ];
  const summaryTitle = summarySheet.addRow([input.translate("monthlyTimesheets.title")]);
  summarySheet.mergeCells(summaryTitle.number, 1, summaryTitle.number, 7);
  summaryTitle.font = { bold: true, size: 16, color: { argb: "FF263B30" } };
  summaryTitle.height = 28;
  const monthText = input.dates.length ? `${input.dates[0]} — ${input.dates[input.dates.length - 1]}` : "";
  const periodRow = summarySheet.addRow([`${input.organizationName} · ${monthText}`]);
  summarySheet.mergeCells(periodRow.number, 1, periodRow.number, 7);
  periodRow.font = { italic: true, color: { argb: "FF66746A" }, size: 9 };
  const summaryHeader = summarySheet.addRow([
    input.translate("workflow.fields.production"), input.translate("workflow.role.worker"),
    input.translate("monthlyTimesheets.shifts"), input.translate("monthlyTimesheets.gross"),
    input.translate("monthlyTimesheets.breaks"), input.translate("monthlyTimesheets.paid"),
    input.translate("monthlyTimesheets.absences"),
  ]);
  summaryHeader.height = 32;
  summaryHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills.header } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  const grand = { shifts: 0, gross: 0, breaks: 0, paid: 0, absences: 0 };
  for (const factoryId of factoryIds) {
    const selectedFactory = input.factories.find((factory) => factory.id === factoryId);
    if (!selectedFactory) continue;
    const factoryTotals = { shifts: 0, gross: 0, breaks: 0, paid: 0, absences: 0 };
    let wroteWorker = false;
    for (const worker of workers) {
      const workerRows = rowsByWorker.get(`${worker.organizationId}:${worker.id}`) ?? [];
      const relevantRows = workerRows.filter((row) => row.factoryId === factoryId);
      const shifts = relevantRows.filter((row): row is Extract<DataRow, { type: "shift" }> => row.type === "shift");
      const absences = relevantRows.filter((row): row is Extract<DataRow, { type: "absence" }> => row.type === "absence");
      if (relevantRows.length === 0) continue;
      wroteWorker = true;
      const rowValues = [selectedFactory.name, worker.name, shifts.length,
        shifts.reduce((sum, record) => sum + record.shift.grossDurationMinutes, 0) / 1440,
        shifts.reduce((sum, record) => sum + record.shift.totalBreakDurationMinutes, 0) / 1440,
        shifts.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0) / 1440,
        absences.length];
      const row = summarySheet.addRow(rowValues);
      row.getCell(4).numFmt = durationNumberFormat;
      row.getCell(5).numFmt = durationNumberFormat;
      row.getCell(6).numFmt = durationNumberFormat;
      row.eachCell((cell) => { cell.alignment = { vertical: "middle", wrapText: true }; cell.border = { bottom: { style: "thin", color: { argb: "FFD5DDD7" } } }; });
      factoryTotals.shifts += shifts.length;
      factoryTotals.gross += shifts.reduce((sum, record) => sum + record.shift.grossDurationMinutes, 0);
      factoryTotals.breaks += shifts.reduce((sum, record) => sum + record.shift.totalBreakDurationMinutes, 0);
      factoryTotals.paid += shifts.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
      factoryTotals.absences += absences.length;
    }
    if (wroteWorker) {
      const subtotal = summarySheet.addRow([`${selectedFactory.name} · ${input.translate("monthlyTimesheets.productionTotal")}`, "", factoryTotals.shifts, factoryTotals.gross / 1440, factoryTotals.breaks / 1440, factoryTotals.paid / 1440, factoryTotals.absences]);
      applyFill(subtotal, fills.total, 7);
      subtotal.font = { bold: true, color: { argb: "FF1F3B57" } };
      subtotal.getCell(4).numFmt = durationNumberFormat;
      subtotal.getCell(5).numFmt = durationNumberFormat;
      subtotal.getCell(6).numFmt = durationNumberFormat;
    }
    grand.shifts += factoryTotals.shifts;
    grand.gross += factoryTotals.gross;
    grand.breaks += factoryTotals.breaks;
    grand.paid += factoryTotals.paid;
    grand.absences += factoryTotals.absences;
  }
  const totalRow = summarySheet.addRow([input.translate("monthlyTimesheets.productionTotal"), "", grand.shifts, grand.gross / 1440, grand.breaks / 1440, grand.paid / 1440, grand.absences]);
  applyFill(totalRow, fills.total, 7);
  totalRow.font = { bold: true, size: 12, color: { argb: "FF1F3B57" } };
  totalRow.getCell(4).numFmt = durationNumberFormat;
  totalRow.getCell(5).numFmt = durationNumberFormat;
  totalRow.getCell(6).numFmt = durationNumberFormat;
  summarySheet.views = [{ state: "frozen", ySplit: summaryHeader.number, activeCell: `A${summaryHeader.number + 1}`, zoomScale: 90 }];
  summarySheet.autoFilter = { from: { row: summaryHeader.number, column: 1 }, to: { row: Math.max(summaryHeader.number, summarySheet.rowCount - 1), column: 7 } };
  const enabledKeys = columns.map((column) => column.key);
  const statusColumn = enabledKeys.indexOf("confirmation") + 1 || undefined;
  const dateColumn = enabledKeys.indexOf("shiftDate") + 1 || undefined;
  const startColumn = enabledKeys.indexOf("startTime") + 1 || undefined;
  const endColumn = enabledKeys.indexOf("endTime") + 1 || undefined;
  const durationColumns = ["grossDuration", "breaks", "paidTime"] as const;

  for (const worker of workers) {
    const dataRows = rowsByWorker.get(`${worker.organizationId}:${worker.id}`) ?? [];
    if (!dataRows.length) continue;
    const sheet = workbook.addWorksheet(safeSheetName(worker.name, usedSheetNames));
    sheet.properties.defaultRowHeight = 20;
    sheet.pageSetup.orientation = "landscape";
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 0;
    sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    sheet.columns = columns.map((column) => ({ key: column.key, width: columnWidths[column.key] }));

    const title = sheet.addRow([input.translate("exports.title")]);
    if (columns.length > 1) sheet.mergeCells(title.number, 1, title.number, columns.length);
    title.font = { bold: true, size: 16, color: { argb: "FF263B30" } };
    title.alignment = { vertical: "middle" };
    title.height = 28;
    const workerTitle = sheet.addRow([worker.name]);
    if (columns.length > 1) sheet.mergeCells(workerTitle.number, 1, workerTitle.number, columns.length);
    workerTitle.font = { bold: true, size: 13 };
    const periodText = input.dates.length ? `${input.dates[0]} — ${input.dates[input.dates.length - 1]}` : "";
    const periodRow = sheet.addRow([`${input.organizationName} · ${periodText}`]);
    if (columns.length > 1) sheet.mergeCells(periodRow.number, 1, periodRow.number, columns.length);
    periodRow.font = { italic: true, color: { argb: "FF66746A" }, size: 9 };
    sheet.addRow([]);

    const header = sheet.addRow(columns.map((column) => column.headerOverride?.trim() || input.columnHeaders[column.key]));
    header.height = 32;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills.header } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF243D2F" } },
        bottom: { style: "medium", color: { argb: "FF243D2F" } },
        left: { style: "thin", color: { argb: "FF243D2F" } },
        right: { style: "thin", color: { argb: "FF243D2F" } },
      };
    });
    for (const data of dataRows) {
      const row = sheet.addRow(columns.map((column) => rowValues(input, worker, data, column.key)));
      styleDataRow(row, data, statusColumn, { ...input, columns });
      if (dateColumn) row.getCell(dateColumn).numFmt = dateNumberFormats[input.dateFormat];
      if (startColumn) row.getCell(startColumn).numFmt = input.timeFormat === "12-hour" ? "h:mm AM/PM" : "hh:mm";
      if (endColumn) row.getCell(endColumn).numFmt = input.timeFormat === "12-hour" ? "h:mm AM/PM" : "hh:mm";
      for (const key of durationColumns) {
        const index = enabledKeys.indexOf(key) + 1;
        if (index > 0 && typeof row.getCell(index).value === "number") row.getCell(index).numFmt = durationNumberFormat;
      }
      if (data.type === "shift" && statusColumn && data.shift.workerConfirmation === "disputed") row.getCell(statusColumn).font = { bold: true, color: { argb: "FF7F1D1D" } };
      if (data.type === "shift" && statusColumn && data.shift.workerConfirmation === "pending") row.getCell(statusColumn).font = { bold: true, color: { argb: "FF854D0E" } };
    }
    const lastDataRow = header.number + dataRows.length;
    sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: Math.max(header.number, lastDataRow), column: columns.length } };
    sheet.views = [{ state: "frozen", ySplit: header.number, activeCell: `A${header.number + 1}`, zoomScale: 90, zoomScaleNormal: 100 }];

    const shifts = dataRows.filter((row): row is Extract<DataRow, { type: "shift" }> => row.type === "shift");
    const absences = dataRows.filter((row): row is Extract<DataRow, { type: "absence" }> => row.type === "absence");
    const workedMinutes = shifts.reduce((total, record) => total + record.shift.grossDurationMinutes, 0);
    const paidMinutes = shifts.reduce((total, record) => total + record.shift.paidDurationMinutes, 0);
    const breakMinutes = shifts.reduce((total, record) => total + record.shift.totalBreakDurationMinutes, 0);
    sheet.addRow([]);
    const summaryTitle = sheet.addRow([input.translate("exports.summaryTitle")]);
    if (columns.length > 1) sheet.mergeCells(summaryTitle.number, 1, summaryTitle.number, columns.length);
    applyFill(summaryTitle, fills.total, columns.length);
    summaryTitle.font = { bold: true, color: { argb: "FF1F3B57" } };
    const summary = [
      { label: input.translate("exports.grossTotal"), value: workedMinutes / 1440, isDuration: true },
      { label: input.translate("exports.totalPaidHours"), value: paidMinutes / 1440, isDuration: true },
      { label: input.translate("exports.breakTotal"), value: breakMinutes / 1440, isDuration: true },
      { label: input.translate("workflow.timekeeping.shifts"), value: shifts.length, isDuration: false },
      { label: input.translate("exports.absenceDays"), value: absences.length, isDuration: false },
    ];
    for (const { label, value, isDuration } of summary) {
      const row = sheet.addRow([label]);
      const valueColumn = Math.max(2, columns.length);
      row.getCell(valueColumn).value = value;
      if (typeof value === "number") row.getCell(valueColumn).numFmt = isDuration ? durationNumberFormat : "0";
      applyFill(row, fills.total, valueColumn);
      row.getCell(1).font = { bold: true };
      row.getCell(valueColumn).font = { bold: true };
      if (valueColumn > 2) sheet.mergeCells(row.number, 1, row.number, valueColumn - 1);
    }
    sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
    sheet.pageSetup.printArea = `A1:${sheet.getCell(sheet.rowCount, columns.length).address}`;
    sheet.getColumn(1).alignment = { vertical: "middle", wrapText: true };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
