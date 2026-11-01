import type{DatabaseSync}from'node:sqlite';
import{randomUUID}from'node:crypto';
import{Problem,type Monitor}from'./contracts.ts';
export const LEASE_MS=15000,MAX_ATTEMPTS=3;
export type Claim={id:string;token:string;attempt:number;snapshot:Monitor;key:string};
export class JobQueue{
 constructor(private db:DatabaseSync,private clock:()=>string,private monitor:(id:string)=>Monitor){
  db.exec(`CREATE TABLE IF NOT EXISTS execution_jobs(id TEXT PRIMARY KEY,monitor_id TEXT NOT NULL REFERENCES monitors(id),request_key TEXT NOT NULL,origin TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER,check_id TEXT,error TEXT,created_at TEXT NOT NULL,finished_at TEXT,retry_of TEXT,missed_slots INTEGER NOT NULL DEFAULT 0,UNIQUE(monitor_id,request_key));
  CREATE UNIQUE INDEX IF NOT EXISTS execution_monitor_active ON execution_jobs(monitor_id) WHERE status IN ('queued','running');
  CREATE INDEX IF NOT EXISTS execution_due ON execution_jobs(status,available_at,lease_until);
  CREATE TABLE IF NOT EXISTS execution_attempts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,number INTEGER NOT NULL,token TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error TEXT,UNIQUE(job_id,number));
  CREATE TABLE IF NOT EXISTS schedule_cursors(monitor_id TEXT PRIMARY KEY REFERENCES monitors(id),version INTEGER NOT NULL,epoch INTEGER NOT NULL,next_due INTEGER NOT NULL);
  PRAGMA user_version=2;`);
 }
 private now(){return Date.parse(this.clock());}
 private tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 job(id:string){const r=this.db.prepare('SELECT * FROM execution_jobs WHERE id=?').get(id) as any;if(!r)throw new Problem(404,'Execution job not found.');const {lease_token,snapshot,...safe}=r;const m=JSON.parse(snapshot) as Monitor;const check=r.check_id?this.db.prepare('SELECT payload FROM checks WHERE id=?').get(r.check_id) as any:null;return{...safe,checkStatus:check?JSON.parse(check.payload).status:null,evidenceExpired:Boolean(r.check_id&&!check),monitorName:m.config.name,version:m.version,epoch:m.epoch,synthetic:m.config.target.startsWith('fixture:'),attempts:(this.db.prepare('SELECT number,status,started_at,finished_at,error FROM execution_attempts WHERE job_id=? ORDER BY number').all(id) as any[])};}
 byKey(mid:string,key:string){return this.db.prepare('SELECT * FROM execution_jobs WHERE monitor_id=? AND request_key=?').get(mid,key) as any;}
 list(mid?:string){return(this.db.prepare(`SELECT id FROM execution_jobs ${mid?'WHERE monitor_id=?':''} ORDER BY created_at DESC,rowid DESC LIMIT 100`).all(...(mid?[mid]:[])) as any[]).map(r=>this.job(r.id));}
 enqueue(mid:string,key:string,origin='manual',retryOf:string|null=null){
  if(!/^[A-Za-z0-9_.:-]{8,100}$/.test(key))throw new Problem(400,'Provide an 8–100 character request key.');
  return this.tx(()=>{
   const old=this.byKey(mid,key);if(old)return this.job(old.id);
   if(this.db.prepare('SELECT check_id FROM request_keys WHERE monitor_id=? AND request_key=?').get(mid,key))throw new Problem(410,'Original check left retained job history. Use a new key.');
   const m=this.monitor(mid);if(m.paused)throw new Problem(409,'Resume this monitor before queuing a check.');
   if((this.db.prepare('SELECT count(*) n FROM request_keys WHERE monitor_id=?').get(mid) as any).n>=10000)throw new Problem(429,'This monitor has reached its 10,000-check limit.');
   if(this.db.prepare("SELECT id FROM execution_jobs WHERE monitor_id=? AND status IN ('queued','running')").get(mid))throw new Problem(409,'This monitor already has a queued or running check.');
   const id=randomUUID();this.db.prepare("INSERT INTO execution_jobs(id,monitor_id,request_key,origin,snapshot,status,available_at,created_at,retry_of) VALUES(?,?,?,?,?,'queued',?,?,?)").run(id,mid,key,origin,JSON.stringify(m),this.now(),this.clock(),retryOf);this.prune(mid);return this.job(id);
  });
 }
 private prune(mid:string){this.db.prepare("DELETE FROM execution_jobs WHERE monitor_id=? AND status NOT IN ('queued','running') AND id NOT IN (SELECT id FROM execution_jobs WHERE monitor_id=? AND status NOT IN ('queued','running') ORDER BY created_at DESC,rowid DESC LIMIT 200)").run(mid,mid);}
 candidates(){return(this.db.prepare("SELECT id FROM execution_jobs WHERE (status='queued' AND available_at<=?) OR (status='running' AND lease_until<=?) ORDER BY available_at,created_at,rowid LIMIT 20").all(this.now(),this.now()) as any[]).map(r=>r.id as string);}
 claim(id:string):Claim|null{
  return this.tx(()=>{
   let job=this.db.prepare('SELECT * FROM execution_jobs WHERE id=?').get(id) as any;if(!job)throw new Problem(404,'Execution job not found.');const now=this.now();
   if(job.status==='running'){
    if(job.lease_until>now)return null;
    this.db.prepare("UPDATE execution_attempts SET status='abandoned',finished_at=?,error='Worker lease expired before commit' WHERE job_id=? AND token=? AND status='running'").run(this.clock(),id,job.lease_token);
    if(job.attempt_count>=MAX_ATTEMPTS){this.db.prepare("UPDATE execution_jobs SET status='failed',lease_token=NULL,lease_until=NULL,finished_at=?,error='Worker lease expired; retry budget exhausted' WHERE id=?").run(this.clock(),id);return null;}
    this.db.prepare("UPDATE execution_jobs SET status='queued',lease_token=NULL,lease_until=NULL,available_at=?,error='Worker lease expired; recovered for retry' WHERE id=?").run(now,id);job={...job,status:'queued',available_at:now};
   }
   if(job.status!=='queued'||job.available_at>now)return null;
   const snapshot=JSON.parse(job.snapshot) as Monitor,current=this.monitor(job.monitor_id);
   if(current.paused||current.version!==snapshot.version||current.epoch!==snapshot.epoch){this.db.prepare("UPDATE execution_jobs SET status='cancelled',finished_at=?,error='Monitor paused or configuration/control generation changed before execution' WHERE id=?").run(this.clock(),id);return null;}
   if((this.db.prepare("SELECT count(*) n FROM execution_jobs WHERE status='running' AND lease_until>?").get(now) as any).n>=4)return null;
   const token=randomUUID(),attempt=job.attempt_count+1;
   this.db.prepare("UPDATE execution_jobs SET status='running',attempt_count=?,lease_token=?,lease_until=?,error=NULL WHERE id=?").run(attempt,token,now+LEASE_MS,id);
   this.db.prepare("INSERT INTO execution_attempts VALUES(?,?,?,?,'running',?,NULL,NULL)").run(randomUUID(),id,attempt,token,this.clock());
   return{id,token,attempt,snapshot,key:job.request_key};
  });
 }
 fence(claim:Claim){const row=this.db.prepare("SELECT id FROM execution_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").get(claim.id,claim.token,this.now());if(!row)throw new Problem(409,'Execution lease was lost; this worker cannot commit evidence.');}
 // Called inside the same transaction as check, incident, counters and audit updates.
 finish(claim:Claim,checkId:string){this.fence(claim);this.db.prepare("UPDATE execution_attempts SET status='completed',finished_at=? WHERE job_id=? AND token=?").run(this.clock(),claim.id,claim.token);this.db.prepare("UPDATE execution_jobs SET status='completed',check_id=?,finished_at=?,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=?").run(checkId,this.clock(),claim.id);this.prune(claim.snapshot.id);}
 fail(claim:Claim,error:unknown){return this.tx(()=>{
  try{this.fence(claim);}catch{return false;}
  const message=String((error as Error)?.message||error).slice(0,240),terminal=claim.attempt>=MAX_ATTEMPTS;
  this.db.prepare("UPDATE execution_attempts SET status='failed',finished_at=?,error=? WHERE job_id=? AND token=?").run(this.clock(),message,claim.id,claim.token);
  this.db.prepare('UPDATE execution_jobs SET status=?,available_at=?,lease_token=NULL,lease_until=NULL,error=?,finished_at=? WHERE id=?').run(terminal?'failed':'queued',this.now()+1000*2**(claim.attempt-1),message,terminal?this.clock():null,claim.id);return true;
 });}
 cancel(id:string){return this.tx(()=>{const j=this.job(id);if(j.status==='cancelled')return j;if(j.status!=='queued')throw new Problem(409,'Only queued jobs can be cancelled.');this.db.prepare("UPDATE execution_jobs SET status='cancelled',finished_at=?,error='Cancelled by operator before execution' WHERE id=?").run(this.clock(),id);return this.job(id);});}
 scheduleDue(now:number){
  // Each cursor advancement and its one coalesced job are committed atomically.
  return this.tx(()=>{
   const ids=this.db.prepare('SELECT id FROM monitors ORDER BY created_at,rowid').all() as any[];
   for(const {id} of ids){const m=this.monitor(id);if(m.paused)continue;
    const cursor=this.db.prepare('SELECT * FROM schedule_cursors WHERE monitor_id=?').get(id) as any,interval=m.config.intervalSeconds*1000;
    let due=cursor&&cursor.version===m.version&&cursor.epoch===m.epoch?cursor.next_due:now;
    const latest=this.db.prepare("SELECT c.created_at,j.snapshot FROM checks c LEFT JOIN execution_jobs j ON j.check_id=c.id WHERE c.monitor_id=? AND c.version=? ORDER BY c.created_at DESC,c.rowid DESC LIMIT 1").get(id,m.version) as any;
    const sameEpoch=latest&&(latest.snapshot?JSON.parse(latest.snapshot).epoch===m.epoch:m.epoch===0);
    if(sameEpoch)due=Math.max(due,Date.parse(latest.created_at)+interval);
    if(due<=now&&!this.db.prepare("SELECT id FROM execution_jobs WHERE monitor_id=? AND status IN ('queued','running')").get(id)){
     const skipped=Math.floor((now-due)/interval),key=`schedule:${m.version}:${m.epoch}:${due}`,jobId=randomUUID();
     this.db.prepare("INSERT INTO execution_jobs(id,monitor_id,request_key,origin,snapshot,status,available_at,created_at,missed_slots) VALUES(?,?,?,?,?,'queued',?,?,?) ON CONFLICT(monitor_id,request_key) DO NOTHING").run(jobId,id,key,'scheduled',JSON.stringify(m),now,this.clock(),skipped);
     due+= (skipped+1)*interval;this.prune(id);
    }
    this.db.prepare('INSERT INTO schedule_cursors VALUES(?,?,?,?) ON CONFLICT(monitor_id) DO UPDATE SET version=excluded.version,epoch=excluded.epoch,next_due=excluded.next_due').run(id,m.version,m.epoch,due);
   }
  });
 }
}
