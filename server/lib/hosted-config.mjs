import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {INTEGRATED_PROFILE,INTEGRATED_LANES,integratedEnabled} from './integrated.contract.mjs';
import {WORKSPACE_PROFILE} from './workspace-read.contract.mjs';
export const targetNode=version=>{if(typeof version!=='string'||!/^24\.\d+\.\d+$/.test(version))return false;const [major,minor,patch]=version.split('.').map(Number);return major===24&&(minor>22||minor===22&&patch>=3)};
export function requireTargetNode(version=process.versions.node){if(!targetNode(version))throw Error('Target runtime requires Node >=24.22.3 <25')}
export async function verifyRuntimeManifest(root){
 const text=await readFile(path.join(root,'runtime-manifest.json'),'utf8'),v=JSON.parse(text);
 if(!['agency-pending-single-process-v1',WORKSPACE_PROFILE,INTEGRATED_PROFILE].includes(v.profile)||!Array.isArray(v.files)||!v.files.length)throw Error('Runtime manifest missing');
 const seen=new Set();
 for(const f of v.files){
  if(typeof f.path!=='string'||!f.path||f.path.includes('..')||f.path.includes('\\')||f.path.includes(':')||f.path.startsWith('/')||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256??''))throw Error('Runtime manifest invalid');
  seen.add(f.path);const actual=createHash('sha256').update(await readFile(path.join(root,f.path))).digest('hex');if(actual!==f.sha256)throw Error('Runtime bytes differ');
 }
 if(!seen.has('public/index.html')||!seen.has('hosted-start.server.mjs')||!seen.has('lib/runtime.mjs'))throw Error('Runtime manifest incomplete');
 return {sha256:createHash('sha256').update(text).digest('hex'),builtWith:v.builtWith,profile:v.profile};
}
export async function loadHostedConfiguration({root,configPath,version=process.versions.node}){
 if(!configPath)return {mode:'closed',origin:'https://staging.invalid'};
 const c=JSON.parse(await readFile(configPath,'utf8'));
 if(c.mode==='closed')return c;
 if(c.mode!=='configured')throw Error('Unknown runtime mode');
 requireTargetNode(version);
 if(!['agency-pending-single-process-v1',WORKSPACE_PROFILE,INTEGRATED_PROFILE].includes(c.hostedProfile?.id)||c.hostedProfile.instances!==1||typeof c.deploymentApprovalPath!=='string')throw Error('Closed hosted profile required');
 const build=await verifyRuntimeManifest(root);requireTargetNode(build.builtWith);
 if(build.profile!==c.hostedProfile.id)throw Error('Build profile differs');
 if((c.workspace!==undefined)!==([WORKSPACE_PROFILE,INTEGRATED_PROFILE].includes(c.hostedProfile.id))||c.workspace!==undefined&&(c.workspace?.mode!=='reviewed-readonly-v1'||Object.keys(c.workspace).length!==1))throw Error('Workspace profile denied');
 c.buildSha256=build.sha256;
 const contractRaw=await readFile(c.contractFile,'utf8');c.contract=JSON.parse(contractRaw);c.contractSha256=createHash('sha256').update(contractRaw).digest('hex');
 const operations=integratedEnabled(c);
 c.approvalPublicKeyPem=await readFile(c.approvalPublicKeyFile,'utf8');
 const names=['webPassword','hookPassword','pendingPassword','dbCA','intentKey','routeKey','webhookSecret',...(c.workspace?['workspacePassword']:[]),...(operations?INTEGRATED_LANES.map(l=>l.id+'Password'):[]),...(c.owner!==undefined?['ownerPassword']:[]),...(c.team!==undefined?['teamPassword']:[])];
 if(!c.secretFiles||names.some(k=>typeof c.secretFiles[k]!=='string'))throw Error('Explicit secret mounts required');
 c.secrets={};for(const name of names)c.secrets[name]=(await readFile(c.secretFiles[name],'utf8')).trim();
 return c;
}
