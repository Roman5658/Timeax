import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PortalShell } from "../../../app/PortalShell";
import { PageHeading } from "../../../components/PageHeading";
import { getActiveMember, getVisiblePayslips, issueDemoPayslip, isDemoStorageProtected, savePayrollSettings, savePersonalPayrollSettings, useDemoWorkspace } from "../../workflows/demo-store";
import { calculatePayroll, payrollHours, type PayrollSettings, type PayrollInput, type PayrollContext, defaultPayrollContext } from "../domain/payroll";

const defaults: PayrollSettings = { dayRate: 24, nightRate: 24, issueEnabled: false };
const fields = ["dayHours", "nightHours", "dayRate", "nightRate", "additions", "deductions"] as const;
export function PayrollPage({ role }: { role: "worker" | "agency" }) {
  const { t, i18n } = useTranslation();
  const workspace = useDemoWorkspace();
  const actor = getActiveMember(workspace);
  const workers = workspace.members.filter((member) => member.role === "worker" && (role === "agency"
    ? member.organizationId === actor.organizationId : (member.accountUid ?? member.id) === (actor.accountUid ?? actor.id)));
  const [selectedId, setSelectedId] = useState("");
  const workerId = workers.some((worker) => worker.id === selectedId) ? selectedId : workers[0]?.id ?? "";
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const config = (role === "agency" ? workspace.payrollSettings?.[actor.organizationId] : workspace.personalPayrollSettings?.[workerId]) ?? defaults;
  const [settings, setSettings] = useState(config);
  const [context, setContext] = useState<PayrollContext>(config.context ?? defaultPayrollContext);
  const [basis, setBasis] = useState<"net" | "gross">(config.rateBasis ?? "net");
  const [message, setMessage] = useState("");
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState<Record<Exclude<keyof PayrollInput, "note" | "context">, string> & { note: string }>({ dayHours: "0", nightHours: "0", dayRate: "24", nightRate: "24", additions: "0", deductions: "0", note: "" });
  const facts = payrollHours(workspace, workerId, month);
  useEffect(() => {
    const rates = config;
    const hours = payrollHours(workspace, workerId, month);
    setInput({ dayHours: hours.dayHours.toFixed(4), nightHours: hours.nightHours.toFixed(4), dayRate: String(rates.dayRate), nightRate: String(rates.nightRate), additions: "0", deductions: "0", note: "" });
    setMessage(""); setChecked(false); setContext(config.context ?? defaultPayrollContext); setBasis(config.rateBasis ?? "net");
    // Change scope only; live demo updates must not overwrite an unsaved calculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId, month, actor.id, role]);
  useEffect(() => { setSettings(config); }, [actor.id, config.dayRate, config.nightRate, config.issueEnabled]);
  const number = (key: typeof fields[number]) => input[key].trim() === "" ? NaN : Number(input[key]);
  const value: PayrollInput = { dayHours: number("dayHours"), nightHours: number("nightHours"), dayRate: number("dayRate"), nightRate: number("nightRate"), additions: number("additions"), deductions: number("deductions"), note: input.note, context };
  const result = calculatePayroll(value);
  const money = (amount: number) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "PLN" }).format(amount);
  const slips = getVisiblePayslips(workspace).filter((slip) => role === "worker" || (slip.workerId === workerId && slip.month === month));
  const blocked = isDemoStorageProtected();
  if (actor.role !== role) return <Navigate to={actor.role === "factory-admin" ? "/factory" : `/${actor.role}`} replace />;
  function update(key: keyof PayrollInput, text: string) { setInput((current) => ({ ...current, [key]: text })); setChecked(false); setMessage(""); }
  return <PortalShell role={role}>
    <PageHeading eyebrow={t("payroll.demo")} title={t(role === "agency" ? "payroll.agencyTitle" : "payroll.workerTitle")} description={t("payroll.disclaimer")} />
    {blocked && <p role="alert" className="notice-box notice-box--warm">{t("settings.demoStorageProtected")}</p>}
    {role === "agency" && <details className="dashboard-panel"><summary>{t("payroll.settings")}</summary><form className="workflow-form" onSubmit={(event) => { event.preventDefault(); const saved = savePayrollSettings({ ...settings, context }); setMessage(t(saved ? "payroll.saved" : "payroll.failed")); }}>
      {(["dayRate", "nightRate"] as const).map((key) => <label className="field-label" key={key}><span>{t(`payroll.${key}`)}</span><input type="number" min="0" max="10000" step="0.01" required value={Number.isFinite(settings[key]) ? settings[key] : ""} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value === "" ? NaN : Number(event.target.value) }))} /></label>)}
      <label className="checkbox-field field-label--wide"><input type="checkbox" checked={settings.issueEnabled} onChange={(event) => setSettings((current) => ({ ...current, issueEnabled: event.target.checked }))} /><span>{t("payroll.issueEnabled")}</span></label>
      <p className="muted-copy field-label--wide">{t("payroll.settingsHint")}</p><button className="button button--primary" disabled={blocked} type="submit">{t("common.save")}</button>
    </form></details>}
    <section className="dashboard-panel"><div className="workflow-form">
      <label className="field-label"><span>{t("workflow.fields.worker")}</span><select value={workerId} onChange={(event) => setSelectedId(event.target.value)} disabled={!workers.length}>{!workers.length && <option value="">{t("payroll.noWorkers")}</option>}{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {workspace.organizations.find((org) => org.id === worker.organizationId)?.name}</option>)}</select></label>
      <label className="field-label"><span>{t("exports.periodMonth")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label>
    </div></section>
    <section className="dashboard-panel"><h2>{t("payroll.calculation")}</h2><p>{t("payroll.hoursHint", { count: facts.count })}</p><p className="muted-copy">{t("payroll.nightHint")}</p>
      {facts.attention > 0 && <p className="notice-box notice-box--warm">{t("payroll.attention", { total: facts.attention })}</p>}
      <details className="payroll-context"><summary>{t("payroll.contractSettings")}</summary><p>{t("payroll.contextWarning")}</p><div className="workflow-form"><label className="field-label"><span>{t("payroll.contract")}</span><select value={context.contract} onChange={(event) => { setContext((current) => ({ ...current, contract: event.target.value as PayrollContext["contract"] })); setChecked(false); }}>{["unknown", "employment", "mandate", "specific", "b2b"].map((choice) => <option key={choice} value={choice}>{t(`payroll.contractOptions.${choice}`)}</option>)}</select></label>{(["under26", "student", "ppk", "otherInsurance", "sickness", "taxResident"] as const).map((key) => <label className="field-label" key={key}><span>{t(`payroll.${key}`)}</span><select value={context[key]} onChange={(event) => { setContext((current) => ({ ...current, [key]: event.target.value })); setChecked(false); }}>{["unknown", "yes", "no"].map((choice) => <option key={choice} value={choice}>{t(`payroll.answers.${choice}`)}</option>)}</select></label>)}</div></details>
      <div className="workflow-form">
        {role === "worker" && <label className="field-label field-label--wide"><span>{t("payroll.basis")}</span><select value={basis} onChange={(event) => setBasis(event.target.value as "gross" | "net")}><option value="net">{t("payroll.net")}</option><option value="gross">{t("payroll.gross")}</option></select></label>}
        {fields.map((key) => <label className="field-label" key={key}><span>{t(`payroll.${key}`)}</span><input type="number" min="0" max={key.endsWith("Hours") ? 744 : key.endsWith("Rate") ? 10000 : 10000000} step={key.endsWith("Hours") ? "0.0001" : "0.01"} value={input[key]} onChange={(event) => update(key, event.target.value)} required /></label>)}
        <button className="button button--outline field-label--wide" type="button" disabled={!workerId || !month} onClick={() => { setInput((current) => ({ ...current, dayHours: facts.dayHours.toFixed(4), nightHours: facts.nightHours.toFixed(4) })); setChecked(false); }}>{t("payroll.useHours")}</button>
        <label className="field-label field-label--wide"><span>{t("payroll.note")}</span><textarea rows={3} maxLength={500} value={input.note} onChange={(event) => update("note", event.target.value)} placeholder={t("payroll.noteHint")} /></label>
      </div>
      {!result ? <p role="alert" className="notice-box notice-box--warm">{t("payroll.invalid")}</p> : <div className="payroll-totals"><div className="payroll-total"><span>{t(role === "agency" ? "payroll.gross" : "payroll.beforeDeductions")}</span><strong>{money(result.gross)}</strong></div><div className="payroll-total"><span>{t(role === "agency" ? "payroll.net" : basis === "net" ? "payroll.estimateNet" : "payroll.estimateGross")}</span><strong>{money(result.net)}</strong></div></div>}
      <p className="muted-copy">{t("payroll.formula")}</p><p>{t("payroll.separation")}</p>
      {role === "worker" && <button className="button button--outline" type="button" disabled={!result || !workerId || blocked} onClick={() => setMessage(t(savePersonalPayrollSettings(workerId, { dayRate: value.dayRate, nightRate: value.nightRate, issueEnabled: false, rateBasis: basis, context }) ? "payroll.saved" : "payroll.failed"))}>{t("payroll.savePersonal")}</button>}
      {role === "agency" && <div className="payroll-issue"><p>{t("payroll.issuancePolicy")}</p><p>{t(config.issueEnabled ? "payroll.deliveryHint" : "payroll.deliveryOff")}</p><label className="checkbox-field"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>{t("payroll.checked")}</span></label>{!value.note.trim() && <p className="muted-copy">{t("payroll.noteHint")}</p>}<button className="button button--primary" type="button" disabled={!result || !checked || !config.issueEnabled || !workerId || !month || !value.note.trim() || blocked || slips.length > 0} onClick={() => { const saved = issueDemoPayslip(workerId, month, value); setMessage(t(saved ? "payroll.issued" : "payroll.failed")); setChecked(false); }}>{t("payroll.issue")}</button>{slips.length > 0 && <p>{t("payroll.alreadyIssued")}</p>}</div>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className="dashboard-panel"><h2>{t("payroll.slips")}</h2>{!slips.length && <p className="muted-copy">{t(role === "worker" ? "payroll.noReceivedSlips" : "payroll.noSlips")}</p>}{slips.map((slip) => <article className="payroll-slip" key={slip.id}><p className="eyebrow">{t("payroll.demo")}</p><h3>{slip.workerName} · {slip.month}</h3><p>{slip.organizationName} · {new Date(slip.issuedAt).toLocaleDateString(i18n.language)}</p><dl>{fields.map((key) => <div key={key}><dt>{t(`payroll.${key}`)}</dt><dd>{slip.input[key]}</dd></div>)}<div><dt>{t("payroll.gross")}</dt><dd>{money(slip.gross)}</dd></div><div><dt>{t("payroll.net")}</dt><dd>{money(slip.net)}</dd></div></dl><p>{slip.input.note}</p>{slip.input.context && <div><p>{t("payroll.contract")}: {t(`payroll.contractOptions.${slip.input.context.contract}`)}</p>{(["under26", "student", "ppk", "otherInsurance", "sickness", "taxResident"] as const).map((key) => <p key={key}>{t(`payroll.${key}`)}: {t(`payroll.answers.${slip.input.context![key]}`)}</p>)}</div>}<p className="muted-copy">{t("payroll.disclaimer")}</p></article>)}</section>
  </PortalShell>;
}
