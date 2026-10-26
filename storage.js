'use strict';
const Store=(()=>{
 const scope=new URL('.',location.href).pathname,key='starguide:'+scope;let db;
 function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(key,2);r.onupgradeneeded=()=>{const d=r.result;const rows=d.objectStoreNames.contains('records')?r.transaction.objectStore('records'):d.createObjectStore('records',{keyPath:'id'});if(!rows.indexNames.contains('capturedAt'))rows.createIndex('capturedAt','capturedAt');if(!d.objectStoreNames.contains('images'))d.createObjectStore('images',{keyPath:'id'});if(!d.objectStoreNames.contains('thumbnails')){d.createObjectStore('thumbnails',{keyPath:'id'});const c=r.transaction.objectStore('images').openCursor();c.onsuccess=()=>{if(c.result){r.transaction.objectStore('thumbnails').put({id:c.result.key,thumbnail:c.result.value.thumbnail});c.result.continue()}}}};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=()=>reject(r.error)})}
 async function tx(stores,mode,work){db=db||await open();return new Promise((resolve,reject)=>{const t=db.transaction(stores,mode);let value;try{value=work(t)}catch(e){t.abort();reject(e);return}t.oncomplete=()=>resolve(typeof value==='function'?value():value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('儲存未完成'))})}
 async function save(meta,images){return tx(['records','images','thumbnails'],'readwrite',t=>{t.objectStore('records').put(meta);t.objectStore('images').put({id:meta.id,...images});t.objectStore('thumbnails').put({id:meta.id,thumbnail:images.thumbnail})})}
 async function get(store,id){return tx([store],'readonly',t=>{let out;const r=t.objectStore(store).get(id);r.onsuccess=()=>out=r.result;return()=>out})}
 async function list(offset=0,limit=20){return tx(['records'],'readonly',t=>{const out=[];let skipped=0;const r=t.objectStore('records').index('capturedAt').openCursor(null,'prev');r.onsuccess=()=>{const c=r.result;if(!c)return;if(skipped++<offset){c.continue();return}out.push(c.value);if(out.length<limit)c.continue()};return()=>out})}
 async function remove(id){return tx(['records','images','thumbnails'],'readwrite',t=>{t.objectStore('records').delete(id);t.objectStore('images').delete(id);t.objectStore('thumbnails').delete(id)})}
 function prefs(){try{return JSON.parse(localStorage.getItem(key+':prefs')||'null')||{}}catch{return{}}}
 function setPrefs(p){localStorage.setItem(key+':prefs',JSON.stringify(p))}
 async function migrate(){
  if(localStorage.getItem(key+':migrated'))return;
  // Old version had origin-wide storage. Copy, never delete, and keep the old IDs traceable.
  try{if(!localStorage.getItem(key+':prefs')){let old=JSON.parse(localStorage.getItem('starGuidePrefs')||'null');if(old)setPrefs({fov:old.fov,yaw:old.headingOffset,pitch:old.altitudeOffset,magnitude:old.magnitude,lines:old.constellations})}}catch{}
  if(indexedDB.databases){const ds=await indexedDB.databases();if(!ds.some(x=>x.name==='StarGuideDB')){localStorage.setItem(key+':migrated','1');return}}
  const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('StarGuideDB');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  if(old.objectStoreNames.contains('records')){
   const items=await new Promise((resolve,reject)=>{const r=old.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
   for(const r of items){const id='legacy-'+r.id;if(await get('records',id))continue;await save({id,capturedAt:r.createdAt||new Date(r.id).toISOString(),heading:Number.isFinite(r.heading)?r.heading:null,altitude:Number.isFinite(r.altitude)?r.altitude:null,location:Number.isFinite(r.lat)?{lat:r.lat,lon:r.lon}:null,status:'legacy',message:'舊版紀錄，配對結果未經新版驗證；原圖未保存。',stars:[],source:'legacy'}, {original:r.image,annotated:r.image,thumbnail:r.image})}
  }old.close();localStorage.setItem(key+':migrated','1');
 }
 const dataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});
 async function backup(includeRecords){const out={format:'starguide-backup',schema:1,version:'V1.1.0',createdAt:new Date().toISOString(),prefs:prefs(),records:[]};if(includeRecords){const metas=await list(0,100000);let total=0;for(const m of metas){const ims=await get('images',m.id);total+=(ims.original?.size||0)+(ims.annotated?.size||0);if(total>120*1024*1024)throw new Error('備份超過 120 MB，請先下載部分照片並整理紀錄');out.records.push({meta:m,original:await dataURL(ims.original),annotated:await dataURL(ims.annotated),thumbnail:await dataURL(ims.thumbnail)})}}return out}
 async function restore(data){if(data?.format!=='starguide-backup'||data.schema!==1||!Array.isArray(data.records)||data.records.length>2000)throw new Error('備份格式不正確');
  // Validate all rows before writing any record. Application subsequently sanitizes settings.
  for(const r of data.records){const m=r.meta;if(typeof m?.id!=='string'||m.id.length>200||!Number.isFinite(Date.parse(m.capturedAt)))throw new Error('紀錄日期或識別碼不正確');if(m.location&&(!Number.isFinite(m.location.lat)||Math.abs(m.location.lat)>90||!Number.isFinite(m.location.lon)||Math.abs(m.location.lon)>180))throw new Error('紀錄位置不正確');for(const [k,lo,hi] of [['heading',0,360],['altitude',-90,90],['fov',20,110],['roll',-180,180]])if(m[k]!=null&&(!Number.isFinite(m[k])||m[k]<lo||m[k]>hi))throw new Error('紀錄方向或視角不正確');if(!Array.isArray(m.stars)||m.stars.length>500||m.stars.some(s=>typeof s.name!=='string'||s.name.length>200))throw new Error('星體列表不正確');for(const k of ['original','annotated','thumbnail'])if(typeof r[k]!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r[k]))throw new Error('備份照片格式不支援')}
  let count=0;for(const r of data.records){if(await get('records',r.meta.id))continue;const ims={};for(const k of ['original','annotated','thumbnail'])ims[k]=await (await fetch(r[k])).blob();await save(r.meta,ims);count++}return{count,prefs:data.prefs};
 }
 return{key,prefs,setPrefs,migrate,save,get,list,remove,backup,restore,dataURL};
})();
