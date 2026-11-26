import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
export function AgencyTimesheetNav({active}:{active:"internal"|"factory"}){
 const {t}=useTranslation();return <nav className="factory-links" aria-label={t("agencyArchive.title")}>
 <Link aria-current={active==="internal"?"page":undefined} to="/agency/workers#timesheets">{t("agencyArchive.internal")}</Link>{" / "}
 <Link aria-current={active==="factory"?"page":undefined} to="/agency/monthly-timesheets">{t("agencyArchive.factory")}</Link>{" / "}<Link to="/agency/payroll">{t("localPayslip.title")}</Link></nav>;
}
