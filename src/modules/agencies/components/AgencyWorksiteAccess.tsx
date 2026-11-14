import { useState, type FormEvent } from "react";
import { Copy, Link2, Search, Send, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/ToastProvider";
import { createFactoryInvitation, createProduction, getFactoryInvitationUrl, requestAgencyWorksiteConnection, revokeFactoryInvitation, searchRegisteredCentralsByIdentifier, searchRegisteredCentralsByNip, useDemoWorkspace } from "../../workflows/demo-store";
import type { DemoCentralSearchResult } from "../../workflows/domain/demo-types";

export function AgencyWorksiteAccess({ showConnectionStatus = true }: { showConnectionStatus?: boolean }) {
  const workspace = useDemoWorkspace();
  const { t } = useTranslation();
  const toast = useToast();
  const [searchKind, setSearchKind] = useState<"nip" | "identifier">("nip");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<DemoCentralSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [selectedWorksiteId, setSelectedWorksiteId] = useState("");
  const [requestNewWorksite, setRequestNewWorksite] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [nip, setNip] = useState("");
  const [city, setCity] = useState("");
  const [representativeEmail, setRepresentativeEmail] = useState("");
  const [worksiteName, setWorksiteName] = useState("");
  const [address, setAddress] = useState("");
  const [productionName, setProductionName] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [status, setStatus] = useState("");
  const organizationId = workspace.organization.id;
  const invitations = (workspace.factoryInvitations ?? []).filter((item) => item.organizationId === organizationId && item.state === "pending");
  const requests = (workspace.worksiteConnectionRequests ?? []).filter((item) => item.organizationId === organizationId && item.state === "pending" && (item.direction ?? "agency-request") === "agency-request");
  const connections = (workspace.agencyWorksites ?? []).filter((item) => item.organizationId === organizationId && item.state === "active");
  const selectedEntity = searchResults.find((item) => item.businessEntityId === selectedEntityId);
  const selectedWorksite = selectedEntity?.worksites.find((item) => item.id === selectedWorksiteId);
  const showNewCentralInvite = searched && searchKind === "nip" && searchValue.replace(/\D/g, "").length === 10 && searchResults.length === 0;

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("workflow.factoryAccess.linkCopied"), "success");
    } catch {
      setStatus(t("workflow.factoryAccess.copyManually"));
    }
  }

  function searchCentrals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setInvitationUrl("");
    setSelectedEntityId("");
    setSelectedWorksiteId("");
    setRequestNewWorksite(false);
    setCompanyName("");
    setNip("");
    setCity("");
    setWorksiteName("");
    setAddress("");
    const results = searchKind === "nip" ? searchRegisteredCentralsByNip(searchValue) : searchRegisteredCentralsByIdentifier(searchValue);
    setSearchResults(results);
    setSearched(true);
    if (searchKind === "nip" && searchValue.replace(/\D/g, "").length !== 10) setStatus(t("workflow.factoryAccess.searchNipHint"));
    else if (results.length === 0) setStatus(t("workflow.factoryAccess.noSearchResults"));
  }

  function requestConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntity) return;
    setStatus("");
    const result = requestAgencyWorksiteConnection({
      businessEntityId: selectedEntity.businessEntityId,
      worksiteId: requestNewWorksite ? undefined : selectedWorksiteId || undefined,
      worksiteName: requestNewWorksite ? worksiteName : selectedWorksite?.name,
      address: requestNewWorksite ? address : selectedWorksite?.address,
      productionName,
    });
    if (result.kind === "invalid") {
      setStatus(t(result.reason === "invalid-nip" ? "workflow.factoryAccess.invalidNip" : "workflow.factoryAccess.requiredFields"));
      return;
    }
    if (result.kind === "connected") {
      const production = createProduction(productionName, "", "", result.worksite.id);
      setStatus(t(production ? "workflow.factoryAccess.alreadyConnected" : "workflow.factoryAccess.productionUnavailable"));
      return;
    }
    if (result.kind === "invited") {
      setStatus(t("workflow.factoryAccess.alreadyInvitedByFactory"));
      return;
    }
    setStatus(t("workflow.factoryAccess.requestPending", { company: result.businessEntity.name }));
  }

  function inviteNewCentral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setInvitationUrl("");
    const result = createFactoryInvitation({ email: representativeEmail, companyName, nip, city, worksiteName, worksiteAddress: address, productionName });
    if (!result) {
      setStatus(t("workflow.factoryAccess.invitationCouldNotCreate"));
      return;
    }
    setInvitationUrl(result.url);
    setStatus(t("workflow.factoryAccess.invitationReady", { company: result.invitation.companyName }));
  }

  function chooseCentral(result: DemoCentralSearchResult) {
    setSelectedEntityId(result.businessEntityId);
    setSelectedWorksiteId(result.matchedWorksiteId ?? "");
    setRequestNewWorksite(false);
    setCompanyName(result.name);
    setNip(result.nip ?? "");
    setCity(result.city ?? "");
    setStatus("");
  }

  return <section className="dashboard-panel agency-worksite-access" id="agency-worksite-access">
    <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factoryAccess.eyebrow")}</span><h2>{t("workflow.factoryAccess.title")}</h2></div><Link2 size={18} /></div>
    <p className="muted-copy">{t("workflow.factoryAccess.description")}</p>
    <form className="workflow-form" onSubmit={searchCentrals}>
      <label className="field-label"><span>{t("workflow.factoryAccess.searchBy")}</span><select value={searchKind} onChange={(event) => { setSearchKind(event.target.value as typeof searchKind); setSearchResults([]); setSearched(false); setSelectedEntityId(""); }}><option value="nip">{t("workflow.factoryAccess.nip")}</option><option value="identifier">{t("workflow.factoryAccess.centralIdentifier")}</option></select></label>
      <label className="field-label"><span>{t(searchKind === "nip" ? "workflow.factoryAccess.nip" : "workflow.factoryAccess.centralIdentifier")}</span><input autoComplete="off" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} required /></label>
      <button className="button button--primary button--small" type="submit"><Search size={15} />{t("workflow.factoryAccess.search")}</button>
    </form>
    {searchResults.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factoryAccess.searchResults")}</h3>{searchResults.map((result) => <article className="employment-history-row" key={result.businessEntityId}>
      <strong>{result.name} · {result.city ?? "—"}</strong>
      <span>{t("workflow.factoryAccess.nip")}: {result.nip ?? "—"} · {t("workflow.factoryAccess.centralIdentifier")}: {result.identifier ?? "—"}</span>
      <div className="agency-access-list">{result.worksites.map((worksite) => <small key={worksite.id}>{worksite.name} · {worksite.address ?? "—"} · {t("workflow.factoryAccess.identifier")}: {worksite.identifier ?? "—"}</small>)}</div>
      <button className="button button--outline button--small" type="button" onClick={() => chooseCentral(result)}>{t("workflow.factoryAccess.selectCentral")}</button>
    </article>)}</div>}
    {selectedEntity && <form className="workflow-form agency-worksite-request-form" onSubmit={requestConnection}>
      <label className="field-label"><span>{t("workflow.factoryAccess.selectWorksite")}</span><select value={requestNewWorksite ? "__new__" : selectedWorksiteId} onChange={(event) => { const value = event.target.value; setRequestNewWorksite(value === "__new__"); setSelectedWorksiteId(value === "__new__" ? "" : value); if (value === "__new__") { setWorksiteName(""); setAddress(""); } }} required>
        <option value="">{t("workflow.factoryAccess.chooseWorksite")}</option>
        {selectedEntity.worksites.map((worksite) => <option key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.address ?? "—"} · {worksite.identifier ?? "—"}</option>)}
        <option value="__new__">{t("workflow.factoryAccess.requestNewWorksite")}</option>
      </select></label>
      {requestNewWorksite && <>
        <label className="field-label"><span>{t("workflow.factoryAccess.worksiteName")}</span><input value={worksiteName} onChange={(event) => setWorksiteName(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.factoryAccess.address")}</span><input value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
      </>}
      <div className="notice-box field-label--wide agency-connection-review"><strong>{selectedEntity.name} · {selectedEntity.city ?? "—"}</strong><span>{t("workflow.factoryAccess.nip")}: {selectedEntity.nip ?? "—"} · {t("workflow.factoryAccess.centralIdentifier")}: {selectedEntity.identifier ?? "—"}</span><span>{requestNewWorksite ? worksiteName || t("workflow.factoryAccess.worksiteName") : selectedWorksite?.name ?? "—"} · {requestNewWorksite ? address || t("workflow.factoryAccess.address") : selectedWorksite?.address ?? "—"}</span><span>{t("workflow.factoryAccess.identifier")}: {requestNewWorksite ? t("workflow.factoryAccess.identifierAssignedAfterApproval") : selectedWorksite?.identifier ?? "—"}</span></div>
      <label className="field-label field-label--wide"><span>{t("workflow.factoryAccess.productionName")}</span><input value={productionName} onChange={(event) => setProductionName(event.target.value)} required /><small className="muted-copy">{t("workflow.factoryAccess.productionNameHelp")}</small></label>
      <button className="button button--primary button--small field-label--wide" type="submit"><Send size={15} />{t("workflow.factoryAccess.sendRequest")}</button>
    </form>}
    {showNewCentralInvite && <form className="workflow-form agency-worksite-request-form" onSubmit={inviteNewCentral}>
      <h3 className="field-label--wide">{t("workflow.factoryAccess.inviteNewCentral")}</h3>
      <p className="muted-copy field-label--wide">{t("workflow.factoryAccess.inviteNewCentralLead")}</p>
      <label className="field-label"><span>{t("workflow.factoryAccess.companyName")}</span><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.factoryAccess.nip")}</span><input inputMode="numeric" autoComplete="off" value={nip || searchValue} onChange={(event) => setNip(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.factoryAccess.city")}</span><input value={city} onChange={(event) => setCity(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.factoryAccess.representativeEmail")}</span><input type="email" value={representativeEmail} onChange={(event) => setRepresentativeEmail(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.factoryAccess.worksiteName")}</span><input value={worksiteName} onChange={(event) => setWorksiteName(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.factoryAccess.address")}</span><input value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
      <label className="field-label field-label--wide"><span>{t("workflow.factoryAccess.productionName")}</span><input value={productionName} onChange={(event) => setProductionName(event.target.value)} required /></label>
      <button className="button button--primary button--small field-label--wide" type="submit"><Send size={15} />{t("workflow.factoryAccess.createInvitation")}</button>
    </form>}
    {status && <p className="inline-notice" role="status">{status}</p>}
    {invitationUrl && <div className="notice-box agency-invitation-link"><span>{invitationUrl}</span><button className="button button--outline button--small" type="button" onClick={() => void copyLink(invitationUrl)}><Copy size={14} />{t("workflow.factoryAccess.copyLink")}</button></div>}
    {invitations.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factoryAccess.pendingInvitations")}</h3>{invitations.map((item) => <article className="employment-history-row" key={item.id}><strong>{item.companyName}</strong><span>{item.worksiteName} · {item.worksiteAddress}</span><small>{t("workflow.factoryAccess.expires", { date: new Date(item.expiresAt).toLocaleDateString() })}</small><div className="form-actions"><button className="button button--quiet button--small" type="button" onClick={() => void copyLink(getFactoryInvitationUrl(item.token))}><Copy size={14} />{t("workflow.factoryAccess.copyLink")}</button><button className="button button--quiet button--small" type="button" onClick={() => setStatus(revokeFactoryInvitation(item.id) ? t("workflow.factoryAccess.invitationRevoked") : t("workflow.errors.permission"))}><XCircle size={14} />{t("workflow.factoryAccess.revoke")}</button></div></article>)}</div>}
    {showConnectionStatus && requests.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factoryAccess.pendingRequests")}</h3>{requests.map((item) => <article className="employment-history-row" key={item.id}><strong>{item.requestedWorksiteName}</strong><span>{workspace.businessEntities?.find((entity) => entity.id === item.businessEntityId)?.name} · {item.requestedAddress} · {item.productionName}</span><small>{t("workflow.factoryAccess.waitingForApproval")}</small></article>)}</div>}
    {showConnectionStatus && connections.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factoryAccess.connectedSites")}</h3>{connections.map((connection) => {
      const site = workspace.worksites?.find((item) => item.id === connection.worksiteId);
      const entity = workspace.businessEntities?.find((item) => item.id === connection.businessEntityId);
      return <article className="employment-history-row" key={connection.id}><strong>{entity?.name} · {entity?.city}</strong><span>{site?.name ?? connection.worksiteId} · {site?.address}</span></article>;
    })}</div>}
    <p className="policy-note">{t("workflow.factoryAccess.demoMailNotice")}</p>
  </section>;
}
