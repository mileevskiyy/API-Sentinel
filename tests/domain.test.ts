import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{Store}from'../server/store.ts';import{fixtureObservation}from'../server/probe.ts';import{evaluate}from'../server/evaluate.ts';import{monitorSchema,Problem,type Observation}from'../server/contracts.ts';import{Scheduler}from'../server/scheduler.ts';
const config={name:'Catalog API',group:'Commerce',target:'fixture:catalog',budgetMs:800,failThreshold:2,recoverThreshold:2,rules:[{pointer:'/status',op:'equals',expected:'ok'},{pointer:'/data/available',op:'type',expected:'boolean'}]};
const good=()=>fixtureObservation('fixture:catalog','healthy'),bad=()=>fixtureObservation('fixture:catalog','outage');

test('consecutive failures open one incident; acknowledgement and confirmed recovery preserve evidence',async()=>{
 const s=new Store();try{const m=s.create(config);await s.run(m.id,'first-good');s.control(m.id,{scenario:'outage'});await s.run(m.id,'bad-first');assert.equal(s.incidents().length,0);await s.run(m.id,'bad-second');assert.equal(s.incidents().length,1);const i=s.incidents()[0];assert.equal(i.status,'open');s.acknowledge(i.id,'Investigating upstream');s.acknowledge(i.id,'Duplicate acknowledgement');assert.equal(s.incidents()[0].note,'Investigating upstream');await s.run(m.id,'bad-third');assert.equal(s.incidents().length,1);s.control(m.id,{scenario:'healthy'});await s.run(m.id,'pass-first');assert.equal(s.incidents()[0].status,'acknowledged');await s.run(m.id,'pass-second');const resolved=s.incidents()[0];assert.equal(resolved.status,'resolved');assert.equal(s.check(resolved.openedCheckId).status,'failed');assert.equal(s.check(resolved.resolvedCheckId!).status,'passed');assert.equal(s.detail(m.id).events.filter(e=>e.action==='incident.acknowledged').length,1);}finally{s.close();}
});

test('a passing response resets a failure streak rather than accumulating isolated failures',async()=>{
 const s=new Store();try{const m=s.create(config);await s.run(m.id,'bad-one-1',async()=>bad());await s.run(m.id,'good-one',async()=>good());await s.run(m.id,'bad-one-2',async()=>bad());assert.equal(s.incidents().length,0);assert.equal(s.monitor(m.id).failStreak,1);}finally{s.close();}
});

test('replayed and concurrent identical request keys record one observation and one transition',async()=>{
 const s=new Store();try{const m=s.create({...config,failThreshold:1});let calls=0;let finish!:(v:Observation)=>void;const probe=()=>{calls++;return new Promise<Observation>(resolve=>finish=resolve);};const a=s.run(m.id,'same-request',probe),b=s.run(m.id,'same-request',probe);await Promise.resolve();await assert.rejects(()=>s.run(m.id,'other-request',probe),(e:any)=>e.status===409);finish(bad());const [ra,rb]=await Promise.all([a,b]);assert.equal(ra.id,rb.id);const rc=await s.run(m.id,'same-request',probe);assert.equal(rc.id,ra.id);assert.equal(calls,1);assert.equal(s.incidents().length,1);assert.equal(s.checks(m.id).length,1);assert.equal(s.monitor(m.id).failStreak,1);}finally{s.close();}
});

test('configuration revision changes supersede an in-flight check without changing its preserved rules',async()=>{
 const s=new Store();try{const m=s.create({...config,failThreshold:1});let finish!:(v:Observation)=>void;const running=s.run(m.id,'old-revision',()=>new Promise(resolve=>finish=resolve));await Promise.resolve();s.update(m.id,1,{...config,expectedStatus:503});finish(bad());const c=await running;assert.equal(c.status,'superseded');assert.equal(c.config.expectedStatus,200);assert.equal(c.version,1);assert.equal(s.monitor(m.id).version,2);assert.equal(s.monitor(m.id).failStreak,0);assert.equal(s.incidents().length,0);assert.throws(()=>s.update(m.id,1,config),(e:any)=>e.status===409);}finally{s.close();}
});

test('pause/resume boundary invalidates an in-flight result even after the monitor is resumed',async()=>{
 const s=new Store();try{const m=s.create({...config,failThreshold:1});let finish!:(v:Observation)=>void;const running=s.run(m.id,'paused-flight',()=>new Promise(resolve=>finish=resolve));await Promise.resolve();s.control(m.id,{paused:true});await assert.rejects(()=>s.run(m.id,'while-paused'),(e:any)=>e.status===409);s.control(m.id,{paused:false});finish(bad());assert.equal((await running).status,'superseded');assert.equal(s.incidents().length,0);}finally{s.close();}
});

test('maintenance records evidence while suppressing incident transitions and resets streak boundaries',async()=>{
 const s=new Store();try{const m=s.create(config);s.control(m.id,{scenario:'outage'});await s.run(m.id,'before-maintenance');s.control(m.id,{maintenance:true});const suppressed=await s.run(m.id,'during-maintenance');assert.equal(suppressed.status,'suppressed');assert.equal(s.monitor(m.id).failStreak,0);s.control(m.id,{maintenance:false});await s.run(m.id,'after-maintenance');assert.equal(s.incidents().length,0);await s.run(m.id,'second-after-maintenance');assert.equal(s.incidents().length,1);}finally{s.close();}
});

test('storage failure rolls back check, request identity, counters, incident and audit together',async()=>{
 const s=new Store();try{const m=s.create(config);await s.run(m.id,'before-failure',async()=>bad());s.db.exec("CREATE TRIGGER fail_incident BEFORE INSERT ON incidents BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");await assert.rejects(()=>s.run(m.id,'failed-transaction',async()=>bad()),/synthetic failure/);assert.equal(s.checks(m.id).length,1);assert.equal(s.monitor(m.id).failStreak,1);assert.equal(s.incidents().length,0);assert.equal((s.db.prepare('SELECT count(*) AS n FROM request_keys WHERE request_key=?').get('failed-transaction') as any).n,0);assert.equal(s.detail(m.id).events.filter(e=>e.action==='incident.opened').length,0);}finally{s.close();}
});

test('shape drift is separately visible even when configured assertions still pass',async()=>{
 const s=new Store();try{const m=s.create({...config,rules:[{pointer:'/status',op:'equals',expected:'ok'}]});const first=await s.run(m.id,'baseline-first');const second=await s.run(m.id,'shape-changed',async()=>fixtureObservation('fixture:catalog','drift'));assert.equal(second.status,'passed');assert.ok(second.drift.some(d=>d.path==='/data/count'&&d.before==='number'&&d.after==='string'));s.approveBaseline(m.id,second.id);assert.equal(s.monitor(m.id).baseline!['/data/count'],'string');assert.equal(s.check(first.id).shape['/data/count'],'number');const other=s.create({...config,name:'Other API'});assert.throws(()=>s.approveBaseline(other.id,first.id),(e:any)=>e.status===409);}finally{s.close();}
});

test('editing rules explicitly supersedes an old incident rather than pretending service recovery',async()=>{
 const s=new Store();try{const m=s.create({...config,failThreshold:1});await s.run(m.id,'failing-before-edit',async()=>bad());s.update(m.id,1,{...config,budgetMs:1000});assert.equal(s.incidents()[0].status,'resolved');assert.match(s.incidents()[0].note,/Configuration changed/);assert.equal(s.incidents()[0].resolvedCheckId,null);}finally{s.close();}
});

test('statistics exclude suppressed checks and use nearest-rank p95 over current-revision results',async()=>{
 const s=new Store();try{const m=s.create(config);for(let i=0;i<20;i++)await s.run(m.id,`stat-check-${i}`,async()=>({...good(),latencyMs:(i+1)*10}));s.control(m.id,{maintenance:true});await s.run(m.id,'suppressed-outlier',async()=>({...good(),latencyMs:4999}));const stats=s.overview().monitors[0].stats;assert.equal(stats.checks,20);assert.equal(stats.p95,190);assert.equal(stats.passRate,100);}finally{s.close();}
});

test('history retention keeps replay tombstones so expired keys cannot repeat observations',async()=>{
 const s=new Store();try{const m=s.create(config);for(let i=0;i<205;i++)await s.run(m.id,`retention-${i}`);assert.equal(s.checks(m.id,1000).length,200);await assert.rejects(()=>s.run(m.id,'retention-0'),(e:any)=>e.status===410);assert.equal(s.checks(m.id,1000).length,200);}finally{s.close();}
});

test('persistent private SQLite reopens with incident and check provenance intact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sentinel-'));try{const path=join(dir,'workspace.sqlite');const a=new Store(path,false);const m=a.create({...config,failThreshold:1});await a.run(m.id,'persistent-check',async()=>bad());const iid=a.incidents()[0].id;a.close();const b=new Store(path,false);assert.equal(b.incidents()[0].id,iid);assert.equal(b.checks(m.id)[0].status,'failed');b.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

test('public demos cannot attach persistent storage or external targets',()=>{
 assert.throws(()=>new Store('/tmp/not-created.sqlite',true),/in-memory/);const s=new Store();try{assert.throws(()=>s.create({...config,target:'https://example.com/api'}),/built-in/);for(let i=0;i<20;i++)s.create({...config,name:`Monitor ${i}`});assert.throws(()=>s.create(config),(e:any)=>e.status===429);}finally{s.close();}
});

test('scheduler deduplicates a polling window, respects pause and waits for interval',async()=>{
 let now=Date.parse('2026-10-31T00:00:00Z');const s=new Store(':memory:',false,()=>new Date(now).toISOString()),scheduler=new Scheduler(s,()=>now);try{const a=s.create(config),b=s.create({...config,name:'Paused API'});s.control(b.id,{paused:true});await Promise.all([scheduler.tick(),scheduler.tick()]);assert.equal(s.checks(a.id).length,1);assert.equal(s.checks(b.id).length,0);await scheduler.tick();assert.equal(s.checks(a.id).length,1);now+=60001;await scheduler.tick();assert.equal(s.checks(a.id).length,2);await scheduler.stop();now+=60001;await scheduler.tick();assert.equal(s.checks(a.id).length,2);}finally{await scheduler.stop();s.close();}
});

test('public demo refuses automatic background scheduling',()=>{const s=new Store();try{assert.throws(()=>new Scheduler(s),/does not run background/);}finally{s.close();}});
