import{lookup}from'node:dns/promises';
import{isIP}from'node:net';
import{request as httpsRequest}from'node:https';
import ipaddr from'ipaddr.js';
import{fixtures,Problem,type Observation}from'./contracts.ts';
export function publicAddress(address:string){try{const parsed=ipaddr.process(address);return parsed.range()==='unicast';}catch{return false;}}
export function targetURL(target:string,publicDemo:boolean){
 if(target.startsWith('fixture:')){if(!fixtures.includes(target.slice(8) as any))throw new Problem(400,'Unknown demo endpoint.');return null;}
 if(publicDemo)throw new Problem(400,'The shared demo only probes its built-in endpoints. Use private mode for external HTTPS monitoring.');
 let url:URL;try{url=new URL(target);}catch{throw new Problem(400,'Enter a valid HTTPS URL.');}
 const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))throw new Problem(400,'Only HTTPS on port 443, without credentials or fragments, is supported.');
 if(!hostname.includes('.')&&!isIP(hostname)||hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local')||hostname.endsWith('.internal'))throw new Problem(400,'Only public Internet endpoints are supported.');
 if(isIP(hostname)&&!publicAddress(hostname))throw new Problem(400,'Private, loopback and reserved addresses are not allowed.');
 return url;
}
export async function resolvePublic(host:string,resolver=lookup){
 const normalized=host.replace(/^\[|\]$/g,'');
 const entries=isIP(normalized)?[{address:normalized,family:isIP(normalized)}]:await resolver(normalized,{all:true,verbatim:true});
 if(!entries.length||entries.some(e=>!publicAddress(e.address)))throw new Problem(400,'DNS returned a private or reserved address. Probe blocked.');
 return entries[0];
}
export function fixtureObservation(target:string,scenario:string,tick=0):Observation{
 const family=target.slice(8),base:Record<string,number>={catalog:132,checkout:224,identity:91,inventory:176,webhooks:308};
 let body:unknown={status:'ok',service:family,data:{available:true,count:42},version:'1.0'};
 if(scenario==='outage')return{status:503,latencyMs:base[family]+60,error:undefined,body:{status:'unavailable',service:family},synthetic:true};
 if(scenario==='drift')body={status:'ok',service:family,data:{available:'yes',count:'42'},version:'2.0'};
 return{status:200,latencyMs:scenario==='slow'?1600:base[family]+(tick%7)*9,body,synthetic:true};
}
export async function externalProbe(target:string):Promise<Observation>{
 const start=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const url=targetURL(target,false)!;
  const resolved=await Promise.race([resolvePublic(url.hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS resolution timed out.')),2000);})]);
  clearTimeout(timer);
  return await new Promise<Observation>((resolve,reject)=>{
   const remaining=Math.max(1,Math.ceil(5000-(performance.now()-start)));
   const req=httpsRequest(url,{method:'GET',agent:false,headers:{'User-Agent':'API-Sentinel/0.1','Accept':'application/json','Accept-Encoding':'identity'},signal:AbortSignal.timeout(remaining),lookup:(_host,options,callback)=>{if(typeof options==='object'&&options.all)(callback as any)(null,[resolved]);else callback(null,resolved.address,resolved.family);}},res=>{
    if((res.statusCode||0)>=300&&(res.statusCode||0)<400){res.destroy();reject(Error('Redirects are not followed. Configure the final HTTPS URL.'));return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>262144){res.destroy(Error('Response exceeds 256 KB.'));return;}chunks.push(chunk);});
    res.on('error',reject);res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let body:unknown;try{body=JSON.parse(text);}catch{reject(Error('Response is not valid JSON.'));return;}resolve({status:res.statusCode||0,latencyMs:Math.round(performance.now()-start),body,synthetic:false});});
   });req.on('error',reject);req.end();
  });
 }catch(e){return{status:0,latencyMs:Math.round(performance.now()-start),body:null,error:(e as Error).message.slice(0,240),synthetic:false};}
 finally{clearTimeout(timer);}
}
export function jsonType(value:unknown):string{return value===null?'null':Array.isArray(value)?'array':typeof value;}
export function pointerValue(body:unknown,pointer:string):{found:boolean;value:unknown}{
 let value:any=body;if(!pointer)return{found:true,value};
 for(const part of pointer.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'))){if(value===null||typeof value!=='object'||!Object.prototype.hasOwnProperty.call(value,part))return{found:false,value:undefined};value=value[part];}
 return{found:true,value};
}
export function shapeOf(body:unknown):Record<string,string>{
 const shape:Record<string,string>={};
 function walk(value:unknown,path:string,depth:number){if(Object.keys(shape).length>=150)return;shape[path]=jsonType(value);if(depth>=5||value===null||typeof value!=='object')return;const entries=Array.isArray(value)?value.slice(0,1).map((v)=>['0',v] as const):Object.entries(value);for(const[k,v]of entries){if(Object.keys(shape).length>=150)break;walk(v,path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'),depth+1);}}
 walk(body,'',0);return shape;
}
