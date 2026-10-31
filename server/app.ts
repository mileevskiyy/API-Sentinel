import express from'express';import{randomBytes,createHash,timingSafeEqual}from'node:crypto';import{z,ZodError}from'zod';import{Store}from'./store.ts';import{Problem}from'./contracts.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function createApp(store:Store,options:{schedulerEnabled?:boolean}={}){
 const app=express(),sessions=new Map<string,{csrf:string;expires:number}>(),attempts=new Map<string,{count:number;expires:number}>();
 const password=process.env.OPERATOR_PASSWORD||'';if(!store.publicDemo&&password.length<16)throw Error('Private mode requires OPERATOR_PASSWORD with at least 16 characters.');
 app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cache-Control':'no-store'});const origin=req.get('origin'),allowed=[process.env.APP_ORIGIN,process.env.RENDER_EXTERNAL_URL,'http://127.0.0.1:3400','http://localhost:3400','http://127.0.0.1:5173','http://localhost:5173'];if(origin&&!['GET','HEAD'].includes(req.method)&&!allowed.includes(origin))return next(new Problem(403,'Origin not allowed.'));for(const[k,s]of sessions)if(s.expires<Date.now())sessions.delete(k);const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sentinel_session='))?.slice(17);res.locals.session=cookie?sessions.get(digest(cookie)):undefined;res.locals.sessionHash=cookie?digest(cookie):null;next();});
 app.get('/api/health',(_req,res)=>res.json({status:'ok',application:'API Sentinel',mode:store.publicDemo?'public-demo':'private'}));
 app.get('/api/session',(_req,res)=>res.json({authenticated:Boolean(res.locals.session),publicDemo:store.publicDemo,csrf:res.locals.session?.csrf||''}));
 app.use(['/api/login','/api/demo-login'],(req,_res,next)=>{const key=req.ip||'local';for(const[k,v]of attempts)if(v.expires<Date.now())attempts.delete(k);const entry=attempts.get(key)||{count:0,expires:Date.now()+15*60000};entry.count++;attempts.set(key,entry);if(entry.count>100)return next(new Problem(429,'Too many entry attempts. Try again later.'));next();});
 const enter=(res:express.Response)=>{if(sessions.size>=1000)throw new Problem(429,'Demo session capacity reached.');if(res.locals.sessionHash)sessions.delete(res.locals.sessionHash);const token=randomBytes(32).toString('hex');sessions.set(digest(token),{csrf:randomBytes(32).toString('hex'),expires:Date.now()+7200000});res.cookie('sentinel_session',token,{httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'strict',path:'/',maxAge:7200000});res.json({ok:true});};
 app.post('/api/demo-login',(_req,res)=>{if(!store.publicDemo)throw new Problem(404,'Demo entry is disabled.');enter(res);});
 app.post('/api/login',(req,res)=>{const body=z.object({password:z.string().max(200)}).parse(req.body);if(store.publicDemo||!timingSafeEqual(Buffer.from(digest(body.password),'hex'),Buffer.from(digest(password),'hex')))throw new Problem(401,'Incorrect password.');enter(res);});
 app.use('/api',(req,res,next)=>{if(!res.locals.session)return next(new Problem(401,'Open the workspace to continue.'));if(!['GET','HEAD'].includes(req.method)&&req.get('X-CSRF-Token')!==res.locals.session.csrf)return next(new Problem(403,'Session verification failed. Reload and try again.'));next();});
 app.post('/api/logout',(_req,res)=>{sessions.delete(res.locals.sessionHash);res.clearCookie('sentinel_session',{path:'/'});res.json({ok:true});});
 app.get('/api/workspace',(_req,res)=>res.json({...store.overview(),schedulerEnabled:Boolean(options.schedulerEnabled)}));
 app.post('/api/monitors',(req,res)=>res.status(201).json(store.create(req.body)));
 app.get('/api/monitors/:id',(req,res)=>res.json(store.detail(req.params.id)));
 app.put('/api/monitors/:id',(req,res)=>{const b=z.object({version:z.number().int().positive(),config:z.unknown()}).parse(req.body);res.json(store.update(req.params.id,b.version,b.config));});
 app.patch('/api/monitors/:id/control',(req,res)=>res.json(store.control(req.params.id,z.object({paused:z.boolean().optional(),maintenance:z.boolean().optional(),scenario:z.enum(['healthy','outage','slow','drift']).optional()}).strict().parse(req.body))));
 app.post('/api/monitors/:id/checks',async(req,res)=>{const b=z.object({key:z.string().max(100)}).parse(req.body);res.status(201).json(await store.run(req.params.id,b.key));});
 app.get('/api/checks/:id',(req,res)=>res.json(store.check(req.params.id)));
 app.post('/api/monitors/:id/baseline',(req,res)=>{const b=z.object({checkId:z.string().uuid()}).parse(req.body);res.json(store.approveBaseline(req.params.id,b.checkId));});
 app.post('/api/incidents/:id/acknowledge',(req,res)=>{const b=z.object({note:z.string().trim().max(1000).default('')}).parse(req.body||{});res.json(store.acknowledge(req.params.id,b.note));});
 app.get('/api/monitors/:id/export', (req,res)=>{res.setHeader('Content-Disposition','attachment; filename="api-sentinel-monitor.json"');res.json({schemaVersion:1,exportedAt:new Date().toISOString(),...store.detail(req.params.id)});});
 app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 app.use((e:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(e instanceof ZodError)return res.status(400).json({error:e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});if(e instanceof Problem)return res.status(e.status).json({error:e.message});if(e.type==='entity.too.large')return res.status(413).json({error:'Request is too large.'});if(e.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON.'});console.error('Request failed:',e.message);res.status(500).json({error:'Unexpected server error.'});});
 return app;
}
