import { elapsedShiftMinutes } from "./domain/zoned-time.ts";
import type { Shift } from "../shifts/domain/types";
import type { TFunction } from "i18next";
import type { DemoShiftRecord, DemoShiftValues } from "./domain/demo-types";
import type { ShiftDraft } from "./demo-store";

export function todayLocalDate(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function inputTime(value?: string, timeZone = "Europe/Warsaw"): string {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function shiftDraft(record: DemoShiftRecord): ShiftDraft {
  const shift = record.shift;
  return {
    factoryId: shift.factoryId,
    localDate: shift.localStartDate,
    startTime: inputTime(shift.startAt, shift.timeZone),
    endTime: inputTime(shift.endAt, shift.timeZone),
    comment: shift.comment ?? "",
    breakStatus: shift.actualBreak.status,
    breakTreatment: shift.actualBreak.segments[0]?.treatment ?? shift.actualBreak.treatment ?? (shift.totalBreakDurationMinutes > 0 && shift.unpaidBreakDurationMinutes === 0 ? "paid" : "unpaid"),
    breakDurationMinutes: shift.totalBreakDurationMinutes,
    breakStartTime: inputTime(shift.actualBreak.segments[0]?.startAt, shift.timeZone),
    breakEndTime: inputTime(shift.actualBreak.segments[0]?.endAt, shift.timeZone),
    plannedBreakStart: record.plannedBreak?.startTime ?? "",
    plannedBreakEnd: record.plannedBreak?.endTime ?? "",
    plannedBreakTreatment: record.plannedBreak?.treatment,
    plannedBreakDurationMinutes: record.plannedBreak?.durationMinutes ?? 0,
  };
}

export function shiftHours(startTime: string, endTime: string, localDate?: string, timeZone = "Europe/Warsaw"): number {
  if (localDate && startTime && endTime) { const minutes = elapsedShiftMinutes(localDate, startTime, endTime, timeZone); return Number.isFinite(minutes) ? minutes : 0; }
  if (!startTime || !endTime || startTime === endTime) return 0;
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  let minutes = endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

export function breakMinutes(startTime?: string, endTime?: string): number {
  if (!startTime || !endTime || startTime === endTime) return 0;
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  let minutes = endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes;
}

export function formatDuration(minutes: number, t: TFunction): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t("workflow.durationMinutes", { value: rest });
  if (!rest) return t("workflow.durationHours", { value: hours });
  return `${t("workflow.durationHours", { value: hours })} ${t("workflow.durationMinutes", { value: rest })}`;
}

export function valuesTimeRange(values: DemoShiftValues): string {
  return `${inputTime(values.startAt)}–${inputTime(values.endAt)}`;
}

export function shiftTitle(shift: Shift): string {
  return `${inputTime(shift.startAt, shift.timeZone)}–${inputTime(shift.endAt, shift.timeZone)}`;
}
