import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/ToastProvider";
import type { DemoShiftRecord } from "../domain/demo-types";
import { resolveRequiredBreakReview } from "../demo-store";

export function RequiredBreakReview({ record, allowActions = false }: { record: DemoShiftRecord; allowActions?: boolean }) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [note, setNote] = useState("");
  const { shift } = record;
  if (!shift.breakPolicySnapshot.required || shift.reviewState === "not-submitted") return null;

  const status = shift.reviewState === "pending"
    ? t("workflow.breakReport.reviewPending")
    : shift.reviewState === "approved"
      ? t("workflow.breakReport.reviewApproved")
      : t("workflow.breakReport.reviewReturned");

  function submit(decision: "approve" | "return") {
    const saved = resolveRequiredBreakReview(shift.id, decision, note);
    showToast(t(saved ? decision === "approve" ? "workflow.breakReport.reviewSaved" : "workflow.breakReport.reviewReturnedSaved" : "workflow.errors.permission"), saved ? "success" : "error");
    if (saved) setNote("");
  }

  return <section className="break-review-panel" aria-label={t("workflow.breakReport.reviewTitle")}>
    <strong>{status}</strong>
    {shift.actualBreak.exceptionReason && <p>{shift.actualBreak.exceptionReason}</p>}
    {allowActions && shift.reviewState === "pending" && <>
      <p className="muted-copy">{t("workflow.breakReport.reviewHint")}</p>
      <label className="field-label"><span>{t("workflow.breakReport.reviewNote")}</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} required /></label>
      <div className="form-actions"><button type="button" className="button button--outline button--small" disabled={!note.trim()} onClick={() => submit("approve")}>{t("workflow.breakReport.approveReview")}</button><button type="button" className="button button--quiet button--small" disabled={!note.trim()} onClick={() => submit("return")}>{t("workflow.breakReport.returnReview")}</button></div>
    </>}
  </section>;
}
