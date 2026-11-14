import type {
  DemoAbsence,
  DemoSchedule,
  DemoScheduleAttendanceReview,
  DemoShiftRecord,
} from "./domain/demo-types";

export interface WorkerHistoryDay {
  date: string;
  shifts: DemoShiftRecord[];
  absences: DemoAbsence[];
  attendanceReviews: DemoScheduleAttendanceReview[];
  isConfirmedRestDay: boolean;
}

export interface WorkerHistoryMonth {
  key: string;
  days: WorkerHistoryDay[];
  workedShiftCount: number;
  paidMinutes: number;
  missedDayCount: number;
  restDayCount: number;
}

interface WorkerHistoryInput {
  shifts: DemoShiftRecord[];
  absences: DemoAbsence[];
  schedules: DemoSchedule[];
  attendanceReviews: DemoScheduleAttendanceReview[];
  today: string;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function buildWorkerHistory({ shifts, absences, schedules, attendanceReviews, today }: WorkerHistoryInput): WorkerHistoryMonth[] {
  const days = new Map<string, WorkerHistoryDay>();
  const getDay = (date: string) => {
    let day = days.get(date);
    if (!day) {
      day = { date, shifts: [], absences: [], attendanceReviews: [], isConfirmedRestDay: false };
      days.set(date, day);
    }
    return day;
  };

  shifts.forEach((record) => getDay(record.shift.localStartDate).shifts.push(record));
  absences.filter((absence) => absence.state !== "cancelled")
    .forEach((absence) => getDay(absence.localDate).absences.push(absence));
  attendanceReviews.forEach((review) => getDay(review.localDate).attendanceReviews.push(review));

  const activeSchedules = schedules.filter((schedule) => schedule.state === "active" && schedule.weekdays.length > 0);
  if (activeSchedules.length) {
    const firstDate = activeSchedules.reduce((minimum, schedule) => schedule.startDate < minimum ? schedule.startDate : minimum, today);
    const floor = [...shifts.map((record) => record.shift.localStartDate), ...absences.map((absence) => absence.localDate), ...attendanceReviews.map((review) => review.localDate), firstDate]
      .reduce((minimum, date) => date < minimum ? date : minimum, today);
    let date = floor;
    let daysVisited = 0;
    while (date <= today && daysVisited < 12000) {
      const coveringSchedules = activeSchedules.filter((schedule) => schedule.startDate <= date && schedule.endDate >= date);
      const scheduledToday = coveringSchedules.some((schedule) => schedule.weekdays.includes(new Date(`${date}T12:00:00`).getDay()));
      const existing = days.get(date);
      const hasFactualShift = existing?.shifts.some((record) => !record.shift.deletedAt) ?? false;
      const hasAbsenceOrReview = Boolean(existing?.absences.length || existing?.attendanceReviews.length);

      // A weekly schedule only confirms days outside its published weekdays while
      // that schedule is in force. Unknown dates are deliberately left unclassified.
      if (coveringSchedules.length && !scheduledToday && !hasFactualShift && !hasAbsenceOrReview) {
        getDay(date).isConfirmedRestDay = true;
      }

      date = nextDate(date);
      daysVisited += 1;
    }
  }

  const months = new Map<string, WorkerHistoryDay[]>();
  for (const day of days.values()) {
    const key = day.date.slice(0, 7);
    (months.get(key) ?? (months.set(key, []), months.get(key)!)).push(day);
  }

  return [...months.entries()]
    .map(([key, monthDays]) => {
      const sortedDays = monthDays.sort((a, b) => b.date.localeCompare(a.date));
      const workedShifts = sortedDays.flatMap((day) => day.shifts.filter((record) => !record.shift.deletedAt));
      const missedDayCount = sortedDays.filter((day) => !day.shifts.some((record) => !record.shift.deletedAt)
        && (day.absences.some((absence) => absence.state === "unreported")
          || day.attendanceReviews.some((review) => review.outcome === "unreported-absence"))).length;

      return {
        key,
        days: sortedDays,
        workedShiftCount: workedShifts.length,
        paidMinutes: workedShifts.reduce((total, record) => total + record.shift.paidDurationMinutes, 0),
        missedDayCount,
        restDayCount: sortedDays.filter((day) => day.isConfirmedRestDay).length,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}
