import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getActiveMember, setActiveMember, useDemoWorkspace } from "../demo-store";

const roleRoute = { worker: "/worker", leader: "/leader", agency: "/agency", "factory-admin": "/factory" } as const;

export function DemoRoleSwitcher() {
  const workspace = useDemoWorkspace();
  const active = getActiveMember(workspace);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const members = workspace.members;
  return (
    <label className="demo-role-switcher">
      <span>{t("workflow.demoAs")}</span>
      <select aria-label={t("workflow.switchRole")} value={active.id} onChange={(event) => {
        const next = members.find((member) => member.id === event.target.value);
        if (!next) return;
        setActiveMember(next.id);
        navigate(roleRoute[next.role]);
      }}>
        {(["worker", "agency", "leader", "factory-admin"] as const).map((role) => (
          <optgroup key={role} label={t(`workflow.role.${role}`)}>
            {members.filter((member) => member.role === role).map((member) => {
              const organization = workspace.organizations.find((item) => item.id === member.organizationId);
              return <option key={member.id} value={member.id}>{member.name} · {organization?.name ?? member.organizationId}</option>;
            })}
          </optgroup>
        ))}
      </select>
      <small>{t("workflow.demoSecurityNote")}</small>
    </label>
  );
}
