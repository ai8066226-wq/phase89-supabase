let deferredInstall=null;
const KARWA_BUILD={phase:90,version:"2.8.21"};
const karwaIsNative=!!window.KarwaNative;
let karwaLastVersionCheck=0;

function networkBanner(){
  let b=document.getElementById("networkBanner");
  if(!b){
    b=document.createElement("div");
    b.id="networkBanner";
    b.style.cssText="position:fixed;z-index:99999;top:0;left:0;right:0;padding:9px 16px;text-align:center;font:600 13px system-ui;background:#fff3cd;color:#664d03;display:none";
    document.body.appendChild(b);
  }
  b.textContent=navigator.onLine?"تم استعادة الاتصال بالإنترنت":"أنت غير متصل بالإنترنت — سيستخدم كروة النسخة المحلية حتى عودة الشبكة";
  b.style.display=navigator.onLine?"none":"block";
}

function updateBanner(){
  let b=document.getElementById("karwaUpdateBanner");
  if(b)return b;
  b=document.createElement("div");
  b.id="karwaUpdateBanner";
  b.style.cssText="position:fixed;z-index:100000;left:14px;right:14px;bottom:18px;max-width:520px;margin:auto;background:#0b1015;color:#fff;border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 50px rgba(0,0,0,.28);border-radius:16px;padding:12px 14px;display:none;direction:rtl;font:600 13px system-ui";
  b.innerHTML='<strong>يتوفر تحديث جديد لكروة</strong><span style="display:block;opacity:.75;margin-top:3px">سيُستخدم تلقائيًا عند فتح الصفحة لاحقًا.</span>';
  document.body.appendChild(b);
  return b;
}

function key(v){return `${Number(v?.phase||0)}-${String(v?.version||"")}`}

function hideUpdateBanner(){
  const b=document.getElementById("karwaUpdateBanner");
  if(b)b.style.display="none";
}

function showUpdateBannerOnce(remoteKey){
  const storageKey=`karwa_update_notice_${remoteKey}`;
  let seen=false;
  try{seen=localStorage.getItem(storageKey)==="1"}catch{}
  if(seen){hideUpdateBanner();return}
  const b=updateBanner();
  b.style.display="block";
  try{localStorage.setItem(storageKey,"1")}catch{}
  window.setTimeout(()=>{b.style.display="none"},5500);
}

async function checkKarwaUpdate(force=false){
  if(karwaIsNative||!navigator.onLine)return false;
  const now=Date.now();
  if(!force&&now-karwaLastVersionCheck<120000)return false;
  karwaLastVersionCheck=now;
  try{
    const r=await fetch(`./version.json?check=${now}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
    if(!r.ok)return false;
    const remote=await r.json();
    const remoteKey=key(remote);
    const buildKey=key(KARWA_BUILD);
    if(remoteKey===buildKey){
      hideUpdateBanner();
      return false;
    }
    showUpdateBannerOnce(remoteKey);
    try{
      if("serviceWorker" in navigator){
        const reg=await navigator.serviceWorker.getRegistration();
        await reg?.update();
      }
    }catch{}
    return true;
  }catch{
    return false;
  }
}

window.addEventListener("online",()=>{networkBanner();checkKarwaUpdate(true)});
window.addEventListener("offline",networkBanner);
window.addEventListener("DOMContentLoaded",()=>{networkBanner();setTimeout(()=>checkKarwaUpdate(true),1800)});

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();
  deferredInstall=e;
  document.querySelectorAll("[data-install-karwa]").forEach(x=>x.hidden=false);
});

window.installKarwa=async()=>{
  if(!deferredInstall)return false;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall=null;
  return true;
};

if(!karwaIsNative&&location.protocol!=="file:"&&"serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js?v=98",{updateViaCache:"none"}).then(reg=>reg.update()).catch(console.error));
}

window.KarwaUpdate={check:()=>checkKarwaUpdate(true),build:KARWA_BUILD,native:karwaIsNative};
