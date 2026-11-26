import {Link} from 'react-router-dom';
import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {loadWorkspaceAccess,type WorkspaceResult} from './workspace-access';
export function WorkspaceReadPage({organizationId,revision}:{organizationId:string;revision:number}){
 const {t}=useTranslation(),tx=(key:string)=>t('workspaceRead.'+key);
 const [state,setState]=useState<WorkspaceResult>({state:'unavailable'}),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const c=new AbortController();setBusy(true);setState({state:'unavailable'});
  void loadWorkspaceAccess(organizationId,location.origin,window.fetch.bind(window),c.signal).then(value=>{if(!c.signal.aborted){setState(value);setBusy(false)}});
  return()=>c.abort();
 },[organizationId,revision,refresh]);
 return <section aria-label={tx('title')}><h1>{tx('title')}</h1>
 {busy?<p role="status">{tx('checking')}</p>:state.state==='ready'?<>
  <h2>{tx(state.value.organization.kind)}</h2><p>{tx('role')}: {tx(state.value.membership.role)}</p>
  <h3>{tx('worksites')}</h3>{state.value.worksites.length?<ul>{state.value.worksites.map(site=><li key={site.id}>{site.name}</li>)}</ul>:<p>{tx(state.value.membership.role==='accountant'?'accountantEmpty':'empty')}</p>}
  <p className="muted-copy">{tx('readOnly')}</p>{state.value.organization.kind==='agency'&&['worker','agency_admin','accountant'].includes(state.value.membership.role)&&<Link to={'/workspace/'+organizationId+'/payslips'}>{t('canonicalPayslips.title')}</Link>}{['worker','agency_admin','factory_admin','team_leader'].includes(state.value.membership.role)&&<Link to={'/workspace/'+organizationId+'/factory-timecards'}>{t('factoryHours.title')}</Link>}{state.value.organization.kind==='agency'&&['worker','agency_admin'].includes(state.value.membership.role)&&<Link to={'/workspace/'+organizationId+'/timecards'}>{t('timecards.title')}</Link>}
 </>:<p role="status">{tx(state.state)}</p>}
 <button type="button" className="button button--outline button--full" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>{tx('refresh')}</button>
 </section>;
}
