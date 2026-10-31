import{DatabaseSync}from'node:sqlite';
import{randomUUID}from'node:crypto';
import{monitorSchema,Problem,type MonitorConfig,type Monitor,type CheckRow,type Observation}from'./contracts.ts';
import{evaluate}from'./evaluate.ts';
import{targetURL,fixtureObservation,externalProbe}from'./probe.ts';
const uid=()=>randomUUID();
export type Incident={id:string;monitorId:string;status:'open'|'acknowledged'|'resolved';title:string;openedAt:string;acknowledgedAt:string|null;resolvedAt:string|null;openedCheckId:string;resolvedCheckId:string|null;note:string};
export class Store{
 readonly db:DatabaseSync;private inflight=new Map<string,{key:string;promise:Promise<CheckRow>}>();private active=0;
 constructor(path=':memory:',readonly publicDemo=true,private clock=()=>new Date().toISOString()){
  if(publicDemo&&path!==':memory:')throw new Error('Public demo must use an isolated in-memory database.');
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS monitors(id TEXT PRIMARY KEY,config TEXT NOT NULL,version INTEGER NOT NULL,epoch INTEGER NOT NULL,paused INTEGER NOT NULL,scenario TEXT NOT NULL,maintenance INTEGER NOT NULL,baseline TEXT,fail_streak INTEGER NOT NULL,pass_streak INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL REFERENCES monitors(id),request_key TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(monitor_id,request_key));
  CREATE TABLE IF NOT EXISTS request_keys(monitor_id TEXT NOT NULL REFERENCES monitors(id),request_key TEXT NOT NULL,check_id TEXT NOT NULL,PRIMARY KEY(monitor_id,request_key));
  CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL REFERENCES monitors(id),payload TEXT NOT NULL,opened_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL REFERENCES monitors(id),incident_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS checks_monitor_time ON checks(monitor_id,created_at);
  CREATE INDEX IF NOT EXISTS incidents_monitor ON incidents(monitor_id);
  PRAGMA user_version=1;`);
 }
 close(){this.db.close();}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 event(mid:string,action:string,detail:string,iid:string|null=null){this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(uid(),mid,iid,action,detail,this.clock());this.db.prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY created_at DESC,rowid DESC LIMIT 500)').run();}
 monitor(id:string):Monitor{
  const r=this.db.prepare('SELECT * FROM monitors WHERE id=?').get(id) as any;if(!r)throw new Problem(404,'Monitor not found.');
  return{id:r.id,config:JSON.parse(r.config),version:r.version,epoch:r.epoch,paused:Boolean(r.paused),scenario:r.scenario,maintenance:Boolean(r.maintenance),baseline:r.baseline?JSON.parse(r.baseline):null,failStreak:r.fail_streak,passStreak:r.pass_streak,createdAt:r.created_at,updatedAt:r.updated_at};
 }
 private writeMonitor(m:Monitor){this.db.prepare('UPDATE monitors SET config=?,version=?,epoch=?,paused=?,scenario=?,maintenance=?,baseline=?,fail_streak=?,pass_streak=?,updated_at=? WHERE id=?').run(JSON.stringify(m.config),m.version,m.epoch,Number(m.paused),m.scenario,Number(m.maintenance),m.baseline?JSON.stringify(m.baseline):null,m.failStreak,m.passStreak,this.clock(),m.id);}
 create(raw:unknown){const config=monitorSchema.parse(raw);targetURL(config.target,this.publicDemo);
  if((this.db.prepare('SELECT count(*) AS n FROM monitors').get() as any).n>=20)throw new Problem(429,'This workspace supports up to 20 monitors.');
  return this.transaction(()=>{const id=uid(),now=this.clock();this.db.prepare('INSERT INTO monitors VALUES(?,?,1,0,0,?,0,NULL,0,0,?,?)').run(id,JSON.stringify(config),'healthy',now,now);this.event(id,'monitor.created',config.name);return this.monitor(id);});
 }
 update(id:string,version:number,raw:unknown){const config=monitorSchema.parse(raw);targetURL(config.target,this.publicDemo);
  return this.transaction(()=>{const m=this.monitor(id);if(m.version!==version)throw new Problem(409,'Monitor configuration changed. Reload before editing.');
   const incident=this.openIncident(id);if(incident){incident.status='resolved';incident.resolvedAt=this.clock();incident.note='Configuration changed; previous incident superseded.';this.saveIncident(incident);this.event(id,'incident.superseded',incident.note,incident.id);}
   m.config=config;m.version++;m.failStreak=0;m.passStreak=0;m.baseline=null;this.writeMonitor(m);this.event(id,'monitor.updated',`Configuration revision ${m.version}`);return this.monitor(id);
  });
 }
 control(id:string,raw:{paused?:boolean;maintenance?:boolean;scenario?:string}){
  if(raw.scenario&&!['healthy','outage','slow','drift'].includes(raw.scenario))throw new Problem(400,'Unknown scenario.');
  return this.transaction(()=>{const m=this.monitor(id);if(raw.scenario&&!m.config.target.startsWith('fixture:'))throw new Problem(400,'Scenarios are only available for built-in demo endpoints.');
   const boundary=(raw.paused!==undefined&&raw.paused!==m.paused)||(raw.maintenance!==undefined&&raw.maintenance!==m.maintenance);
   if(raw.paused!==undefined)m.paused=raw.paused;if(raw.maintenance!==undefined)m.maintenance=raw.maintenance;if(raw.scenario)m.scenario=raw.scenario;
   if(boundary){m.epoch++;m.failStreak=0;m.passStreak=0;}
   this.writeMonitor(m);this.event(id,'monitor.control',`Paused: ${m.paused}; maintenance: ${m.maintenance}; scenario: ${m.scenario}`);return this.monitor(id);
  });
 }
 check(id:string){const r=this.db.prepare('SELECT payload FROM checks WHERE id=?').get(id) as any;if(!r)throw new Problem(404,'Check not found.');return JSON.parse(r.payload) as CheckRow;}
 checks(mid:string,limit=100){this.monitor(mid);return(this.db.prepare('SELECT payload FROM checks WHERE monitor_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?').all(mid,limit) as any[]).map(r=>JSON.parse(r.payload) as CheckRow);}
 incidents(){return(this.db.prepare('SELECT payload FROM incidents ORDER BY opened_at DESC,rowid DESC').all() as any[]).map(r=>JSON.parse(r.payload) as Incident);}
 private openIncident(mid:string){return this.incidents().find(i=>i.monitorId===mid&&i.status!=='resolved');}
 private saveIncident(i:Incident){this.db.prepare('INSERT INTO incidents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(i.id,i.monitorId,JSON.stringify(i),i.openedAt);}
 acknowledge(id:string,note:string){return this.transaction(()=>{const i=this.incidents().find(i=>i.id===id);if(!i)throw new Problem(404,'Incident not found.');if(i.status==='resolved')throw new Problem(409,'This incident is already resolved.');if(i.status==='acknowledged')return i;i.status='acknowledged';i.acknowledgedAt=this.clock();i.note=note;this.saveIncident(i);this.event(i.monitorId,'incident.acknowledged',note||'Acknowledged by operator',i.id);return i;});}
 approveBaseline(mid:string,checkId:string){return this.transaction(()=>{const m=this.monitor(mid),c=this.check(checkId);if(c.monitorId!==mid||c.version!==m.version||c.status!=='passed')throw new Problem(409,'Choose a passing check from the current monitor revision.');m.baseline=c.shape;this.writeMonitor(m);this.event(mid,'baseline.accepted',`Response shape accepted from check ${c.id}`);return this.monitor(mid);});}
 async run(mid:string,key:string,probe?:(m:Monitor)=>Promise<Observation>):Promise<CheckRow>{
  if(!/^[A-Za-z0-9_.:-]{8,100}$/.test(key))throw new Problem(400,'Provide an 8–100 character request key.');
  const old=this.db.prepare('SELECT payload FROM checks WHERE monitor_id=? AND request_key=?').get(mid,key) as any;if(old)return JSON.parse(old.payload);
  if(this.db.prepare('SELECT check_id FROM request_keys WHERE monitor_id=? AND request_key=?').get(mid,key))throw new Problem(410,'The original check has left retained history; use a new request key for a new observation.');
  if((this.db.prepare('SELECT count(*) AS n FROM request_keys WHERE monitor_id=?').get(mid) as any).n>=10000)throw new Problem(429,'This monitor has reached its 10,000-check limit.');
  const existing=this.inflight.get(mid);if(existing){if(existing.key===key)return existing.promise;throw new Problem(409,'This monitor already has a check in progress.');}
  const m=this.monitor(mid);if(m.paused)throw new Problem(409,'Resume this monitor before running a check.');if(this.active>=4)throw new Problem(429,'Four checks are already running. Try again shortly.');
  this.active++;
  const promise=Promise.resolve().then(async()=>{let observation:Observation;try{observation=await(probe?probe(m):m.config.target.startsWith('fixture:')?Promise.resolve(fixtureObservation(m.config.target,m.scenario,this.checks(mid,200).length)):externalProbe(m.config.target));}catch(e){observation={status:0,latencyMs:0,body:null,error:(e as Error).message.slice(0,240),synthetic:m.config.target.startsWith('fixture:')};}return this.record(m,key,observation);}).finally(()=>{this.active--;this.inflight.delete(mid);});
  this.inflight.set(mid,{key,promise});return promise;
 }
 record(snapshot:Monitor,key:string,observation:Observation,at?:string):CheckRow{
  return this.transaction(()=>{const existing=this.db.prepare('SELECT payload FROM checks WHERE monitor_id=? AND request_key=?').get(snapshot.id,key) as any;if(existing)return JSON.parse(existing.payload);
   const current=this.monitor(snapshot.id),evaluation=evaluate(snapshot.config,observation,snapshot.baseline),superseded=current.version!==snapshot.version||current.epoch!==snapshot.epoch||current.paused||current.maintenance!==snapshot.maintenance;
   const status=superseded?'superseded':snapshot.maintenance?'suppressed':evaluation.passed?'passed':'failed';
   const row:CheckRow={id:uid(),monitorId:snapshot.id,key,version:snapshot.version,config:snapshot.config,status,httpStatus:observation.status,latencyMs:observation.latencyMs,assertions:evaluation.assertions,shape:evaluation.shape,drift:evaluation.drift,preview:JSON.stringify(observation.body)?.slice(0,4096)||'null',error:observation.error||null,synthetic:observation.synthetic,createdAt:at||this.clock()};
   this.db.prepare('INSERT INTO checks VALUES(?,?,?,?,?,?)').run(row.id,row.monitorId,key,row.version,JSON.stringify(row),row.createdAt);
   this.db.prepare('INSERT INTO request_keys VALUES(?,?,?)').run(row.monitorId,key,row.id);
   if(!superseded&&!snapshot.maintenance){
    current.failStreak=evaluation.passed?0:current.failStreak+1;current.passStreak=evaluation.passed?current.passStreak+1:0;
    if(!current.baseline&&evaluation.passed){current.baseline=evaluation.shape;this.event(current.id,'baseline.captured','First passing response shape captured.');}
    let incident=this.openIncident(current.id);
    if(!evaluation.passed&&current.failStreak>=current.config.failThreshold&&!incident){incident={id:uid(),monitorId:current.id,status:'open',title:`${current.config.name} · check failure`,openedAt:row.createdAt,acknowledgedAt:null,resolvedAt:null,openedCheckId:row.id,resolvedCheckId:null,note:''};this.saveIncident(incident);this.event(current.id,'incident.opened',`${current.failStreak} consecutive failures`,incident.id);}
    if(evaluation.passed&&current.passStreak>=current.config.recoverThreshold&&incident){incident.status='resolved';incident.resolvedAt=row.createdAt;incident.resolvedCheckId=row.id;this.saveIncident(incident);this.event(current.id,'incident.resolved',`${current.passStreak} consecutive passing checks`,incident.id);}
    this.writeMonitor(current);
   }
   const closed=this.incidents().filter(i=>i.status==='resolved');for(const old of closed.slice(100))this.db.prepare('DELETE FROM incidents WHERE id=?').run(old.id);
   const incidentRows=this.incidents(),keep=new Set(incidentRows.flatMap(i=>[i.openedCheckId,i.resolvedCheckId].filter(Boolean)));
   for(const old of(this.db.prepare('SELECT id FROM checks WHERE monitor_id=? ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 200').all(current.id) as any[]))if(!keep.has(old.id))this.db.prepare('DELETE FROM checks WHERE id=?').run(old.id);
   return row;
  });
 }
 detail(mid:string){const m=this.monitor(mid);return{monitor:m,checks:this.checks(mid,200),incidents:this.incidents().filter(i=>i.monitorId===mid),events:this.db.prepare('SELECT * FROM events WHERE monitor_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(mid)};}
 overview(){const monitors=(this.db.prepare('SELECT id FROM monitors ORDER BY created_at,rowid').all() as any[]).map(r=>{const m=this.monitor(r.id),checks=this.checks(m.id,200),eligible=checks.filter(c=>['passed','failed'].includes(c.status)&&c.version===m.version),latencies=eligible.map(c=>c.latencyMs).sort((a,b)=>a-b),last=eligible[0],incident=this.openIncident(m.id);return{...m,status:m.paused?'paused':m.maintenance?'maintenance':incident?'incident':last?.status==='failed'?'degraded':last?'healthy':'pending',latest:checks[0]||null,history:checks.slice(0,40).reverse().map(c=>({status:c.status,latencyMs:c.latencyMs,at:c.createdAt})),stats:{checks:eligible.length,passed:eligible.filter(c=>c.status==='passed').length,passRate:eligible.length?Math.round(eligible.filter(c=>c.status==='passed').length/eligible.length*10000)/100:null,p95:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null},incidentId:incident?.id||null};});return{monitors,incidents:this.incidents(),events:this.db.prepare('SELECT * FROM events ORDER BY created_at DESC,rowid DESC LIMIT 50').all(),publicDemo:this.publicDemo};}
 seed(){
  if((this.db.prepare('SELECT count(*) AS n FROM monitors').get() as any).n)return;
  const names=[['Catalog API','catalog','Commerce'],['Checkout API','checkout','Commerce'],['Identity service','identity','Platform'],['Inventory API','inventory','Commerce'],['Webhook gateway','webhooks','Integrations']];
  for(const[name,target,group]of names){const m=this.create({name,target:'fixture:'+target,group,budgetMs:target==='webhooks'?500:800,failThreshold:2,recoverThreshold:2,rules:[{pointer:'/status',op:'equals',expected:'ok'},{pointer:'/data/available',op:'type',expected:'boolean'}]});
   for(let tick=0;tick<24;tick++){const scenario=target==='checkout'&&tick>=21?'outage':target==='webhooks'&&tick===8?'slow':'healthy';const at=new Date(Date.now()-(24-tick)*5*60000).toISOString();this.record(this.monitor(m.id),`seed-${target}-${tick}`,fixtureObservation(m.config.target,scenario,tick),at);}
   if(target==='checkout')this.control(m.id,{scenario:'outage'});
  }
 }
}
