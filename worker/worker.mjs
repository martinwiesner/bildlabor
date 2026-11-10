// Copy this entire file into Cloudflare's Worker editor. No npm/build required.
// Bind D1 as DB; set OPENAI_API_KEY (secret) and ALLOWED_ORIGIN (plain text).
const MODELS = [
  {id:"gpt-image-2.5-flare",label:"GPT Image 2.5 · Flare"},
  {id:"gpt-image-2.5-sunburst",label:"GPT Image 2.5 · Sunburst"},
  {id:"gpt-image-1-mini",label:"GPT Image 1 · Mini"}
];
const SIZES = ["1024x1024","1536x1024","1024x1536"];
const QUALITIES = ["low","medium"];
const MAX_BODY = 12 * 1024 * 1024;
// Reservation and both counters execute in one atomic SQLite statement + trigger.
// Do NOT replace with separate read/check/write calls or eventually consistent KV.
export const RESERVE_SQL = `INSERT OR IGNORE INTO requests(id, code_hash, created_at, status)
SELECT ?, c.hash, ?, 'pending' FROM codes c CROSS JOIN campaign p
WHERE c.hash = ? AND p.id = 1 AND c.enabled = 1 AND p.enabled = 1
AND c.expires_at > ? AND c.used < c.quota AND p.used < p.total_limit
AND NOT EXISTS (SELECT 1 FROM requests r WHERE r.code_hash = c.hash AND r.status = 'pending' AND r.created_at > ?)`;

class PublicError extends Error { constructor(status,message){super(message);this.status=status;} }
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function identify(request){
  const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,"").replace(/[\s-]/g,"").toUpperCase();
  if(!/^[A-F0-9]{32}$/.test(token))throw new PublicError(401,"Der Kurscode ist ungültig.");
  return digest(token);
}
async function statusFor(db,hash){
  const row=await db.prepare(`SELECT c.quota,c.used,c.expires_at,c.enabled,p.enabled AS course_enabled,p.total_limit,p.used AS total_used,p.name
    FROM codes c CROSS JOIN campaign p WHERE c.hash = ? AND p.id = 1`).bind(hash).first();
  if(!row)throw new PublicError(401,"Der Kurscode ist ungültig.");
  if(!row.enabled || !row.course_enabled)throw new PublicError(403,"Der Kurszugang ist pausiert. Bitte frage deine Lehrperson.");
  if(row.expires_at<=Math.floor(Date.now()/1000))throw new PublicError(403,"Dieser Kurscode ist abgelaufen.");
  return {courseName:row.name,remaining:Math.max(0,Math.min(row.quota-row.used,row.total_limit-row.total_used)),models:MODELS,qualities:QUALITIES};
}
async function limitedJSON(request,limit){
  if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json"))throw new PublicError(415,"JSON-Anfrage erwartet.");
  if(Number(request.headers.get("Content-Length"))>limit)throw new PublicError(413,"Die Anfrage ist zu groß.");
  if(!request.body)throw new PublicError(400,"Die Anfrage ist leer.");
  const reader=request.body.getReader(),chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new PublicError(413,"Die Anfrage ist zu groß.");}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const result=JSON.parse(new TextDecoder().decode(bytes));if(!result||typeof result!=="object"||Array.isArray(result))throw Error();return result;}catch{throw new PublicError(400,"Die Anfrage ist kein gültiges JSON-Objekt.");}
}
function validate(body){
  if(typeof body.prompt!=="string"||!body.prompt.trim()||body.prompt.length>4000)throw new PublicError(400,"Der Prompt muss 1 bis 4000 Zeichen enthalten.");
  if(!MODELS.some(m=>m.id===body.model)||!SIZES.includes(body.size)||!QUALITIES.includes(body.quality))throw new PublicError(400,"Dieses Modell, Bildformat oder diese Qualität ist im Kurs nicht freigegeben.");
  if(typeof body.requestId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))throw new PublicError(400,"Ungültige Anfrage-ID.");
  if(body.image!==null && body.image!==undefined){
    if(typeof body.image!=="string")throw new PublicError(400,"Ungültiges Ausgangsbild.");
    const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
    if(!m||m[2].length>Math.ceil(8*1024*1024/3)*4)throw new PublicError(400,"Bitte ein PNG-, JPG- oder WebP-Bild mit höchstens 8 MB verwenden.");
    let bytes;try{bytes=atob(m[2]);}catch{throw new PublicError(400,"Das Ausgangsbild ist beschädigt.");}
    const png=bytes.startsWith("\x89PNG\r\n\x1a\n"),jpg=bytes.startsWith("\xff\xd8\xff"),webp=bytes.startsWith("RIFF")&&bytes.slice(8,12)==="WEBP";
    if(bytes.length>8*1024*1024||!({png,jpeg:jpg,webp}[m[1]]))throw new PublicError(400,"Dateityp oder Dateigröße des Ausgangsbilds ist ungültig.");
  }
}
async function handle(request,env,ctx){
  const path=new URL(request.url).pathname;
  if(path==="/health"&&request.method==="GET")return json({service:"Bildlabor",configured:Boolean(env.DB&&env.OPENAI_API_KEY&&env.ALLOWED_ORIGIN)});
  if(request.method!=="POST")throw new PublicError(405,"Diese HTTP-Methode ist nicht erlaubt.");
  if(!["/session","/generate"].includes(path))throw new PublicError(404,"Dieser Endpunkt existiert nicht.");
  if(!env.DB||!env.OPENAI_API_KEY)throw new PublicError(503,"Das Bildlabor ist noch nicht vollständig eingerichtet.");
  const hash=await identify(request);
  // Pin every invocation to the primary if read replication is enabled later.
  const db=env.DB.withSession ? env.DB.withSession("first-primary") : env.DB;
  const session=await statusFor(db,hash);
  const body=await limitedJSON(request,path==="/session"?1024:MAX_BODY);
  if(path==="/session")return json(session);
  validate(body);
  const now=Math.floor(Date.now()/1000);
  const reserved=await db.prepare(RESERVE_SQL).bind(body.requestId,now,hash,now,now-240).run();
  if(!reserved.meta.changes){
    const fresh=await statusFor(db,hash);
    return json({error:fresh.remaining<=0?"Das Kontingent ist aufgebraucht.":"Ein Versuch läuft bereits, der Zugang wurde geändert oder diese Anfrage wurde schon verarbeitet. Bitte kurz warten.",remaining:fresh.remaining},409);
  }
  const input={model:body.model,prompt:body.prompt.trim(),size:body.size,quality:body.quality,n:1,output_format:"png",safety_identifier:hash};
  if(body.image)input.images=[{image_url:body.image}];
  let result;
  try{
    const upstream=await fetch("https://api.openai.com/v1/images/"+(body.image?"edits":"generations"),{
      method:"POST",headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(180000)
    });
    if(!upstream.ok){
      // Never expose upstream bodies, credentials, prompts or images in errors/logs.
      const error=upstream.status===429?"OpenAI ist ausgelastet oder das API-Guthaben ist aufgebraucht. Bitte informiere deine Lehrperson.":upstream.status===400?"OpenAI konnte diese Bildanfrage nicht ausführen. Bitte prüfe Prompt und Ausgangsbild.":upstream.status===401||upstream.status===403||upstream.status===404?"Das Modell oder der API-Zugang ist für diesen Kurs noch nicht freigeschaltet. Bitte informiere deine Lehrperson.":"OpenAI konnte das Bild gerade nicht erstellen.";
      throw new PublicError(502,error+" Der gestartete Versuch zählt zum Kontingent.");
    }
    const response=await upstream.json();
    if(typeof response.data?.[0]?.b64_json!=="string")throw new PublicError(502,"OpenAI hat kein Bild zurückgegeben. Der gestartete Versuch zählt zum Kontingent.");
    result=response.data[0].b64_json;
  }catch(error){
    ctx.waitUntil(db.prepare("UPDATE requests SET status = 'failed' WHERE id = ?").bind(body.requestId).run().catch(()=>{}));
    const remaining=await statusFor(db,hash).then(s=>s.remaining).catch(()=>0);
    return json({error:error instanceof PublicError?error.message:"Die Bildgenerierung wurde unterbrochen oder hat zu lange gedauert. Der Versuch kann Kosten verursacht haben und bleibt gezählt. Bitte nicht sofort erneut starten.",remaining},error instanceof PublicError?error.status:504);
  }
  ctx.waitUntil(db.prepare("UPDATE requests SET status = 'done' WHERE id = ?").bind(body.requestId).run().catch(()=>{}));
  const remaining=await statusFor(db,hash).then(s=>s.remaining).catch(()=>0);
  return json({image:result,remaining});
}
export default {
  async fetch(request,env,ctx){
    const origin=request.headers.get("Origin");
    // CORS is an additional browser boundary. The unpredictable code is the credential.
    if(!env.ALLOWED_ORIGIN || origin!==env.ALLOWED_ORIGIN)return json({error:"Diese Website ist für den Kursserver nicht freigegeben."},403);
    let response;
    if(request.method==="OPTIONS")response=new Response(null,{status:204});
    else try{response=await handle(request,env,ctx);}catch(error){response=json({error:error instanceof PublicError?error.message:"Der Kursserver ist nicht bereit. Bitte informiere deine Lehrperson."},error instanceof PublicError?error.status:503);}
    response.headers.set("Access-Control-Allow-Origin",origin);
    response.headers.set("Vary","Origin");
    response.headers.set("Access-Control-Allow-Methods","GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers","Authorization, Content-Type");
    response.headers.set("Access-Control-Max-Age","600");
    return response;
  }
};
