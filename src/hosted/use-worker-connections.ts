import {useEffect,useState} from 'react';
import {enrollmentContext,workerCall,type Membership} from './worker-enrollment';

export function useWorkerConnections(enabled:boolean,revision=0){
 const [result,setResult]=useState<{revision:number;memberships:Membership[]}>();
 useEffect(()=>{
  setResult(undefined);
  if(!enabled)return;
  const controller=new AbortController();
  void workerCall('context',undefined,controller.signal).then(enrollmentContext).then(context=>{
   if(!controller.signal.aborted)setResult({revision,memberships:context.memberships});
  }).catch(()=>{ /* Unknown is not the same as zero active connections. */ });
  return()=>controller.abort();
 },[enabled,revision]);
 return enabled&&result?.revision===revision?result.memberships:undefined;
}
