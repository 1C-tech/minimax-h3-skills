import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {basename} from 'node:path';
import {createStateStore,readServiceToken,encryptSecret,decryptSecret,fingerprint} from './lib/store.mjs';
import {inspectH3Schema,validateReferences,validateH3Input,verifyConsumerKey,uploadReference,buildNodeInfo,submitH3,queryTask,APP_ID} from './lib/runninghub.mjs';

const MAX_BODY=24*1024*1024,MAX_ACTIVE=4;
const occupiesSlot=job=>['uploading','submitting','submission_unknown','submitted','running'].includes(job.status);
const cleanJob=job=>({id:job.id,operationId:job.operationId,status:job.status,taskId:job.taskId??null,keyId:job.keyId??null,accountGroup:job.accountGroup??null,resolution:job.resolution??null,appId:APP_ID,parameters:job.input?.parameters??job.preview?.parameters??null,schemaFingerprint:job.preview?.schemaFingerprint??null,outputs:job.outputs??[],usage:job.usage??{rhCoins:null,walletAmount:null,thirdPartyAmount:null,currency:null},error:job.error??null,lastQueryError:job.lastQueryError??null,createdAt:job.createdAt,updatedAt:job.updatedAt});
const cleanKey=({secret,...safe})=>safe;
const now=()=>new Date().toISOString();
const sameJson=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

async function bodyJson(req){
  let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Error('Request body is too large.');chunks.push(chunk);}
  if(!size)return {};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Request body must be valid JSON.');}
}
function json(res,status,payload){const bytes=Buffer.from(JSON.stringify(payload));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);}
function fail(res,status,message){json(res,status,{error:message});}
function requestKey(req,token){const header=req.headers.authorization??'';return header===`Bearer ${token}`;}
function validUuid(value){return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);}
function accountGroup(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;}
function usageDefault(){return {rhCoins:null,walletAmount:null,thirdPartyAmount:null,currency:null};}

export async function startServer({unlocked,port=4317,releaseLock}){
  const {dir,key}=unlocked;const store=await createStateStore(unlocked);
  const token=await readServiceToken(dir);let submissionBusy=false,pollBusy=false,closing=false;
  await store.transact(state=>{
    for(const job of state.jobs){if(job.status==='submitting'){job.status='submission_unknown';job.error='Service restarted during provider submission. Check RunningHub before any further action.';job.updatedAt=now();}else if(job.status==='uploading'){job.status='queued';job.error=null;job.updatedAt=now();}}
  });

  async function executeQueued(){
    const snapshot=store.snapshot();const active=snapshot.jobs.filter(job=>occupiesSlot(job));
    if(active.length>=MAX_ACTIVE)return;
    const occupied=new Set(active.map(job=>job.accountGroup).filter(Boolean));
    const candidate=snapshot.jobs.find(job=>job.status==='queued'&&(!job.accountGroup||!occupied.has(job.accountGroup)));
    if(!candidate)return;
    const entry=snapshot.keys.find(item=>item.keyId===candidate.keyId)||snapshot.keys.find(item=>item.enabled&&item.consumerStatus==='consumer'&&!occupied.has(item.accountGroup));
    const selected=entry&&entry.enabled&&entry.consumerStatus==='consumer'&&!occupied.has(entry.accountGroup)?entry:null;
    if(!selected)return;
    await store.transact(state=>{const job=state.jobs.find(item=>item.id===candidate.id);if(!job||job.status!=='queued')return;job.keyId=selected.keyId;job.accountGroup=selected.accountGroup;job.status='uploading';job.updatedAt=now();job.error=null;});
    const job=store.snapshot().jobs.find(item=>item.id===candidate.id);if(!job||job.status!=='uploading')return;
    try{
      const apiKey=decryptSecret(key,selected.secret);const uploaded={images:[],audios:[],video:null};
      for(const ref of job.input.references){const remoteName=await uploadReference(apiKey,ref);if(ref.kind==='image')uploaded.images.push(remoteName);else if(ref.kind==='audio')uploaded.audios.push(remoteName);else uploaded.video=remoteName;}
      const currentSchema=await inspectH3Schema();
      if(currentSchema.fingerprint!==job.preview.schemaFingerprint)throw Error('H3 public schema changed after preparation; no task was submitted. Prepare a new operation.');
      const nodeInfoList=buildNodeInfo(currentSchema,job.input,uploaded);
      const maySubmit=await store.transact(state=>{const target=state.jobs.find(item=>item.id===job.id),bound=state.keys.find(item=>item.keyId===selected.keyId);if(!target||target.status!=='uploading')return false;if(!bound?.enabled||bound.consumerStatus!=='consumer'){target.status='queued';target.error='The bound key was disabled before submission.';target.updatedAt=now();return false;}target.status='submitting';target.submitIntentAt=now();target.updatedAt=now();target.nodeInfoDigest=createHash('sha256').update(JSON.stringify(nodeInfoList)).digest('hex');return true;});
      if(!maySubmit)return;
      const result=await submitH3(apiKey,nodeInfoList);
      await store.transact(state=>{const target=state.jobs.find(item=>item.id===job.id);if(!target||target.status!=='submitting')return;target.status=result.status;target.taskId=result.taskId??null;target.error=result.error??null;target.usage=result.usage??usageDefault();target.acceptedAt=result.status==='submitted'?now():null;target.updatedAt=now();});
    }catch(error){
      await store.transact(state=>{const target=state.jobs.find(item=>item.id===job.id);if(!target)return;if(target.status==='submitting'){target.status='submission_unknown';target.error='An error occurred after the submit intent was persisted. Check RunningHub before any further action.';target.updatedAt=now();return;}if(target.status!=='uploading')return;target.preparationAttempts=(target.preparationAttempts??0)+1;const permanent=error?.code==='ENOENT'||/schema changed|file changed after it was prepared|size changed during validation/i.test(String(error?.message));target.status=permanent||target.preparationAttempts>=3?'failed':'queued';target.error=error instanceof Error?error.message:'Reference preparation failed.';target.updatedAt=now();});
    }
  }
  async function pollActive(){
    const snapshot=store.snapshot();
    await Promise.all(snapshot.jobs.filter(item=>['submitted','running'].includes(item.status)&&item.taskId&&item.keyId).map(async job=>{
      const entry=snapshot.keys.find(item=>item.keyId===job.keyId);if(!entry)return;
      try{
        const result=await queryTask(decryptSecret(key,entry.secret),job.taskId);
        await store.transact(state=>{const target=state.jobs.find(item=>item.id===job.id);if(!target||!['submitted','running'].includes(target.status))return;target.status=result.status;target.outputs=result.outputs??target.outputs??[];target.usage=result.usage??target.usage??usageDefault();target.error=result.error??null;target.lastQueryError=null;target.updatedAt=now();});
      }catch(error){await store.transact(state=>{const target=state.jobs.find(item=>item.id===job.id);if(target){target.lastQueryError=error instanceof Error?error.message:'RunningHub query was not confirmed.';target.updatedAt=now();}});}
    }));
  }
  async function tick(){
    if(closing)return;const work=[];
    if(!pollBusy){pollBusy=true;work.push(pollActive().catch(()=>{}).finally(()=>{pollBusy=false;}));}
    if(!submissionBusy){submissionBusy=true;work.push(executeQueued().catch(()=>{}).finally(()=>{submissionBusy=false;}));}
    await Promise.all(work);
  }
  const timer=setInterval(()=>void tick(),5000);timer.unref?.();void tick();

  const server=createServer(async(req,res)=>{
    const host=req.headers.host??'';if(host!==`127.0.0.1:${port}`){fail(res,403,'Loopback host required.');return;}
    const url=new URL(req.url??'/',`http://${host}`),method=req.method??'GET';
    if(method==='GET'&&url.pathname==='/api/health'){json(res,200,{ok:true,service:'runninghub-minimax-h3-independent',executor:'online'});return;}
    if(!requestKey(req,token)){fail(res,401,'Local service token is missing or invalid.');return;}
    try{
      if(method==='GET'&&url.pathname==='/api/keys'){
        const state=store.snapshot();json(res,200,{keys:state.keys.map(cleanKey)});return;
      }
      if(method==='POST'&&url.pathname==='/api/keys'){
        const body=await bodyJson(req),apiKey=typeof body.apiKey==='string'?body.apiKey.trim():'',group=accountGroup(body.accountGroup);
        if(!/^[a-fA-F0-9]{32}$/.test(apiKey)){fail(res,400,'Only 32-character hexadecimal RunningHub consumer keys are accepted.');return;}
        if(!group){fail(res,400,'accountGroup must be a short alias so keys from one account can share its local slot.');return;}
        const digest=fingerprint(apiKey),result=await store.transact(state=>{
          const existing=state.keys.find(item=>item.fingerprint===digest);if(existing){if(existing.accountGroup!==group)throw Object.assign(Error('This key is already bound to a different account group.'),{status:409});return {existing:cleanKey(existing)};}
          if(state.keys.length>=100)throw Error('The independent key pool reached its 100-key limit.');
          const entry={keyId:`rhkey_${randomUUID()}`,accountGroup:group,fingerprint:digest,enabled:false,capacity:1,consumerStatus:'unverified',createdAt:now(),secret:encryptSecret(key,apiKey)};state.keys.push(entry);return {created:cleanKey(entry)};
        });
        json(res,result.created?201:200,result);return;
      }
      let keyMatch=url.pathname.match(/^\/api\/keys\/([^/]+)\/probe$/);
      if(method==='POST'&&keyMatch){
        const keyId=decodeURIComponent(keyMatch[1]),entry=store.snapshot().keys.find(item=>item.keyId===keyId);if(!entry){fail(res,404,'Key was not found.');return;}
        const details=await verifyConsumerKey(decryptSecret(key,entry.secret));
        const updated=await store.transact(state=>{const target=state.keys.find(item=>item.keyId===keyId);target.consumerStatus=details.apiType==='NORMAL'?'consumer':'ineligible';if(target.consumerStatus!=='consumer')target.enabled=false;target.checkedAt=details.checkedAt;target.accountStatus={remainCoins:details.remainCoins,remainMoney:details.remainMoney,currency:details.currency,currentTaskCount:details.currentTaskCount};return cleanKey(target);});
        json(res,200,{key:updated});return;
      }
      keyMatch=url.pathname.match(/^\/api\/keys\/([^/]+)$/);
      if(method==='PATCH'&&keyMatch){
        const keyId=decodeURIComponent(keyMatch[1]),body=await bodyJson(req);if(typeof body.enabled!=='boolean'||Object.keys(body).some(name=>name!=='enabled')){fail(res,400,'Only the enabled boolean may be changed.');return;}
        const updated=await store.transact(state=>{const target=state.keys.find(item=>item.keyId===keyId);if(!target)throw Object.assign(Error('Key was not found.'),{status:404});if(body.enabled&&target.consumerStatus!=='consumer')throw Object.assign(Error('Probe the key and verify consumer account status before enabling it.'),{status:409});target.enabled=body.enabled;return cleanKey(target);});json(res,200,{key:updated});return;
      }
      if(method==='POST'&&url.pathname==='/api/h3/prepare'){
        const body=await bodyJson(req);if(!validUuid(body.operationId)){fail(res,400,'operationId must be a UUID reused for retries of this preparation.');return;}
        const requestedKeyId=body.keyId===undefined?null:typeof body.keyId==='string'&&/^rhkey_[a-zA-Z0-9_-]{1,100}$/.test(body.keyId)?body.keyId:null;
        if(body.keyId!==undefined&&!requestedKeyId){fail(res,400,'keyId has an invalid format.');return;}
        const requestedKey=requestedKeyId?store.snapshot().keys.find(item=>item.keyId===requestedKeyId):null;
        if(requestedKeyId&&(!requestedKey||!requestedKey.enabled||requestedKey.consumerStatus!=='consumer')){fail(res,409,'The requested key must exist, be verified as a consumer key, and be enabled.');return;}
        const validated=await validateReferences(body.references??[]);const input=validateH3Input({prompt:body.prompt,parameters:body.parameters,_validatedReferences:validated});
        const prior=store.snapshot().jobs.find(item=>item.operationId===body.operationId);
        if(prior){if(!sameJson(prior.input,input)||prior.requestedKeyId!==(requestedKeyId??null)){fail(res,409,'This operationId is already bound to different input or key.');return;}json(res,200,{job:cleanJob(prior),...prior.preview});return;}
        const schema=await inspectH3Schema();
        const preview={appId:APP_ID,parameters:input.parameters,schemaFingerprint:schema.fingerprint,references:input.references.map(ref=>({kind:ref.kind,path:basename(ref.path),role:ref.role})),notes:['通用参考槽的首尾帧含义由提示词描述，不保证精确帧锁定。','费用和钱包消费在远端回执缺失时记录为未知。']};
        const prepared=await store.transact(state=>{
          const prior=state.jobs.find(item=>item.operationId===body.operationId);
          if(prior){if(!sameJson(prior.input,input)||prior.requestedKeyId!==(requestedKeyId??null))throw Object.assign(Error('This operationId is already bound to different input or key.'),{status:409});return {job:cleanJob(prior),preview:prior.preview};}
          const created={id:randomUUID(),operationId:body.operationId,status:'prepared',input,requestedKeyId:requestedKeyId??null,keyId:requestedKey?.keyId??null,accountGroup:requestedKey?.accountGroup??null,preview,outputs:[],usage:usageDefault(),createdAt:now(),updatedAt:now()};state.jobs.push(created);return {job:cleanJob(created),preview};
        });
        json(res,200,{job:prepared.job,...prepared.preview});return;
      }
      if(method==='GET'&&url.pathname==='/api/jobs'){
        const jobs=store.snapshot().jobs.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(cleanJob);json(res,200,{jobs});return;
      }
      let jobMatch=url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(submit|attach-task|resolve-not-accepted))?$/);
      if(jobMatch){
        const jobId=decodeURIComponent(jobMatch[1]),action=jobMatch[2];
        if(method==='GET'&&!action){const job=store.snapshot().jobs.find(item=>item.id===jobId);if(!job){fail(res,404,'Job was not found.');return;}json(res,200,{job:cleanJob(job)});return;}
        if(method==='POST'&&action==='submit'){
          const job=await store.transact(state=>{const target=state.jobs.find(item=>item.id===jobId);if(!target)throw Object.assign(Error('Job was not found.'),{status:404});if(target.status==='prepared'){target.status='queued';target.error=null;target.updatedAt=now();}return cleanJob(target);});json(res,200,{job});return;
        }
        if(method==='POST'&&action==='attach-task'){
          const body=await bodyJson(req),taskId=typeof body.taskId==='string'?body.taskId.trim():'';
          if(!/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)){fail(res,400,'taskId has an invalid format.');return;}
          const job=await store.transact(state=>{const target=state.jobs.find(item=>item.id===jobId);if(!target)throw Object.assign(Error('Job was not found.'),{status:404});if(target.status!=='submission_unknown'||!target.keyId)throw Object.assign(Error('Only an unresolved submission can be reconciled with a task ID.'),{status:409});target.taskId=taskId;target.status='submitted';target.error=null;target.updatedAt=now();return cleanJob(target);});json(res,200,{job});return;
        }
        if(method==='POST'&&action==='resolve-not-accepted'){
          const body=await bodyJson(req);if(body.confirmation!=='I checked RunningHub and found no task for this submission.'){fail(res,400,'Explicit confirmation is required after checking the RunningHub account.');return;}
          const job=await store.transact(state=>{const target=state.jobs.find(item=>item.id===jobId);if(!target)throw Object.assign(Error('Job was not found.'),{status:404});if(target.status!=='submission_unknown'||!target.keyId)throw Object.assign(Error('Only an unresolved submission can be resolved.'),{status:409});target.status='failed';target.resolution='operator_confirmed_not_accepted';target.error='Operator confirmed no remote task exists. This operation will not be resubmitted.';target.updatedAt=now();return cleanJob(target);});json(res,200,{job});return;
        }
      }
      fail(res,404,'Route was not found.');
    }catch(error){const status=Number(error?.status)||400;fail(res,status,error instanceof Error?error.message:'Request failed.');}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});}
  catch(error){clearInterval(timer);await releaseLock?.();throw error;}
  const close=async()=>{if(closing)return;closing=true;clearInterval(timer);await new Promise(resolve=>server.close(()=>resolve()));await releaseLock();};
  process.once('SIGINT',()=>void close().then(()=>process.exit(0)));
  process.once('SIGTERM',()=>void close().then(()=>process.exit(0)));
  process.once('exit',()=>{clearInterval(timer);});
  console.log(`Independent RunningHub H3 service listening at http://127.0.0.1:${port}`);
  console.log('Keep this process running while jobs are executing. Press Ctrl+C to stop.');
  return {server,store,token,close};
}
