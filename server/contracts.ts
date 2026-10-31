import{z}from'zod';
export class Problem extends Error{constructor(public status:number,message:string){super(message);}}
export const fixtures=['catalog','checkout','identity','inventory','webhooks'] as const;
export const ruleSchema=z.object({pointer:z.string().max(120).refine(p=>p===''||/^\/(?:[^~]|~[01])*$/.test(p),'Use a JSON Pointer, for example /data/status'),op:z.enum(['exists','type','equals']),expected:z.union([z.string().max(200),z.number().finite(),z.boolean(),z.null()]).default(null)}).superRefine((r,c)=>{if(r.op==='type'&&!['string','number','boolean','object','array','null'].includes(String(r.expected)))c.addIssue({code:'custom',message:'Choose a JSON type.'});});
export const monitorSchema=z.object({name:z.string().trim().min(3).max(80),group:z.string().trim().min(1).max(40).default('Production'),target:z.string().trim().min(1).max(500),expectedStatus:z.number().int().min(100).max(599).default(200),budgetMs:z.number().int().min(20).max(5000).default(800),intervalSeconds:z.number().int().min(60).max(3600).default(60),failThreshold:z.number().int().min(1).max(5).default(2),recoverThreshold:z.number().int().min(1).max(5).default(2),rules:z.array(ruleSchema).max(12).default([])});
export type MonitorConfig=z.infer<typeof monitorSchema>;
export type Rule=z.infer<typeof ruleSchema>;
export type Observation={status:number;latencyMs:number;body:unknown;error?:string;synthetic:boolean};
export type Assertion={name:string;passed:boolean;expected:string;actual:string};
export type CheckRow={id:string;monitorId:string;key:string;version:number;config:MonitorConfig;status:'passed'|'failed'|'suppressed'|'superseded';httpStatus:number;latencyMs:number;assertions:Assertion[];shape:Record<string,string>;drift:{path:string;before:string;after:string}[];preview:string;error:string|null;synthetic:boolean;createdAt:string};
export type Monitor={id:string;config:MonitorConfig;version:number;epoch:number;paused:boolean;scenario:string;maintenance:boolean;baseline:Record<string,string>|null;failStreak:number;passStreak:number;createdAt:string;updatedAt:string};
