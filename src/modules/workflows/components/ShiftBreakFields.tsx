import { useTranslation } from "react-i18next";
import type { ShiftDraft } from "../demo-store";

type BreakDraftFields = Pick<ShiftDraft, "breakStatus" | "breakTreatment" | "breakDurationMinutes" | "breakStartTime" | "breakEndTime">;

export function ShiftBreakFields({ value, onChange, wide = false }: {
  value: BreakDraftFields;
  onChange: (update: (current: BreakDraftFields) => BreakDraftFields) => void;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const wrapperClass = `field-label${wide ? " field-label--wide" : ""}`;
  const selection = value.breakStatus !== "taken" ? "none" : value.breakTreatment === "paid" ? "paid" : "unpaid";

  function setSelection(next: string) {
    onChange((current) => next === "none"
      ? { ...current, breakStatus: "not-reported", breakTreatment: "unpaid", breakDurationMinutes: 0, breakStartTime: "", breakEndTime: "" }
      : { ...current, breakStatus: "taken", breakTreatment: next === "paid" ? "paid" : "unpaid", breakDurationMinutes: next === "unpaid" ? current.breakDurationMinutes ?? 0 : 0, breakStartTime: "", breakEndTime: "" });
  }

  return <>
    <label className={wrapperClass}><span>{t("workflow.breakReport.inputLabel")}</span><select value={selection} onChange={(event) => setSelection(event.target.value)}>
      <option value="none">{t("workflow.breakReport.none")}</option>
      <option value="paid">{t("workflow.breakReport.paidChoice")}</option>
      <option value="unpaid">{t("workflow.breakReport.unpaidChoice")}</option>
    </select></label>
    <p className={`${wrapperClass} break-entry-hint`}>{t(selection === "none" ? "workflow.breakReport.templateNoneHelp" : selection === "paid" ? "workflow.breakReport.templatePaidHelp" : "workflow.breakReport.templateUnpaidHelp")}</p>
    {selection === "unpaid" && <label className={wrapperClass}><span>{t("workflow.breakReport.minutesToDeduct")}</span><input type="number" min="1" step="1" max="1440" value={value.breakDurationMinutes || ""} onChange={(event) => onChange((current) => ({ ...current, breakDurationMinutes: Number(event.target.value) }))} required /></label>}
  </>;
}
