import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
import{Store}from'../server/store.ts';import{Scheduler}from'../server/scheduler.ts';import{LEASE_MS}from'../server/jobs.ts';import{fixtureObservation}from'../server/probe.ts';
const config={name:'Durable catalog',target:'fixture:catalog',failThreshold:1,recoverThreshold:1,intervalSeconds:60};
const bad=fixtureObservation('fixture:catalog','outage');
test('queued jobs survive reopening and preserve their exact monitor snapshot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sentinel-queue-'));let time=Date.parse('2026-11-01T00:00:00Z');const clock=()=>new Date(time).toISOString();
 try{const path=join(dir,'jobs.sqlite'),a=new Store(path,false,clock),m=a.create(config),j=a.jobs.enqueue(m.id,'persisted-job-key');assert.equal(a.jobs.enqueue(m.id,'persisted-job-key').id,j.id);assert.throws(()=>a.jobs.enqueue(m.id,'other-active-job'),(e:any)=>e.status===409);a.close();
  const b=new Store(path,false,clock);try{const worker=new Scheduler(b,()=>time,false);await worker.tick();await worker.stop();const job=b.jobs.job(j.id);assert.equal(job.status,'completed');assert.equal(job.attempt_count,1);assert.equal(b.checks(m.id).length,1);assert.equal(job.lease_token,undefined);assert.equal(job.snapshot,undefined);assert.equal(job.attempts[0].token,undefined);}finally{b.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('expired lease takeover fences the old worker and commits exactly one incident transition',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sentinel-fence-'));let time=Date.parse('2026-11-01T00:00:00Z');const clock=()=>new Date(time).toISOString();
 try{const path=join(dir,'jobs.sqlite'),a=new Store(path,false,clock),m=a.create(config),job=a.jobs.enqueue(m.id,'lease-recovery-key'),first=a.jobs.claim(job.id)!;const b=new Store(path,false,clock);
  try{assert.equal(b.jobs.claim(job.id),null);time+=LEASE_MS+1;const second=b.jobs.claim(job.id)!;assert.equal(second.attempt,2);assert.throws(()=>a.record(first.snapshot,first.key,bad,undefined,first),(e:any)=>e.status===409);assert.equal(b.checks(m.id).length,0);const result=b.record(second.snapshot,second.key,bad,undefined,second);assert.equal(b.jobs.job(job.id).check_id,result.id);assert.equal(b.jobs.job(job.id).attempts[0].status,'abandoned');assert.equal(b.incidents().length,1);assert.equal(b.monitor(m.id).failStreak,1);assert.equal(b.checks(m.id).length,1);}finally{a.close();b.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed storage retries with backoff and commits job, evidence and incident atomically',async()=>{
 let time=Date.parse('2026-11-01T00:00:00Z');const s=new Store(':memory:',false,()=>new Date(time).toISOString());try{const m=s.create(config);s.control(m.id,{scenario:'outage'});const job=s.jobs.enqueue(m.id,'retry-database-key');s.db.exec("CREATE TRIGGER reject_incident BEFORE INSERT ON incidents BEGIN SELECT RAISE(ABORT,'injected storage failure'); END");await assert.rejects(()=>s.executeJob(job.id),/injected/);assert.equal(s.jobs.job(job.id).status,'queued');assert.equal(s.jobs.job(job.id).attempts[0].status,'failed');assert.equal(s.checks(m.id).length,0);assert.equal(s.monitor(m.id).failStreak,0);assert.equal(s.incidents().length,0);assert.equal(s.jobs.claim(job.id),null);s.db.exec('DROP TRIGGER reject_incident');time+=1001;await s.executeJob(job.id);assert.equal(s.jobs.job(job.id).status,'completed');assert.equal(s.jobs.job(job.id).attempt_count,2);assert.equal(s.incidents().length,1);assert.equal(s.monitor(m.id).failStreak,1);}finally{s.close();}
});
test('exhausted worker leases stop retrying and keep an auditable attempt history',()=>{
 let time=Date.parse('2026-11-01T00:00:00Z');const s=new Store(':memory:',false,()=>new Date(time).toISOString());try{const m=s.create(config),j=s.jobs.enqueue(m.id,'exhausted-leases');for(let i=0;i<3;i++){assert.ok(s.jobs.claim(j.id));time+=LEASE_MS+1;}assert.equal(s.jobs.claim(j.id),null);const failed=s.jobs.job(j.id);assert.equal(failed.status,'failed');assert.equal(failed.attempt_count,3);assert.ok(failed.attempts.every((a:any)=>a.status==='abandoned'));assert.equal(s.checks(m.id).length,0);}finally{s.close();}
});
test('pause and configuration changes cancel queued work without probing',async()=>{
 const s=new Store();try{const m=s.create(config),first=s.jobs.enqueue(m.id,'pause-queued-job');s.control(m.id,{paused:true});const worker=new Scheduler(s,Date.now,false);await worker.tick();assert.equal(s.jobs.job(first.id).status,'cancelled');s.control(m.id,{paused:false});const second=s.jobs.enqueue(m.id,'config-queued-job');s.update(m.id,m.version,config);await worker.tick();assert.equal(s.jobs.job(second.id).status,'cancelled');assert.equal(s.checks(m.id).length,0);await worker.stop();}finally{s.close();}
});
test('a queued check measures the current fixture response, not the old fixture scenario',async()=>{
 const s=new Store();try{const m=s.create(config),j=s.jobs.enqueue(m.id,'current-response-key');s.control(m.id,{scenario:'outage'});const result=await s.executeJob(j.id);assert.equal(result.status,'failed');assert.equal(s.incidents().length,1);}finally{s.close();}
});
test('scheduler persists interval cursor, coalesces downtime and never invents backfilled checks',async()=>{
 let time=Date.parse('2026-11-01T00:00:00Z');const s=new Store(':memory:',false,()=>new Date(time).toISOString()),worker=new Scheduler(s,()=>time);try{const m=s.create(config);await worker.tick();time+=5*60000;await worker.tick();assert.equal(s.checks(m.id).length,2);assert.equal(s.jobs.list(m.id)[0].missed_slots,4);assert.ok(s.checks(m.id).every(c=>['2026-11-01T00:00:00.000Z','2026-11-01T00:05:00.000Z'].includes(c.createdAt)));await worker.tick();assert.equal(s.checks(m.id).length,2);}finally{await worker.stop();s.close();}
});
test('database lease admission limits running checks across independent handles',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sentinel-capacity-'));try{const path=join(dir,'jobs.sqlite'),a=new Store(path,false),b=new Store(path,false);try{const jobs=Array.from({length:5},(_,i)=>a.jobs.enqueue(a.create({...config,name:`Lease API ${i}`}).id,`capacity-job-${i}`));for(const job of jobs.slice(0,4))assert.ok(a.jobs.claim(job.id));assert.equal(b.jobs.claim(jobs[4].id),null);assert.equal(b.jobs.job(jobs[4].id).status,'queued');}finally{a.close();b.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('actual process exit after claiming leaves recoverable job state in SQLite',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sentinel-process-'));try{const path=join(dir,'jobs.sqlite'),at=Date.parse('2026-11-01T00:00:00Z');
  const script=`import{Store}from'./server/store.ts';const s=new Store(process.env.JOB_TEST_DB,false,()=>new Date(${at}).toISOString());const m=s.create(${JSON.stringify(config)});const j=s.jobs.enqueue(m.id,'process-exit-key');s.jobs.claim(j.id);process.exit(17);`;
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,JOB_TEST_DB:path},encoding:'utf8'});assert.equal(result.status,17,result.stderr);
  const s=new Store(path,false,()=>new Date(at+LEASE_MS+1).toISOString()),worker=new Scheduler(s,()=>at+LEASE_MS+1,false);try{await worker.tick();const j=s.jobs.list()[0];assert.equal(j.status,'completed');assert.equal(j.attempt_count,2);assert.equal(j.attempts[0].status,'abandoned');assert.equal(s.checks(j.monitor_id).length,1);}finally{await worker.stop();s.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
