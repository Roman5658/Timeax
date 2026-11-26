import { useState } from "react";
import { useTranslation } from "react-i18next";
import { classifyRecordedAbsence } from "../demo-store";

export function AbsenceClassification({ absenceId }: { absenceId: string }) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  return <details><summary>{t("payroll.absenceDecision")}</summary><p className="muted-copy">{t("payroll.absenceHint")}</p><label className="field-label"><span>{t("workflow.absence.agencyNote")}</span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} required /></label><div className="form-actions">{(["unreported", "agreed-day-off"] as const).map((category) => <button key={category} type="button" className="button button--outline button--small" disabled={!note.trim()} onClick={() => setMessage(t(classifyRecordedAbsence(absenceId, category, note) ? "workflow.absence.decisionSaved" : "payroll.absenceFailed"))}>{t(`workflow.absence.agencyCategory.${category}`)}</button>)}</div>{message && <p role="status">{message}</p>}</details>;
}
