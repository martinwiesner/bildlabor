"use strict";
const $ = id => document.getElementById(id);
const initialDate = new Date(Date.now()+7*24*60*60*1000);
initialDate.setMinutes(initialDate.getMinutes()-initialDate.getTimezoneOffset());
$("expiry").value = initialDate.toISOString().slice(0,16);
$("worker-url").value = window.BILDLAB_CONFIG?.workerUrl || "";
let privateCodes="", courseSQL="";
const escapeSQL = text => "'"+text.replaceAll("'","''")+"'";
function download(name,text,type="text/plain") {const url=URL.createObjectURL(new Blob([text],{type:type+";charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function status(id,text,error=false){$(id).textContent=text;$(id).className=error?"error":"success";}
$("codes-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const count=Number($("count").value),quota=Number($("quota").value),total=Number($("total").value),name=$("course-name").value.trim(),expiry=Math.floor(new Date($("expiry").value).getTime()/1000);
  if(!Number.isInteger(count)||count<1||count>200||!Number.isInteger(quota)||quota<1||quota>100||!Number.isInteger(total)||total<1||total>20000||!name||!Number.isFinite(expiry)||expiry<=Date.now()/1000){status("codes-status","Bitte gültige Werte und ein Ablaufdatum in der Zukunft angeben.",true);return;}
  $("create-codes").disabled=true;
  try{
    const batch=crypto.randomUUID().slice(0,8),lines=[`Bildlabor — ${name}`,`Gültig bis: ${new Date(expiry*1000).toLocaleString("de-DE")}`,`Versuche je Code: ${quota}. Gesamtkontingent: ${total}.`,`Privat aufbewahren. Nicht in GitHub hochladen.`,""];
    const statements=[`INSERT INTO campaign(id,name,total_limit,enabled) VALUES(1,${escapeSQL(name)},${total},1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,total_limit=excluded.total_limit,enabled=excluded.enabled;`];
    for(let i=1;i<=count;i++){
      const raw=[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
      const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,"0")).join("");
      const label=`${batch}-${String(i).padStart(3,"0")}`;
      lines.push(`${label}\t${raw.match(/.{1,4}/g).join("-")}`);
      statements.push(`INSERT OR IGNORE INTO codes(hash,label,quota,expires_at) VALUES('${hash}','${label}',${quota},${expiry});`);
    }
    privateCodes=lines.join("\n")+"\n";courseSQL=statements.join("\n")+"\n";$("sql").value=courseSQL;$("codes-output").hidden=false;
    status("codes-status",`${count} Codes vorbereitet. Lade die Codes herunter und führe das SQL in D1 aus, um sie zu aktivieren.`);
  }catch{status("codes-status","Codes konnten nicht erzeugt werden. Öffne diese Seite über HTTPS oder localhost in einem aktuellen Browser.",true);}finally{$("create-codes").disabled=false;}
});
$("download-codes").addEventListener("click",()=>download("kurscodes-privat.txt",privateCodes));
$("download-sql").addEventListener("click",()=>download("kursdaten.sql",courseSQL));
$("copy-sql").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(courseSQL);status("codes-status","SQL kopiert. Jetzt in der D1 Console ausführen.");}catch{$("sql").select();status("codes-status","Bitte den markierten SQL-Text manuell kopieren.");}});
function workerURL(){const u=new URL($("worker-url").value.trim());if(u.protocol!=="https:"||!u.hostname.endsWith(".workers.dev")||u.username||u.password||u.pathname!=="/"||u.search||u.hash)throw Error("Bitte die HTTPS-Adresse deines workers.dev-Workers ohne Pfad eingeben.");return u.origin;}
$("config-form").addEventListener("submit",event=>{event.preventDefault();try{download("config.js","// Öffentlich. Hier niemals einen API-Key eintragen.\nwindow.BILDLAB_CONFIG = Object.freeze("+JSON.stringify({workerUrl:workerURL(),title:"Bildlabor"},null,2)+");\n","text/javascript");status("config-status","Datei heruntergeladen. Ersetze damit docs/config.js in deinem GitHub-Repository.");}catch(err){status("config-status",err.message,true);}});
$("check-worker").addEventListener("click",async()=>{
  $("check-worker").disabled=true;
  try{const response=await fetch(workerURL()+"/health",{credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok||!data.configured)throw Error("Worker erreichbar, aber D1, API-Key oder ALLOWED_ORIGIN fehlen noch.");status("config-status","Worker verbunden. Prüfe jetzt im Labor einen Kurscode und ein Testbild; erst das bestätigt auch D1 und OpenAI.");}
  catch(err){status("config-status",err.message==="Failed to fetch"?"Keine Verbindung. Prüfe die Worker-Adresse und ALLOWED_ORIGIN. Die Prüfung funktioniert erst von deiner freigegebenen GitHub-Seite aus.":err.message,true);}finally{$("check-worker").disabled=false;}
});
window.addEventListener("pagehide",()=>{privateCodes="";courseSQL="";$("sql").value="";$("codes-output").hidden=true;});
