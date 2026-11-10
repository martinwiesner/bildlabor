/* No cookies, localStorage, analytics or remote scripts. Session data stays in memory. */
"use strict";
const $ = (id) => document.getElementById(id);
const config = window.BILDLAB_CONFIG || {};
let worker = "", code = "", session = null, reference = null, selected = null, busy = false;
let history = [], previewUrl = "", comparing = false, sessionVersion = 0;
const examples = {
  lamp: "Entwirf eine kompakte, reparierbare Tischleuchte für einen studentischen Arbeitsplatz. Gebogener Aluminiumarm, matter terrakottafarbener Fuß, sichtbare Schraubverbindungen. Dreiviertelansicht, neutraler cremeweißer Hintergrund, weiches Studiolicht. Realistische Produktfotografie, keine Beschriftung.",
  bottle: "Entwirf eine wiederverwendbare Trinkflasche für den Alltag. Griffige, zylindrische Form aus gebürstetem Edelstahl, abnehmbarer dunkelgrüner Silikonring, großer Schraubverschluss. Zeige die Flasche in Dreiviertelansicht vor einem neutralen Hintergrund. Plausible Proportionen und realistische Materialien.",
  material: "Zeige eine Materialstudie einer kleinen tragbaren Lautsprecherbox. Gehäuse aus hellem, geöltem Holz, Front aus grobem dunkelgrauem Textil, zwei klar erkennbare Bedienelemente aus Aluminium. Nahaufnahme auf einem cremeweißen Tisch mit seitlichem Tageslicht. Fokus auf Materialübergänge und Details."
};
try {
  if (config.workerUrl) {
    const url = new URL(config.workerUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || url.username || url.password) throw Error();
    worker = url.origin;
  }
} catch { $("login-status").textContent = "Die Worker-Adresse in config.js ist ungültig. Bitte die Lehrperson informieren."; }
$("setup-notice").hidden = Boolean(worker);
$("login-button").disabled = !worker;
if (!worker) $("login-status").textContent = "Die Kursverbindung ist noch nicht eingerichtet. Du kannst die Oberfläche bereits ausprobieren.";

function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle("error", error); }
function updateButton() {
  $("generate").disabled = busy || !session || session.remaining <= 0;
  $("generate").textContent = busy ? "Bild wird erstellt …" : !session ? "Mit Kurscode anmelden ↗" : session.remaining <= 0 ? "Kontingent aufgebraucht" : "Bild generieren ↗";
  $("generation-fields").disabled = busy;
  $("reuse").disabled = busy;
  if (session) $("quota").textContent = `${session.remaining} Versuche verfügbar`;
}
async function api(path, body, bearer = code) {
  let response;
  try { response = await fetch(worker + path, {method:"POST", headers:{"Content-Type":"application/json", Authorization:"Bearer " + bearer}, body:JSON.stringify(body), cache:"no-store", credentials:"omit", referrerPolicy:"no-referrer"}); }
  catch { throw Error("Verbindung unterbrochen. Ein bereits gestarteter Versuch kann trotzdem zählen. Bitte den Kurscode erneut anmelden, bevor du einen weiteren Versuch startest."); }
  let data;
  try { data = await response.json(); } catch { throw Error("Der Kursserver ist nicht erreichbar oder hat eine ungültige Antwort gesendet."); }
  if (!response.ok) {
    throw Error(data.error || "Die Anfrage konnte nicht ausgeführt werden.");
  }
  return data;
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!worker) return;
  const candidate = $("course-code").value.trim();
  $("login-button").disabled = true; message("login-status", "Kurscode wird geprüft …");
  try {
    const data = await api("/session", {}, candidate);
    code = candidate; session = data; sessionVersion++;
    $("course-code").value = ""; $("access").hidden = true; $("session-bar").hidden = false; $("logout").hidden = false;
    $("course-name").textContent = data.courseName;
    $("connection").textContent = "Mit Kurs verbunden"; $("connection").classList.add("online");
    $("model").replaceChildren(...data.models.map(m => new Option(m.label,m.id)));
    $("quality").replaceChildren(...data.qualities.map(q => new Option({low:"Entwurf",medium:"Standard",high:"Hoch"}[q],q)));
    updateButton(); $("prompt").focus();
  } catch (err) { message("login-status", err.message, true); }
  finally { $("login-button").disabled = false; }
});
function count() { $("char-count").textContent = `${$("prompt").value.length} / 4000`; }
$("prompt").addEventListener("input", count);
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { $("prompt").value = examples[button.dataset.example]; count(); $("prompt").focus(); }));
function clearReference() {
  reference = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = ""; $("reference").value = ""; $("reference-image").removeAttribute("src"); $("reference-preview").hidden = true; $("dropzone").hidden = false;
}
function setReference(file, dataUrl) {
  clearReference(); reference = {name:file.name, dataUrl}; previewUrl = URL.createObjectURL(file);
  $("reference-image").src = previewUrl; $("reference-name").textContent = file.name; $("reference-preview").hidden = false; $("dropzone").hidden = true;
  message("upload-status", "Ausgangsbild hinzugefügt. Beschreibe im Prompt, was erhalten bleiben und was sich ändern soll.");
}
async function readFile(file) {
  if (!file || busy) return;
  const version = sessionVersion;
  try {
    if (!["image/png","image/jpeg","image/webp"].includes(file.type)) throw Error("Bitte eine PNG-, JPG- oder WebP-Datei auswählen.");
    if (file.size > 8 * 1024 * 1024) throw Error("Das Bild ist größer als 8 MB. Bitte verkleinere es zuerst.");
    const bitmap = await createImageBitmap(file);
    const pixels = bitmap.width * bitmap.height; bitmap.close();
    if (pixels > 25_000_000) throw Error("Bitte das Ausgangsbild auf höchstens 25 Megapixel verkleinern.");
    const dataUrl = await new Promise((resolve,reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("Das Bild konnte nicht gelesen werden.")); reader.readAsDataURL(file);});
    if (version === sessionVersion) setReference(file, dataUrl);
  } catch(err) { message("upload-status", err.message || "Das Bild konnte nicht gelesen werden.", true); $("reference").value = ""; }
}
$("reference").addEventListener("change", e => readFile(e.target.files[0]));
$("remove-reference").addEventListener("click", () => { clearReference(); message("upload-status", ""); });
for (const name of ["dragover","dragenter"]) $("dropzone").addEventListener(name, e => {e.preventDefault(); if (!busy) $("dropzone").classList.add("drag");});
$("dropzone").addEventListener("dragleave", () => $("dropzone").classList.remove("drag"));
$("dropzone").addEventListener("drop", e => {e.preventDefault(); $("dropzone").classList.remove("drag"); readFile(e.dataTransfer.files[0]);});
function showResult(item) {
  selected = item; comparing = false;
  $("result-image").src = item.url; $("result-image").alt = "Generiertes Bild: " + item.prompt.slice(0,180); $("result-image").hidden = false;
  $("empty-state").hidden = true; $("result-actions").hidden = false; $("result-title").textContent = "Dein Entwurf.";
  $("result-tag").textContent = "KI-GENERIERT"; $("download").href = item.url; $("download").download = `bildlabor-${item.id.slice(0,8)}.png`;
  $("compare").hidden = !item.referenceUrl; $("compare").textContent = "Ausgangsbild zeigen";
  message("generation-status", `${item.model} · ${item.size} · ${item.quality} · ${item.seconds} s`);
}
function renderHistory() {
  $("history-section").hidden = !history.length;
  $("history").replaceChildren(...history.map((item,index) => {
    const button=document.createElement("button"), img=document.createElement("img"), label=document.createElement("span");
    img.src=item.url; img.alt="Entwurf " + (index+1); label.textContent=item.model.replace("gpt-image-", "GPT ");
    button.append(img,label); button.addEventListener("click",()=>{if(!busy)showResult(item);}); return button;
  }));
}
$("generate-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy || !session || session.remaining <= 0) return;
  const prompt = $("prompt").value.trim(); if (!prompt) {$("prompt").focus(); return;}
  busy = true; updateButton(); $("loading").hidden = false; $("canvas").setAttribute("aria-busy","true");
  message("generation-status", "Anfrage läuft. Bitte nicht mehrfach starten.");
  const started = Date.now(), version = sessionVersion;
  const payload = {requestId:crypto.randomUUID(), prompt, model:$("model").value, size:$("size").value, quality:$("quality").value, image:reference?.dataUrl || null};
  const referenceUrl = reference ? URL.createObjectURL(new Blob([Uint8Array.from(atob(reference.dataUrl.split(",")[1]), c => c.charCodeAt(0))], {type:reference.dataUrl.slice(5,reference.dataUrl.indexOf(";"))})) : null;
  const timer = setInterval(() => {$("elapsed").textContent = `Seit ${Math.floor((Date.now()-started)/1000)} Sekunden …`;},1000);
  try {
    const data = await api("/generate",payload);
    if (version !== sessionVersion) { if(referenceUrl)URL.revokeObjectURL(referenceUrl); return; }
    session.remaining = data.remaining;
    const bytes = Uint8Array.from(atob(data.image), c => c.charCodeAt(0));
    const blob = new Blob([bytes], {type:"image/png"});
    const item = {...payload,image:undefined,blob,url:URL.createObjectURL(blob),referenceUrl,id:payload.requestId,seconds:Math.round((Date.now()-started)/1000)};
    history.unshift(item);
    if(history.length>6){const old=history.pop();URL.revokeObjectURL(old.url);if(old.referenceUrl)URL.revokeObjectURL(old.referenceUrl);}
    showResult(item);renderHistory();
  } catch(err) {
    if(referenceUrl)URL.revokeObjectURL(referenceUrl);
    if(version===sessionVersion){message("generation-status",err.message,true);try{const latest=await api("/session",{});if(version===sessionVersion)session=latest;}catch{}}
  } finally {
    clearInterval(timer); busy=false; $("loading").hidden=true; $("canvas").removeAttribute("aria-busy"); updateButton();
  }
});
$("compare").addEventListener("click", () => {
  if (!selected?.referenceUrl) return; comparing=!comparing;
  $("result-image").src = comparing ? selected.referenceUrl : selected.url;
  $("result-image").alt = comparing ? "Ausgangsbild dieses Versuchs" : "Generierter Entwurf";
  $("compare").textContent = comparing ? "Ergebnis zeigen" : "Ausgangsbild zeigen";
  $("result-tag").textContent = comparing ? "AUSGANGSBILD" : "KI-GENERIERT";
});
$("reuse").addEventListener("click", async () => {
  if (!selected || busy) return;
  await readFile(new File([selected.blob], "entwurf.png",{type:"image/png"})); $("prompt").focus();
});
$("download-notes").addEventListener("click", () => {
  if(!selected)return;
  const text = `Bildlabor\nKI-generierter Entwurf\n\nModell: ${selected.model}\nFormat: ${selected.size}\nQualität: ${selected.quality}\n\nPrompt:\n${selected.prompt}\n`;
  const url = URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="bildlabor-prompt.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function logout() {
  sessionVersion++; code="";session=null;clearReference();
  for(const item of history){URL.revokeObjectURL(item.url);if(item.referenceUrl)URL.revokeObjectURL(item.referenceUrl);}
  history=[];selected=null;$("result-image").removeAttribute("src");$("download").removeAttribute("href");$("result-image").hidden=true;$("empty-state").hidden=false;
  $("result-actions").hidden=true;$("compare").hidden=true;$("session-bar").hidden=true;$("logout").hidden=true;$("access").hidden=false;
  $("connection").textContent="Abgemeldet";$("connection").classList.remove("online");$("prompt").value="";count();
  $("result-title").textContent="Raum für deine Idee.";$("result-tag").textContent="ARBEITSFLÄCHE";
  message("generation-status","");message("upload-status","");message("login-status","Abgemeldet. Bilder und Kurscode wurden aus dieser Sitzung entfernt.");renderHistory();updateButton();
}
$("logout").addEventListener("click",logout);
window.addEventListener("pagehide",logout);
updateButton();
