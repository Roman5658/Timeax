import { useState, type FormEvent } from "react";
import { Archive, Check, Plus, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/ToastProvider";
import { getActiveMember, getLeaderProductionWorkers, getWorkerProductionAssignment, useDemoWorkspace, archiveGroup, assignWorkerToGroup, createGroup, renameGroup } from "../demo-store";
import { WorkerProfileTrigger } from "./WorkerProfile";

export function GroupManager({ factoryId }: { factoryId: string }) {
  const { t } = useTranslation();
  const showToast = useToast();
  const workspace = useDemoWorkspace();
  const active = getActiveMember(workspace);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const groups = workspace.groups.filter((group) => group.organizationId === workspace.organization.id && group.factoryId === factoryId && group.leaderId === active.id).sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.name.localeCompare(b.name));
  const workers = active.role === "leader" ? getLeaderProductionWorkers(workspace, active.id, factoryId) : [];
  const canManage = active.role === "leader" && active.factoryId === factoryId && active.canManageGroups === true;

  function feedback(saved: boolean, successKey: string) {
    showToast(t(saved ? successKey : "workflow.errors.permission"), saved ? "success" : "error");
    return saved;
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (feedback(createGroup(factoryId, name), "workflow.groups.createdToast")) setName("");
  }

  function submitRename(event: FormEvent, groupId: string) {
    event.preventDefault();
    if (feedback(renameGroup(groupId, editingName), "workflow.groups.renamedToast")) setEditingId("");
  }

  function addSelectedWorkers(groupId: string) {
    const results = selectedWorkerIds.map((workerId) => assignWorkerToGroup(workerId, groupId));
    feedback(results.length > 0 && results.every(Boolean), "workflow.groups.workerAssignedToast");
    setSelectedWorkerIds([]);
  }

  return <div className="group-manager-launch"><button className="button button--outline button--small" type="button" onClick={() => setIsOpen(true)}><UsersRound size={15} />{t("workflow.groups.title")}<span className="panel-period">{groups.filter((group) => !group.archivedAt).length}</span></button>{isOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}><section className="dashboard-panel group-manager group-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="group-manager-title"><div className="group-manager-heading"><div><strong id="group-manager-title">{t("workflow.groups.title")}</strong><small>{t("workflow.groups.scopeNote")}</small></div><span className="panel-period">{groups.filter((group) => !group.archivedAt).length}</span><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setIsOpen(false)}>×</button></div>
    {canManage && <form className="group-create-form" onSubmit={submitCreate}><input aria-label={t("workflow.groups.name")} placeholder={t("workflow.groups.name")} value={name} onChange={(event) => setName(event.target.value)} required /><button className="button button--outline button--small" type="submit"><Plus size={14} />{t("workflow.groups.create")}</button></form>}
    <div className="group-manager-list">{groups.length === 0 && <p className="muted-copy">{t("workflow.groups.empty")}</p>}{groups.map((group) => {
      const assigned = workers.filter((worker) => getWorkerProductionAssignment(workspace, worker.id, factoryId)?.groupId === group.id);
      const unassigned = workers.filter((worker) => getWorkerProductionAssignment(workspace, worker.id, factoryId)?.groupId !== group.id);
      return <details className={`group-manager-card${group.archivedAt ? " is-archived" : ""}`} key={group.id}><summary><span><strong>{group.name}</strong><small>{t("workflow.groups.workerCount", { total: assigned.length })}</small></span>{group.archivedAt && <span className="mode-badge">{t("workflow.groups.archived")}</span>}</summary>
        {editingId === group.id && <form className="group-rename-form" onSubmit={(event) => submitRename(event, group.id)}><input aria-label={t("workflow.groups.name")} value={editingName} onChange={(event) => setEditingName(event.target.value)} required /><button type="submit" aria-label={t("common.save")}><Check size={14} /></button></form>}
        <div className="group-members-list">{assigned.map((worker) => <div className="group-member-row" key={worker.id}><span className="mini-avatar">{worker.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger>{canManage && !group.archivedAt && <button type="button" className="text-button" onClick={() => feedback(assignWorkerToGroup(worker.id, undefined, factoryId), "workflow.groups.workerRemovedToast")}>{t("workflow.groups.remove")}</button>}</div>)}{assigned.length === 0 && <p className="muted-copy">{t("workflow.groups.noWorkers")}</p>}</div>
        {canManage && !group.archivedAt && <div className="group-manager-actions">{unassigned.length > 0 && <><label className="field-label"><span>{t("workflow.groups.addWorker")}</span><small className="muted-copy">{t("workflow.groups.multiSelectHint")}</small><select multiple size={Math.min(5, unassigned.length)} value={selectedWorkerIds} onChange={(event) => setSelectedWorkerIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{unassigned.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><button type="button" className="button button--outline button--small" disabled={!selectedWorkerIds.length} onClick={() => addSelectedWorkers(group.id)}>{t("workflow.groups.addSelected")}</button></>}<button type="button" className="text-button" onClick={() => { setEditingId(group.id); setEditingName(group.name); }}>{t("workflow.groups.rename")}</button><button type="button" className="text-button" onClick={() => feedback(archiveGroup(group.id), "workflow.groups.archivedToast")}><Archive size={13} />{t("workflow.groups.archive")}</button></div>}
      </details>;
    })}</div>
  </section></div>}</div>;
}
