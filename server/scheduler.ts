import{Store}from'./store.ts';
import{Problem}from'./contracts.ts';
/** Single-process polling; manual checks and pause state share the same execution gate. */
export class Scheduler{
 private timer?:ReturnType<typeof setInterval>;private running:Promise<void>|null=null;private stopped=false;
 constructor(private store:Store,private clock=Date.now){if(store.publicDemo)throw new Error('The public demo does not run background checks.');}
 start(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick().catch(e=>console.error('Scheduler tick failed:',e.message));},5000);this.timer.unref();}
 tick(){if(this.stopped)return Promise.resolve();if(this.running)return this.running;
  this.running=(async()=>{const now=this.clock();for(const m of this.store.overview().monitors){if(this.stopped)break;if(m.paused)continue;const latest=this.store.checks(m.id,200).find(c=>c.version===m.version);if(latest&&now-Date.parse(latest.createdAt)<m.config.intervalSeconds*1000)continue;const key=`schedule:${m.version}:${Math.floor(now/(m.config.intervalSeconds*1000))}`;try{await this.store.run(m.id,key);}catch(e){if(!(e instanceof Problem&&[409,429].includes(e.status)))console.error('Scheduled check failed:',(e as Error).message);}}})().finally(()=>{this.running=null;});return this.running;
 }
 async stop(){this.stopped=true;clearInterval(this.timer);await this.running;}
}
