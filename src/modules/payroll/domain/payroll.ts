import { buildMonthlyTimesheetSnapshot } from "../../monthly-timesheets/domain/timesheet.ts";
import type { DemoWorkspace } from "../../workflows/domain/demo-types";

export interface PayrollContext {
  contract: "unknown" | "employment" | "mandate" | "specific" | "b2b";
  under26: string; student: string; ppk: string; otherInsurance: string; sickness: string; taxResident: string;
}
export const defaultPayrollContext: PayrollContext = { contract: "unknown", under26: "unknown", student: "unknown", ppk: "unknown", otherInsurance: "unknown", sickness: "unknown", taxResident: "unknown" };
export interface PayrollInput {
  context?: PayrollContext;
  dayHours: number;
  nightHours: number;
  dayRate: number;
  nightRate: number;
  additions: number;
  deductions: number;
  note: string;
}
export interface PayrollSettings { dayRate: number; nightRate: number; issueEnabled: boolean; rateBasis?: "gross" | "net"; context?: PayrollContext }
export interface DemoPayslip {
  id: string; organizationId: string; workerId: string; month: string;
  workerName: string; organizationName: string; issuedAt: string; issuedById: string;
  input: PayrollInput; gross: number; net: number; demo: true;
}
export function calculatePayroll(input: PayrollInput): { gross: number; net: number } | undefined {
  if (input.context && (!["unknown", "employment", "mandate", "specific", "b2b"].includes(input.context.contract)
    || [input.context.under26, input.context.student, input.context.ppk, input.context.otherInsurance, input.context.sickness, input.context.taxResident].some((value) => !["unknown", "yes", "no"].includes(value)))) return undefined;
  const values = [input.dayHours, input.nightHours, input.dayRate, input.nightRate, input.additions, input.deductions];
  if (values.some((value) => !Number.isFinite(value) || value < 0) || input.dayHours + input.nightHours > 744
    || input.dayRate > 10000 || input.nightRate > 10000 || input.additions > 10000000 || input.deductions > 10000000
    || input.note.length > 500) return undefined;
  const grossCents = Math.round(input.dayHours * Math.round(input.dayRate * 100) + input.nightHours * Math.round(input.nightRate * 100)) + Math.round(input.additions * 100);
  const netCents = grossCents - Math.round(input.deductions * 100);
  if (netCents < 0) return undefined;
  return { gross: grossCents / 100, net: netCents / 100 };
}
export function payrollHours(workspace: DemoWorkspace, workerId: string, month: string) {
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker");
  const organization = workspace.organizations.find((org) => org.id === worker?.organizationId);
  if (!worker || !organization || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { dayHours: 0, nightHours: 0, count: 0, attention: 0 };
  const scoped = { ...workspace, organization };
  const rows = workspace.factories.filter((factory) => factory.organizationId === organization.id)
    .flatMap((factory) => buildMonthlyTimesheetSnapshot(scoped, factory.id, month, "agency").rows)
    .filter((row) => row.kind === "shift" && row.workerId === workerId);
  const unique = [...new Map(rows.map((row) => [row.recordId, row])).values()];
  const paid = unique.reduce((sum, row) => sum + row.paidDurationMinutes, 0);
  const night = unique.reduce((sum, row) => sum + Math.min(row.paidDurationMinutes, row.nightDurationMinutes), 0);
  return { dayHours: (paid - night) / 60, nightHours: night / 60, count: unique.length,
    attention: unique.filter((row) => row.attentionReasons?.length || row.dataMismatch).length };
}
