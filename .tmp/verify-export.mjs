import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { createExportWorkbook } = require('./workbook.cjs');
const org = 'org-timeax';
const workerA = { id: 'w-jacek', organizationId: org, role: 'worker', name: 'Jacek Majerski', productionAssignments: [{ factoryId: 'f-north' }] };
const workerB = { id: 'w-bohdan', organizationId: org, role: 'worker', name: 'Bohdan Rys', productionAssignments: [{ factoryId: 'f-north' }] };
const north = { id: 'f-north', organizationId: org, name: 'North', inputMode: 'A', workerAccess: {}, requiredBreakMinutes: 0, workCalendar: { workingWeekdays: [1,2,3,4,5], exceptions: [{ localDate: '2026-04-11', isWorkingDay: true, label: 'Saturday production' }, { localDate: '2026-04-12', isWorkingDay: false, label: 'Plant closed' }] } };
const south = { id: 'f-south', organizationId: org, name: 'South', inputMode: 'A', workerAccess: {}, requiredBreakMinutes: 0, workCalendar: { workingWeekdays: [1,2,3,4,5], exceptions: [] } };
function shift(id, workerUid, factoryId, localStartDate, startAt, endAt, gross, breakMinutes, paid, confirmation) {
  return { organizationId: org, shift: { id, workerUid, agencyId: org, factoryId, localStartDate, startAt, endAt, timeZone: 'Europe/Warsaw', grossDurationMinutes: gross, totalBreakDurationMinutes: breakMinutes, unpaidBreakDurationMinutes: breakMinutes, paidDurationMinutes: paid, actualBreak: { status: breakMinutes ? 'taken' : 'not-taken', segments: [], reviewState: 'not-required' }, breakPolicySnapshot: { appliedRuleIds: [], required: false, allowedTreatments: ['unpaid'], workerMayEditActualTimes: true, workerMayChooseTreatment: true, noBreakRequiresReview: false, capturedAt: startAt, version: 1 }, comment: id === 'night' ? 'Night shift note' : '', source: 'worker', createdByUid: workerUid, createdAt: startAt, updatedByUid: workerUid, updatedAt: startAt, revision: 1, workerConfirmation: confirmation, reviewState: 'not-submitted' }, history: [], previousVersions: [] };
}
const shifts = [
  shift('day', workerA.id, north.id, '2026-04-06', '2026-04-06T08:00:00.000Z', '2026-04-06T12:00:00.000Z', 240, 0, 240, 'confirmed'),
  shift('night', workerA.id, north.id, '2026-04-06', '2026-04-06T20:00:00.000Z', '2026-04-07T04:00:00.000Z', 480, 30, 450, 'pending'),
  shift('excluded', workerA.id, south.id, '2026-04-06', '2026-04-06T15:00:00.000Z', '2026-04-06T16:00:00.000Z', 60, 0, 60, 'confirmed'),
  shift('bohdan', workerB.id, north.id, '2026-04-06', '2026-04-06T06:00:00.000Z', '2026-04-06T11:00:00.000Z', 300, 30, 270, 'disputed'),
];
const absence = { id: 'absence-1', organizationId: org, workerId: workerB.id, factoryId: north.id, groupId: 'g', localDate: '2026-04-08', reason: 'vacation', state: 'reviewed', message: 'Approved time off', createdById: 'agency', history: [] };
const keys = ['worker','agency','folder','factory','shiftDate','weekday','startTime','endTime','grossDuration','breaks','paidTime','shiftNote','confirmation','absence','comment'];
const columns = keys.map((key, order) => ({ key, enabled: true, order }));
const translations = {
  'exports.title': 'Timeax timesheet', 'exports.summaryTitle': 'Period totals', 'exports.grossTotal': 'Gross hours',
  'exports.totalPaidHours': 'Paid hours', 'exports.breakTotal': 'Break hours', 'exports.absenceDays': 'Absences',
  'workflow.timekeeping.shifts': 'Shifts', 'exports.shiftLabel': 'Shift', 'exports.absenceLabel': 'Absence',
  'exports.weekendRow': 'Day off', 'exports.notRecorded': 'No shift recorded', 'workflow.breaks.notTaken': 'No break',
  'workflow.breakReport.notReported': 'Not reported', 'workflow.shiftStatus.pending': 'Pending',
  'workflow.shiftStatus.confirmed': 'Confirmed', 'workflow.shiftStatus.disputed': 'Disputed',
  'workflow.absence.state.reviewed': 'Reviewed', 'workflow.absence.reasons.vacation': 'Vacation',
};
const translate = (key) => translations[key] ?? key;
const placements = (workerId) => ({ id: `employment-${workerId}`, organizationId: org, workerId, state: 'active', startDate: '2026-04-01', createdAt: '2026-04-01T00:00:00Z', createdById: 'agency', placements: [{ id: `placement-${workerId}`, factoryId: north.id, startDate: '2026-04-01', createdAt: '2026-04-01T00:00:00Z', createdById: 'agency' }], history: [] });
const buffer = await createExportWorkbook({ organizationName: 'Timeax Demo', workers: [workerA, workerB], factories: [north], folders: [], employmentPeriods: [placements(workerA.id), placements(workerB.id)], shifts: shifts.filter((r) => r.shift.factoryId === north.id), absences: [absence], factoryIds: [north.id], dates: ['2026-04-06','2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-11','2026-04-12'], columns, dateFormat: 'dd.MM.yyyy', timeFormat: '24-hour', language: 'en-GB', columnHeaders: Object.fromEntries(keys.map((key) => [key, key])), translate });
assert(buffer.byteLength > 1000, 'Workbook buffer should contain an XLSX archive');
const output = new URL('../artifacts/timeax-test-export.xlsx', import.meta.url);
await fs.writeFile(output, Buffer.from(buffer));
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(await fs.readFile(output));
assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Jacek Majerski', 'Bohdan Rys'], 'One sheet should exist for each selected worker');
const sheetA = workbook.getWorksheet('Jacek Majerski');
const sheetB = workbook.getWorksheet('Bohdan Rys');
const headers = sheetA.getRow(5).values.slice(1);
const column = (key) => headers.indexOf(key) + 1;
const bodyRows = (sheet) => sheet.getRows(6, sheet.rowCount - 5).filter((row) => row?.getCell(column('shiftDate')).value instanceof Date);
const rowsA = bodyRows(sheetA);
const rowsB = bodyRows(sheetB);
const dateKey = (row) => row.getCell(column('shiftDate')).value.toISOString().slice(0, 10);
assert.equal(rowsA.filter((row) => dateKey(row) === '2026-04-06').length, 2, 'Two shifts on one date must remain separate rows');
assert.equal(rowsA.some((row) => row.getCell(column('factory')).value === 'South'), false, 'Unselected production must be excluded');
assert.equal(rowsB.some((row) => row.getCell(column('worker')).value === workerA.name), false, 'Worker data must not mix between tabs');
const nightRow = rowsA.find((row) => row.getCell(column('comment')).value === 'Night shift note');
assert.ok(nightRow, 'Night shift row should be present');
assert.equal(nightRow.getCell(column('startTime')).value.getUTCHours(), 22, 'Night start should use the shift timezone');
assert.equal(nightRow.getCell(column('endTime')).value.getUTCHours(), 6, 'Night end should show local next-day time');
assert.equal(nightRow.getCell(column('grossDuration')).value, 8);
assert.equal(nightRow.getCell(column('breaks')).value, 0.5);
assert.equal(nightRow.getCell(column('paidTime')).value, 7.5);
assert.equal(nightRow.getCell(column('confirmation')).fill.fgColor.argb, 'FFFFD98A', 'Pending confirmation should be highlighted');
assert.equal(rowsA.find((row) => dateKey(row) === '2026-04-06').getCell(1).fill.fgColor.argb, 'FFDDF1DF', 'Work rows should be green');
assert.equal(rowsA.find((row) => dateKey(row) === '2026-04-11').getCell(1).fill.fgColor.argb, 'FFFFF1C2', 'Custom Saturday working day should be treated as a working day');
assert.equal(rowsA.find((row) => dateKey(row) === '2026-04-12').getCell(1).fill.fgColor.argb, 'FFFFDADA', 'Calendar rest day should be red');
assert.equal(rowsB.find((row) => row.getCell(column('absence')).value === 'Vacation').getCell(1).fill.fgColor.argb, 'FFE8DEFF', 'Absence row should use its own color');
const totalLabel = (sheet, label) => sheet.getColumn(1).values.findIndex((value) => value === label);
const paidRowA = totalLabel(sheetA, 'Paid hours');
assert.equal(sheetA.getRow(paidRowA).getCell(15).value, 11.5, 'Worker A paid summary should stay independent');
assert.equal(totalLabel(sheetA, 'Shifts') > 0, true);
assert.equal(totalLabel(sheetB, 'Absences') > 0, true);
console.log(JSON.stringify({ path: output.pathname, bytes: buffer.byteLength, sheets: workbook.worksheets.map((sheet) => sheet.name), rows: { jacek: rowsA.length, bohdan: rowsB.length }, checks: ['separate sheets','same-day shifts','production filter','worker isolation','overnight timezone','break and paid time','calendar weekends','absence styling','summary totals'] }, null, 2));


