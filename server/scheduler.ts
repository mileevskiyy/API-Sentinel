import{Store}from'./store.ts';
import{Problem}from'./contracts.ts';
/** SQLite job leases survive restart; public mode drains explicitly queued fixture work only. */
export class Scheduler{
 private timer?:ReturnType<typeof setInterval>;private running:Promise<void>|null=null;private stopped=false;
 constructor(private store:Store,private clock=Date.now,private automatic=true){if(store.publicDemo&&automatic)throw new Error('The public demo does not run background interval checks.');}
 start(){if(this.timer)return;void this.tick().catch(e=>console.error('Worker tick failed:',e.message));this.timer=setInterval(()=>{void this.tick().catch(e=>console.error('Worker tick failed:',e.message));},1000);this.timer.unref();}
 tick(){if(this.stopped)return Promise.resolve();if(this.running)return this.running;
  this.running=(async()=>{if(this.automatic)this.store.jobs.scheduleDue(this.clock());const ids=this.store.jobs.candidates();await Promise.all(ids.map(async id=>{if(this.stopped)return;try{await this.store.executeJob(id);}catch(e){if(!(e instanceof Problem&&[409,429,410].includes(e.status)))console.error('Execution attempt failed:',(e as Error).message);}}));})().finally(()=>{this.running=null;});return this.running;
 }
 async stop(){this.stopped=true;clearInterval(this.timer);await this.running;}
}
