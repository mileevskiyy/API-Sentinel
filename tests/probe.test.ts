import test from'node:test';import assert from'node:assert/strict';import{publicAddress,targetURL,resolvePublic,pointerValue,shapeOf}from'../server/probe.ts';import{evaluate}from'../server/evaluate.ts';import{monitorSchema,ruleSchema}from'../server/contracts.ts';
for(const address of['127.0.0.1','10.0.0.1','172.16.0.5','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','192.0.2.1','224.0.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1'])test(`blocked non-public address: ${address}`,()=>assert.equal(publicAddress(address),false));
for(const address of['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])test(`public address classified: ${address}`,()=>assert.equal(publicAddress(address),true));
for(const target of['http://example.com/api','https://127.0.0.1/api','https://2130706433/api','https://[::1]/api','https://localhost/api','https://service.internal/api','https://example.com:8443/api','https://name:secret@example.com/api','https://example.com/api#fragment','file:///etc/passwd'])test(`unsafe target rejected: ${target}`,()=>assert.throws(()=>targetURL(target,false)));

test('DNS resolution blocks mixed public/private answers before connection',async()=>{
 const resolver:any=async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}];await assert.rejects(()=>resolvePublic('api.example.test',resolver),/DNS returned/);
});
test('validated DNS address is returned for pinned connection lookup',async()=>{
 let calls=0;const resolver:any=async()=>{calls++;return[{address:'1.1.1.1',family:4}];};assert.deepEqual(await resolvePublic('api.example.test',resolver),{address:'1.1.1.1',family:4});assert.equal(calls,1);
});
test('JSON Pointer handles escaped keys, null and arrays without inherited properties',()=>{
 const body={'a/b':{'~key':[null,false,0]}};assert.deepEqual(pointerValue(body,'/a~1b/~0key/2'),{found:true,value:0});assert.deepEqual(pointerValue(body,'/a~1b/~0key/0'),{found:true,value:null});assert.equal(pointerValue({},'/constructor').found,false);assert.equal(pointerValue(body,'/missing').found,false);assert.equal(ruleSchema.safeParse({pointer:'/bad~escape',op:'exists'}).success,false);
});
test('contract assertions distinguish value equality, JSON types and property existence',()=>{
 const config=monitorSchema.parse({name:'Rules API',target:'fixture:catalog',rules:[{pointer:'/zero',op:'equals',expected:0},{pointer:'/flag',op:'type',expected:'boolean'},{pointer:'/empty',op:'exists'}]});const result=evaluate(config,{status:200,latencyMs:50,body:{zero:0,flag:false,empty:null},synthetic:true},null);assert.equal(result.passed,true);assert.equal(evaluate(config,{status:200,latencyMs:50,body:{zero:'0',flag:'false'},synthetic:true},null).passed,false);
});
test('response shape traversal is bounded and arrays use first-element representative shape',()=>{
 const shape=shapeOf({items:[{id:1},{extra:true}],...Object.fromEntries(Array.from({length:300},(_,i)=>['key'+i,i]))});assert.ok(Object.keys(shape).length<=150);assert.equal(shape['/items/0/id'],'number');assert.equal(shape['/items/1/extra'],undefined);
});
