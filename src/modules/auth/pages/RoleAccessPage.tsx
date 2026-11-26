import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RegistrationFrame } from "../../../components/PublicExperience";
import "../../../styles/agency-registration.css";
import { isLocalWorkerJoin } from "../registration/worker-agency-request";
import { WorkerAgencyRequestPanel } from "./WorkerAgencyRequestPanel";

export function RoleAccessPage({ role }: { role: "factory" | "worker" }) {
  const { t } = useTranslation();
  const factory = role === "factory";
  const workerJoin = !factory && isLocalWorkerJoin(import.meta.env.MODE, window.location.origin);
  return <RegistrationFrame title={t(factory ? "roleEntry.factoryTitle" : "roleEntry.workerTitle")} lead={t("publicExperience."+role+"Path")}>
      {!factory&&<p className="muted-copy">{t("publicExperience.codePurpose")}</p>}
      {!workerJoin && <p className="notice-box notice-box--warm" role="status">{t(factory ? "roleEntry.factoryClosed" : "roleEntry.workerClosed")}</p>}
      {factory ? <button className="button button--primary button--full" type="button" disabled>{t("roleEntry.factorySubmit")}</button>
        : <div className="auth-form">
          <button className="button button--outline button--full" type="button" disabled>{t("roleEntry.useInvitation")}</button>
          {!workerJoin && <button className="button button--outline button--full" type="button" disabled>{t("roleEntry.requestAgency")}</button>}
        </div>}
      {workerJoin && <WorkerAgencyRequestPanel />}
      <p className="muted-copy">{t("roleEntry.noGrant")}</p>
      <Link className="button button--outline button--full" to={factory ? "/login/factory" : "/login/worker"}>{t("roleEntry.existingAccount")}</Link>
  </RegistrationFrame>;
}
