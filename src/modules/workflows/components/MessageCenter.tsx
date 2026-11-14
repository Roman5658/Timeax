import { useEffect, useState, type FormEvent } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../../../app/ToastProvider";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { createAgencyMessage, createFactoryWorkerMessage, getActiveMember, getLeaderAccessibleWorkers, getProductionWorkers, getWorkerProductionAssignment, getWorkerProductionAssignments, markMessageThreadRead, replyToMessage, createWorkerMessage, useDemoWorkspace } from "../demo-store";
import { todayLocalDate } from "../workflow-utils";
import { RightDrawer } from "./RightDrawer";

export function MessageCenter() {
  const { t } = useTranslation();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const workerAssignments = member.role === "worker" ? getWorkerProductionAssignments(workspace, member.id) : [];
  const hasAgencyRecipient = workspace.members.some((item) => item.organizationId === workspace.organization.id && item.role === "agency");
  const ownedWorkers = workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "worker" && item.workerCategory === "factory"
    && workspace.employmentPeriods.some((period) => period.organizationId === item.organizationId && period.workerId === item.id && period.state === "active"));
  const [recipientType, setRecipientType] = useState<"agency" | "leader" | "production">(hasAgencyRecipient ? "agency" : "production");
  const [factoryId, setFactoryId] = useState(workerAssignments[0]?.factoryId ?? "");
  const [factoryWorkerId, setFactoryWorkerId] = useState(ownedWorkers[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [openThreadId, setOpenThreadId] = useState("");
  const [agencyComposeOpen, setAgencyComposeOpen] = useState(false);
  const [agencyAudience, setAgencyAudience] = useState<"workers" | "production" | "group" | "leader">("workers");
  const agencyFactories = workspace.factories.filter((item) => item.organizationId === member.organizationId && !item.archivedAt);
  const [agencyFactoryId, setAgencyFactoryId] = useState(agencyFactories[0]?.id ?? "");
  const [agencyGroupId, setAgencyGroupId] = useState("");
  const [agencyWorkerIds, setAgencyWorkerIds] = useState<string[]>([]);
  const [agencyLeaderId, setAgencyLeaderId] = useState("");
  const threads = workspace.messageThreads.filter((thread) => thread.organizationId === workspace.organization.id && thread.participants.includes(member.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const focusId = searchParams.get("focus") === "message" ? searchParams.get("id") : "";
  const requestedLeaderId = searchParams.get("messageTo") ?? "";
  const currentAgencyWorkers = agencyAudience === "workers"
    ? workspace.members.filter((worker) => worker.organizationId === member.organizationId && worker.role === "worker" && worker.workerCategory !== "factory"
      && workspace.employmentPeriods.some((period) => period.organizationId === worker.organizationId && period.workerId === worker.id && period.state === "active" && period.startDate <= todayLocalDate() && (!period.endDate || period.endDate >= todayLocalDate())))
    : getProductionWorkers(workspace, agencyFactoryId).filter((worker) => agencyAudience !== "group" || Boolean(agencyGroupId && getWorkerProductionAssignment(workspace, worker.id, agencyFactoryId)?.groupId === agencyGroupId));
  const previewAgencyRecipients = agencyAudience === "workers" ? currentAgencyWorkers.filter((worker) => agencyWorkerIds.includes(worker.id))
    : agencyAudience === "leader" ? [] : currentAgencyWorkers;
  const previewUniqueRecipients = [...new Map(previewAgencyRecipients.map((worker) => [worker.accountUid ?? worker.id, worker])).values()];
  const agencyLeaders = workspace.members.filter((person) => person.organizationId === member.organizationId && person.role === "leader" && person.factoryId === agencyFactoryId
    && person.accessState !== "suspended" && person.accessState !== "revoked" && getLeaderAccessibleWorkers(workspace, person.id).some((entry) => entry.factory.id === agencyFactoryId && entry.worker.workerCategory !== "factory"));
  useTargetHighlight(focusId ? `message-${focusId}` : "", Boolean(focusId));
  useEffect(() => { if (focusId) { setPanelOpen(true); setOpenThreadId(focusId); } }, [focusId]);
  useEffect(() => { if (member.role === "agency" && requestedLeaderId) { const leader = workspace.members.find((item) => item.id === requestedLeaderId && item.role === "leader" && item.organizationId === member.organizationId); if (leader?.factoryId) setAgencyFactoryId(leader.factoryId); setAgencyAudience("leader"); setAgencyLeaderId(requestedLeaderId); setAgencyComposeOpen(true); setPanelOpen(true); } }, [member.role, member.organizationId, requestedLeaderId, workspace.members]);
  useEffect(() => { if (!hasAgencyRecipient && recipientType === "agency") setRecipientType("production"); }, [hasAgencyRecipient, recipientType]);

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (createWorkerMessage(recipientType, subject, text, factoryId)) {
      setSubject(""); setText(""); setNotice(t("workflow.messagesCenter.sent")); showToast(t("workflow.messagesCenter.sent"), "success");
    } else { setNotice(t("workflow.errors.permission")); showToast(t("workflow.errors.permission"), "error"); }
  }

  function sendFactoryMessage(event: FormEvent) {
    event.preventDefault();
    if (createFactoryWorkerMessage(factoryWorkerId, subject, text)) {
      setSubject(""); setText(""); setNotice(t("workflow.messagesCenter.sent")); showToast(t("workflow.messagesCenter.sent"), "success");
    } else { setNotice(t("workflow.errors.permission")); showToast(t("workflow.errors.permission"), "error"); }
  }

  function sendAgencyMessage(event: FormEvent) {
    event.preventDefault();
    const saved = createAgencyMessage({ audience: agencyAudience, subject, text, workerIds: agencyWorkerIds, factoryId: agencyFactoryId, groupId: agencyGroupId || undefined, leaderId: agencyLeaderId || undefined });
    if (saved) {
      setSubject(""); setText(""); setAgencyWorkerIds([]); setAgencyComposeOpen(false); setNotice(t("workflow.messagesCenter.sent")); showToast(t("workflow.messagesCenter.sent"), "success");
    } else { setNotice(t("workflow.errors.permission")); showToast(t("workflow.errors.permission"), "error"); }
  }

  function sendReply(event: FormEvent, threadId: string) {
    event.preventDefault();
    if (replyToMessage(threadId, replies[threadId] ?? "")) { setReplies((current) => ({ ...current, [threadId]: "" })); showToast(t("workflow.messagesCenter.replySent"), "success"); }
    else showToast(t("workflow.errors.permission"), "error");
  }

  return <><details className="dashboard-panel message-center-panel" id="messages-center" open={panelOpen || Boolean(focusId)} onToggle={(event) => setPanelOpen(event.currentTarget.open)}>
    <summary className="agency-collapsible-heading"><span><span className="eyebrow"><MessageCircle size={14} /> {t("workflow.messagesCenter.eyebrow")}</span><strong>{t("workflow.messagesCenter.title")}</strong></span><span className="panel-period">{threads.length}</span></summary>
    <p className="muted-copy">{t("workflow.messagesCenter.scope")}</p>
    {notice && <p className="sr-only">{notice}</p>}
    {member.role === "agency" && <button className="button button--primary button--small" type="button" onClick={() => setAgencyComposeOpen(true)}><Send size={14} />{t("workflow.messagesCenter.startConversation")}</button>}
    {member.role === "worker" && <form className="workflow-form message-compose-form" onSubmit={sendMessage}>
      <label className="field-label"><span>{t("workflow.messagesCenter.recipient")}</span><select value={recipientType} onChange={(event) => setRecipientType(event.target.value as typeof recipientType)}>{hasAgencyRecipient && <option value="agency">{t("workflow.messagesCenter.toAgency")}</option>}<option value="leader">{t("workflow.messagesCenter.toLeader")}</option><option value="production">{t("workflow.messagesCenter.toFactory")}</option></select></label>
      {recipientType !== "agency" && <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={factoryId} onChange={(event) => setFactoryId(event.target.value)} required>{workerAssignments.map((assignment) => <option key={assignment.factoryId} value={assignment.factoryId}>{workspace.factories.find((factory) => factory.id === assignment.factoryId)?.name}</option>)}</select></label>}
      <label className="field-label"><span>{t("workflow.messagesCenter.subject")}</span><input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={120} /></label>
      <label className="field-label field-label--wide"><span>{t("workflow.messagesCenter.message")}</span><textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} required /></label>
      <div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit"><Send size={14} />{t("workflow.messagesCenter.send")}</button></div>
    </form>}
    {member.role === "factory-admin" && <form className="workflow-form message-compose-form" onSubmit={sendFactoryMessage}>
      <label className="field-label"><span>{t("factorySubscription.chooseWorker")}</span><select value={factoryWorkerId} onChange={(event) => setFactoryWorkerId(event.target.value)} required>{ownedWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.messagesCenter.subject")}</span><input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={120} /></label>
      <label className="field-label field-label--wide"><span>{t("workflow.messagesCenter.message")}</span><textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} required /></label>
      <div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit" disabled={!ownedWorkers.length}><Send size={14} />{t("workflow.messagesCenter.send")}</button></div>
      {ownedWorkers.length === 0 && <p className="muted-copy">{t("factorySubscription.noFactoryWorkers")}</p>}
    </form>}
    {threads.length === 0 ? <p className="muted-copy">{t("workflow.messagesCenter.empty")}</p> : <div className="message-thread-list">{threads.map((thread) => <details className="message-thread-card" key={thread.id} id={`message-${thread.id}`} open={openThreadId === thread.id || focusId === thread.id} onToggle={(event) => { setOpenThreadId(event.currentTarget.open ? thread.id : ""); if (event.currentTarget.open) markMessageThreadRead(thread.id); }}>
      <summary><span><strong>{thread.subject}</strong>{thread.category && <span className="message-category-pill">{t(thread.category === "service-note" ? "workflow.leader.serviceNote" : "workflow.leader.complaint")}</span>}<small>{workspace.members.find((person) => person.id === thread.participants.find((id) => id !== member.id))?.name} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(thread.updatedAt))}</small></span><span className={`status-pill status-pill--${thread.state}`}>{thread.messages.some((message) => message.senderId !== member.id && !message.readByIds.includes(member.id)) ? t("workflow.messagesCenter.unread") : t("workflow.messagesCenter.open")}</span></summary>
      <div className="message-thread-body">{thread.messages.map((message) => <article className={`message-bubble${message.senderId === member.id ? " is-mine" : ""}`} key={message.id}><div><strong>{workspace.members.find((person) => person.id === message.senderId)?.name ?? message.senderId}</strong><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(message.sentAt))}</time></div><p>{message.text}</p><small>{message.readByIds.length > 1 ? t("workflow.messagesCenter.read") : t("workflow.messagesCenter.sentStatus")}</small></article>)}
        <form className="message-reply-form" onSubmit={(event) => sendReply(event, thread.id)}><input aria-label={t("workflow.messagesCenter.reply")} placeholder={t("workflow.messagesCenter.replyPlaceholder")} value={replies[thread.id] ?? ""} onChange={(event) => setReplies((current) => ({ ...current, [thread.id]: event.target.value }))} required /><button className="button button--outline button--small" type="submit"><Send size={14} />{t("workflow.messagesCenter.reply")}</button></form>
      </div>
    </details>)}</div>}
  </details>
    {member.role === "agency" && agencyComposeOpen && <RightDrawer eyebrow={t("workflow.messagesCenter.eyebrow")} title={t("workflow.messagesCenter.startConversation")} titleId="agency-message-drawer-title" onClose={() => setAgencyComposeOpen(false)} hasUnsavedChanges={Boolean(subject || text)}>
      <form className="workflow-form agency-message-compose" onSubmit={sendAgencyMessage}>
        <label className="field-label"><span>{t("workflow.messagesCenter.agencyAudience")}</span><select value={agencyAudience} onChange={(event) => { setAgencyAudience(event.target.value as typeof agencyAudience); setAgencyWorkerIds([]); setAgencyGroupId(""); setAgencyLeaderId(""); }}><option value="workers">{t("workflow.messagesCenter.selectedWorkers")}</option><option value="production">{t("workflow.messagesCenter.allProduction")}</option><option value="group">{t("workflow.messagesCenter.selectedGroup")}</option><option value="leader">{t("workflow.messagesCenter.toLeader")}</option></select></label>
        {agencyAudience !== "workers" && <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={agencyFactoryId} onChange={(event) => { setAgencyFactoryId(event.target.value); setAgencyGroupId(""); setAgencyLeaderId(""); }} required><option value="">{t("common.select")}</option>{agencyFactories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label>}
        {agencyAudience === "group" && <label className="field-label"><span>{t("workflow.groups.title")}</span><select value={agencyGroupId} onChange={(event) => setAgencyGroupId(event.target.value)} required><option value="">{t("common.select")}</option>{workspace.groups.filter((group) => group.organizationId === member.organizationId && group.factoryId === agencyFactoryId && !group.archivedAt).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        {agencyAudience === "leader" && <label className="field-label"><span>{t("workflow.messagesCenter.manager")}</span><select value={agencyLeaderId} onChange={(event) => setAgencyLeaderId(event.target.value)} required><option value="">{t("common.select")}</option>{agencyLeaders.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}</select></label>}
        {agencyAudience === "workers" && <fieldset className="agency-message-recipient-list"><legend>{t("workflow.messagesCenter.recipient")}</legend>{currentAgencyWorkers.length === 0 ? <p className="muted-copy">{t("workflow.messagesCenter.noRecipients")}</p> : currentAgencyWorkers.map((worker) => <label className="checkbox-field" key={worker.id}><input type="checkbox" checked={agencyWorkerIds.includes(worker.id)} onChange={() => setAgencyWorkerIds((current) => current.includes(worker.id) ? current.filter((id) => id !== worker.id) : [...current, worker.id])} /><span>{worker.name}</span></label>)}</fieldset>}
        <section className="agency-message-preview"><strong>{t("workflow.messagesCenter.recipientPreview")}</strong>{agencyAudience === "leader" ? <p>{agencyLeaders.find((leader) => leader.id === agencyLeaderId)?.name ?? t("workflow.messagesCenter.noRecipients")}</p> : previewUniqueRecipients.length ? <p>{previewUniqueRecipients.map((worker) => worker.name).join(", ")}</p> : <p>{t("workflow.messagesCenter.noRecipients")}</p>}</section>
        <label className="field-label"><span>{t("workflow.messagesCenter.subject")}</span><input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={120} /></label>
        <label className="field-label"><span>{t("workflow.messagesCenter.message")}</span><textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} required /></label>
        <button className="button button--primary" type="submit" disabled={agencyAudience === "leader" ? !agencyLeaders.some((leader) => leader.id === agencyLeaderId) : previewUniqueRecipients.length === 0}><Send size={14} />{t("workflow.messagesCenter.send")}</button>
      </form>
    </RightDrawer>}
  </>;
}
