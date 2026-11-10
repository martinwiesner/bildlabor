import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import worker from '../worker/worker.mjs';
const origin='https://example.github.io';
const token='0123456789ABCDEF0123456789ABCDEF';
const hash=s=>createHash('sha256').update(s).digest('hex');
const originalFetch=globalThis.fetch;
function fixture({quota=3,total=10,expires=Math.floor(Date.now()/1000)+3600}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../docs/schema.sql',import.meta.url),'utf8'));
  sql.prepare('INSERT INTO campaign(id,name,total_limit) VALUES(1,?,?)').run('Testkurs',total);
  const addCode=(value,limit=quota)=>sql.prepare('INSERT INTO codes(hash,label,quota,expires_at) VALUES(?,?,?,?)').run(hash(value),value.slice(0,4),limit,expires);
  addCode(token);
  const DB={prepare(query){return{bind(...args){return{async first(){return sql.prepare(query).get(...args)||null;},async run(){return{meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}};}};}};
  const pending=[],ctx={waitUntil(p){pending.push(p);}},env={DB,OPENAI_API_KEY:'test-key-never-real',ALLOWED_ORIGIN:origin};
  let calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({data:[{b64_json:'aW1hZ2U='}]});};
  const body=()=>({requestId:randomUUID(),prompt:'Eine Tischleuchte',model:'gpt-image-2.5-flare',quality:'low',size:'1024x1024',image:null});
  async function call(path='/generate',data=body(),auth=token,headers={}){return worker.fetch(new Request('https://worker.example'+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+auth,'Content-Type':'application/json',...headers},body:JSON.stringify(data)}),env,ctx);}
  return{sql,addCode,env,ctx,call,body,calls,async close(){await Promise.all(pending);sql.close();globalThis.fetch=originalFetch;}};
}
test('login, text generation, server-only key and remaining count',async()=>{const f=fixture();try{
  const login=await f.call('/session',{});assert.equal(login.status,200);assert.equal((await login.json()).remaining,3);
  const res=await f.call();assert.equal(res.status,200);const data=await res.json();assert.equal(data.remaining,2);assert.equal(data.image,'aW1hZ2U=');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.headers.Authorization,'Bearer test-key-never-real');assert.ok(!JSON.stringify(data).includes('test-key'));
  const sent=JSON.parse(f.calls[0].options.body);assert.equal(sent.n,1);assert.equal(sent.output_format,'png');assert.equal(sent.safety_identifier,hash(token));
}finally{await f.close();}});
test('invalid, expired and disabled credentials do not call OpenAI',async()=>{const f=fixture();try{
  assert.equal((await f.call('/session',{},'bad')).status,401);
  assert.equal((await f.call('/session',{},'F'.repeat(32))).status,401);
  f.sql.exec('UPDATE codes SET expires_at=1');assert.equal((await f.call()).status,403);
  f.sql.exec('UPDATE codes SET expires_at=9999999999; UPDATE campaign SET enabled=0');assert.equal((await f.call()).status,403);assert.equal(f.calls.length,0);
}finally{await f.close();}});
test('CORS rejects missing or different origin and supports preflight',async()=>{const f=fixture();try{
  assert.equal((await f.call('/session',{},token,{Origin:'https://evil.example'})).status,403);
  assert.equal((await worker.fetch(new Request('https://worker/session'),f.env,f.ctx)).status,403);
  const res=await worker.fetch(new Request('https://worker/generate',{method:'OPTIONS',headers:{Origin:origin}}),f.env,f.ctx);assert.equal(res.status,204);assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(f.calls.length,0);
}finally{await f.close();}});
test('prompt, model, quality, size, image and request ID are validated before charging',async()=>{const f=fixture();try{
  for(const change of [{prompt:''},{prompt:'x'.repeat(4001)},{model:'unlimited'},{quality:'high'},{size:'4096x4096'},{requestId:'bad'},{image:'https://evil.example/image.png'},{image:'data:image/png;base64,aGVsbG8='}])assert.equal((await f.call('/generate',{...f.body(),...change})).status,400);
  assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT used FROM campaign').get().used,0);
}finally{await f.close();}});
test('reference image uses the JSON edits endpoint with an image data URL',async()=>{const f=fixture();try{
  const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  assert.equal((await f.call('/generate',{...f.body(),image})).status,200);
  assert.ok(f.calls[0].url.endsWith('/edits'));assert.equal(JSON.parse(f.calls[0].options.body).images[0].image_url,image);
}finally{await f.close();}});
test('same request ID cannot spend twice',async()=>{const f=fixture();try{
  const b=f.body();assert.equal((await f.call('/generate',b)).status,200);assert.equal((await f.call('/generate',b)).status,409);assert.equal(f.calls.length,1);
}finally{await f.close();}});
test('per-code quota remains enforced after successful requests',async()=>{const f=fixture({quota:1});try{
  assert.equal((await f.call()).status,200);assert.equal((await f.call()).status,409);assert.equal(f.calls.length,1);
}finally{await f.close();}});
test('concurrent requests from one code allow only one OpenAI call',async()=>{const f=fixture();try{
  const fastFetch=globalThis.fetch;globalThis.fetch=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,50));return fastFetch(...args);};
  const responses=await Promise.all(Array.from({length:20},()=>f.call()));assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(f.calls.length,1);assert.equal(f.sql.prepare('SELECT used FROM campaign').get().used,1);
}finally{await f.close();}});
test('global quota is atomic across different codes',async()=>{const f=fixture({total:2});try{
  const codes=[token,'A'.repeat(32),'B'.repeat(32),'C'.repeat(32)];codes.slice(1).forEach(c=>f.addCode(c));
  const responses=await Promise.all(codes.map(c=>f.call('/generate',f.body(),c)));assert.equal(responses.filter(r=>r.status===200).length,2);assert.equal(f.calls.length,2);assert.equal(f.sql.prepare('SELECT used FROM campaign').get().used,2);
}finally{await f.close();}});
test('API errors consume one attempt, expose no raw error and permit the next distinct attempt',async()=>{const f=fixture();try{
  globalThis.fetch=async()=>Response.json({error:{message:'sensitive-upstream-body'}},{status:429});
  const res=await f.call();assert.equal(res.status,502);const data=await res.json();assert.equal(data.remaining,2);assert.ok(!data.error.includes('sensitive'));assert.equal(f.sql.prepare('SELECT status FROM requests').get().status,'failed');
}finally{await f.close();}});
test('body limits and missing configuration fail closed',async()=>{const f=fixture();try{
  assert.equal((await f.call('/session',{extra:'x'.repeat(1025)})).status,413);
  assert.equal((await f.call('/session',{},token,{'Content-Type':'text/plain'})).status,415);
  delete f.env.OPENAI_API_KEY;assert.equal((await f.call()).status,503);assert.equal(f.calls.length,0);
}finally{await f.close();}});
test('database failures never fall through to OpenAI',async()=>{const f=fixture();try{
  f.env.DB={prepare(){throw Error('db down');}};assert.equal((await f.call()).status,503);assert.equal(f.calls.length,0);
}finally{await f.close();}});
