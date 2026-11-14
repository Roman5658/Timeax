import { useTranslation } from "react-i18next";
import { formatDate } from "../../../shared/formatters";
import type { DemoShiftHistoryEntry } from "../domain/demo-types";
import { formatDuration, valuesTimeRange } from "../workflow-utils";

function valueSummary(values: NonNullable<DemoShiftHistoryEntry["oldValues"]>, t: ReturnType<typeof useTranslation>["t"]) {
  const breakMinutes = values.totalBreakDurationMinutes ?? values.unpaidBreakDurationMinutes;
  const breakState = values.breakStatus === "taken" ? t("breaks.taken") : values.breakStatus === "not-taken" ? t("breaks.notTaken") : t("workflow.breakReport.notReported");
  const breakType = values.breakTreatment ? t(values.breakTreatment === "paid" ? "workflow.agency.paidBreak" : "workflow.agency.unpaidBreak") : "";
  return `${values.localDate} · ${valuesTimeRange(values)} · ${formatDuration(values.paidDurationMinutes, t)} · ${t("workflow.fields.breakDuration")}: ${formatDuration(breakMinutes, t)}${breakType ? ` (${breakType})` : ""} · ${breakState}`;
}

export function ShiftHistory({ entries }: { entries: DemoShiftHistoryEntry[] }) {
  const { t } = useTranslation();
  return <div className="shift-history">
    <h4>{t("workflow.history.title")}</h4>
    {entries.slice().reverse().map((entry) => <article className="history-event" key={entry.id}>
      <span className="history-dot" />
      <div className="history-event-content">
        <strong>{t(`workflow.history.action.${entry.action}`)}</strong>
        <span>{entry.actorName} · {formatDate(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}</span>
        {entry.oldValues && <div className="history-values"><span>{t("workflow.history.before")}: {valueSummary(entry.oldValues, t)}</span></div>}
        {entry.newValues && <div className="history-values"><span>{t("workflow.history.after")}: {valueSummary(entry.newValues, t)}</span></div>}
        {entry.note && <p>{entry.note}</p>}
      </div>
    </article>)}
  </div>;
}
