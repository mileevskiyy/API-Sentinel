import{type MonitorConfig,type Observation,type Assertion}from'./contracts.ts';
import{pointerValue,jsonType,shapeOf}from'./probe.ts';
export function evaluate(config:MonitorConfig,observation:Observation,baseline:Record<string,string>|null){
 const assertions:Assertion[]=[{name:'HTTP status',passed:!observation.error&&observation.status===config.expectedStatus,expected:String(config.expectedStatus),actual:observation.error||String(observation.status)},{name:'Response time',passed:!observation.error&&observation.latencyMs<=config.budgetMs,expected:`≤ ${config.budgetMs} ms`,actual:`${observation.latencyMs} ms`}];
 for(const rule of config.rules){const current=pointerValue(observation.body,rule.pointer);let passed=false;
 if(rule.op==='exists')passed=current.found;
 if(rule.op==='type')passed=current.found&&jsonType(current.value)===rule.expected;
 if(rule.op==='equals')passed=current.found&&Object.is(current.value,rule.expected);
 assertions.push({name:`${rule.pointer||'/'} · ${rule.op}`,passed:!observation.error&&passed,expected:rule.op==='exists'?'present':JSON.stringify(rule.expected),actual:current.found?JSON.stringify(current.value)?.slice(0,200)||'undefined':'missing'});
 }
 const shape=shapeOf(observation.body),drift:{path:string;before:string;after:string}[]=[];
 if(baseline&&!observation.error)for(const path of new Set([...Object.keys(baseline),...Object.keys(shape)])){if(baseline[path]!==shape[path])drift.push({path:path||'/',before:baseline[path]||'missing',after:shape[path]||'missing'});}
 return{assertions,shape,drift,passed:assertions.every(a=>a.passed)};
}
