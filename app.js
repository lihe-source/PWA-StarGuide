'use strict';
/* Star Guide V1.1.0 — all astronomy, image processing and storage stay on device. */
const APP_VERSION='1.1.0';
const $=id=>document.getElementById(id);
const defaults={fov:65,yaw:0,pitch:0,declination:0,magnitude:4.5,lines:true,constNames:true,grid:true,night:false,eco:false,camera:'',location:null};
function sanitizePrefs(input={}){
 const p={...defaults};for(const [k,a,b] of [['fov',20,110],['yaw',-180,180],['pitch',-45,45],['declination',-180,180]])if(Number.isFinite(input[k]))p[k]=Core.clamp(input[k],a,b);
 for(const k of ['lines','constNames','grid','night','eco'])if(typeof input[k]==='boolean')p[k]=input[k];
 if([3,4.5,6].includes(input.magnitude))p.magnitude=input.magnitude;
 if(typeof input.camera==='string')p.camera=input.camera.slice(0,200);
 if(validLocation(input.location))p.location={...input.location};return p;
}
function validLocation(p){return p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180}
let prefs=sanitizePrefs(Store.prefs());
const state={page:'observe',mode:'chart',catalog:[],sky:[],constellations:[],vertices:[],lineSky:[],lastSky:0,preview:null,stream:null,cameraToken:0,rawPose:null,pose:null,sensorTime:0,absolute:false,relativeAnchored:false,iosRef:null,selected:null,target:null,busy:false,worker:null,cancel:null,zoom:1,rotation:0,pan:[0,0],follow:false,hits:[],listURLs:[],recordURL:null,record:null,recordImages:null,showOriginal:false,recordOffset:0,pendingImport:null,gpsWatch:null,waitingSW:null,registration:null,started:false};
const canvas=$('sky'),ctx=canvas.getContext('2d');let width=1,height=1,lastFrame=0,toastTimer;
const z2=n=>String(n).padStart(2,'0');
function formatTime(d){return `${z2(d.getFullYear()%100)}/${z2(d.getMonth()+1)}/${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}`}
function localInput(d){return `${d.getFullYear()}-${z2(d.getMonth()+1)}-${z2(d.getDate())}T${z2(d.getHours())}:${z2(d.getMinutes())}`}
const name=s=>s.zh||s.en||(s.hip?'HIP '+s.hip:s.id);
const liveDate=()=>state.preview?new Date(state.preview):new Date();
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000)}
function errorMessage(e){if(e?.name==='QuotaExceededError')return '儲存空間不足，請先備份並整理紀錄。';if(e?.name==='NotAllowedError')return '權限未允許，請在瀏覽器網站設定中開啟。';return e?.message||'操作未完成，請再試一次。'}
function action(fn){return async(...args)=>{try{await fn(...args)}catch(e){console.error(e);toast(errorMessage(e))}}}
function savePrefs(){Store.setPrefs(prefs)}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>{if(d.id!=='busyDialog')d.close()})}
function openDialog(id){closeDialogs();$(id).showModal()}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{if(d.open)return;if(d.id==='recordDialog'){URL.revokeObjectURL(state.recordURL);state.recordURL=null}if(d.id==='importDialog'&&!state.busy)state.pendingImport=null;tryApplyUpdate()}));
function syncSettings(){
 for(const k of ['fov','yaw','pitch','declination','magnitude'])$(k).value=prefs[k];
 for(const k of ['night','eco','lines','constNames','grid'])$(k).checked=prefs[k];
 document.body.classList.toggle('night',prefs.night);$('fovLabel').textContent=prefs.fov+'°';
 if(prefs.location){$('lat').value=prefs.location.lat;$('lon').value=prefs.location.lon}
 updateLocationInfo();
}
function updateLocationInfo(){const l=prefs.location,description=l?`${l.source==='gps'?'GPS':'手動'} ${l.lat.toFixed(4)}°, ${l.lon.toFixed(4)}°${Number.isFinite(l.accuracy)?' · ±'+Math.round(l.accuracy)+' m':''}`:'尚未設定觀測位置';$('locInfo').textContent=description;$('locationBadge').textContent=l?`${l.source==='gps'?'GPS':'手動'} ${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}°`:'選擇觀測位置';state.lastSky=0}
function setLocation(l){prefs.location=l;savePrefs();updateLocationInfo();refreshSky(true)}
function startGPS(){
 if(!navigator.geolocation){toast('此瀏覽器不支援定位，請手動輸入位置。');return}
 if(state.gpsWatch!==null)navigator.geolocation.clearWatch(state.gpsWatch);
 state.gpsWatch=navigator.geolocation.watchPosition(p=>{setLocation({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,source:'gps',updatedAt:new Date(p.timestamp).toISOString()});$('lat').value=p.coords.latitude;$('lon').value=p.coords.longitude},e=>{toast('無法取得 GPS：'+e.message+'；可在設定手動輸入位置。')},{enableHighAccuracy:false,maximumAge:30000,timeout:15000});
}
function onOrientation(e){
 if(![e.alpha,e.beta,e.gamma].every(Number.isFinite))return;
 if(e.absolute!==true&&!Number.isFinite(e.webkitCompassHeading)&&state.absolute&&performance.now()-state.sensorTime<1500)return;
 const angle=screen.orientation?.angle??window.orientation??0,raw=Core.pose(e.alpha,e.beta,e.gamma,angle);
 let fixed=raw,absolute=e.absolute===true;
 if(Number.isFinite(e.webkitCompassHeading)&&(!Number.isFinite(e.webkitCompassAccuracy)||e.webkitCompassAccuracy>=0)){
  const top=Core.pose(e.alpha,e.beta,e.gamma,0).u;
  if(Math.hypot(top[0],top[1])>.2)state.iosRef=Core.delta(Core.azalt(top).az,e.webkitCompassHeading);
  if(state.iosRef!==null){fixed=Core.yaw(raw,state.iosRef);absolute=true}
 }
 state.rawPose=fixed;state.absolute=absolute;state.sensorTime=performance.now();
 state.pose=Core.smooth(state.pose,Core.offset(fixed,prefs.yaw+prefs.declination,prefs.pitch));
}
let orientationListening=false;
async function enableOrientation(){
 if(typeof DeviceOrientationEvent==='undefined'){toast('此裝置沒有方向感測器，仍可使用手動星盤。');return}
 if(typeof DeviceOrientationEvent.requestPermission==='function'){
  const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw new Error('方向權限未允許，請使用手動星盤或重新授權。');
 }
 if(!orientationListening){window.addEventListener('deviceorientation',onOrientation);window.addEventListener('deviceorientationabsolute',onOrientation);orientationListening=true}
 toast('已啟用方向讀取。請先平放手機，再舉起；若偏移請用已知星體校正。');
}
function directionValid(){return !!state.pose&&performance.now()-state.sensorTime<2500&&(state.absolute||state.relativeAnchored)}
function stopCamera(){state.cameraToken++;if(state.stream)state.stream.getTracks().forEach(t=>t.stop());state.stream=null;$('video').srcObject=null;$('capture').disabled=true}
async function enumerateCameras(){
 const list=await navigator.mediaDevices.enumerateDevices();const s=$('cameraSelect');s.replaceChildren(new Option('自動選擇後置鏡頭',''));
 list.filter(x=>x.kind==='videoinput').forEach((d,i)=>s.add(new Option(d.label||'鏡頭 '+(i+1),d.deviceId)));s.value=prefs.camera;
}
async function startCamera(){
 if(!navigator.mediaDevices?.getUserMedia)throw new Error('相機需要 HTTPS 與支援的瀏覽器；請使用 GitHub Pages 網址。');
 stopCamera();const token=state.cameraToken;
 const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{...(prefs.camera?{deviceId:{exact:prefs.camera}}:{facingMode:{ideal:'environment'}}),width:{ideal:1920},height:{ideal:1080}}});
 if(token!==state.cameraToken||document.hidden||state.page!=='observe'||state.mode!=='camera'){stream.getTracks().forEach(t=>t.stop());return}
 state.stream=stream;$('video').srcObject=stream;await $('video').play();
 for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(state.stream===stream){$('capture').disabled=true;toast('相機已中斷，請重新啟用。')}});
 await enumerateCameras();$('capture').disabled=state.busy;
 $('status').textContent='○ 位置推算；拍照後才進行多星幾何配對';
}
async function setMode(mode){
 if(state.busy)return;state.mode=mode;state.selected=null;$('detail').hidden=true;
 if(mode==='camera')state.preview=null;
 $('cameraMode').classList.toggle('selected',mode==='camera');$('chartMode').classList.toggle('selected',mode==='chart');$('video').hidden=mode!=='camera';$('reticle').hidden=mode!=='camera';$('chartControls').hidden=mode!=='chart';
 $('stageCaption').textContent=mode==='chart'?'全天星盤 · 仰視天空，東在左、西在右':'○ 推算位置 · 視角與北方基準需校正';
 refreshSky(true);
 if(mode==='camera'&&state.page==='observe'){try{await startCamera()}catch(e){stopCamera();toast(errorMessage(e));await setMode('chart')}}else stopCamera();
}
async function setPage(page){
 if(state.busy)return;state.page=page;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id===page));document.querySelectorAll('nav button').forEach(e=>{e.classList.toggle('selected',e.dataset.page===page);e.setAttribute('aria-current',e.dataset.page===page?'page':'false')});
 if(page!=='observe')stopCamera();else{resize();if(state.mode==='camera')await startCamera()}
 if(page==='records')await renderRecords(true);if(page==='settings')await storageInfo();
}
function resize(){const r=$('stage').getBoundingClientRect();if(r.width<1||r.height<1)return;width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
new ResizeObserver(resize).observe($('stage'));
function refreshSky(force=false){
 if(!state.catalog.length||!prefs.location)return;
 if(!force&&performance.now()-state.lastSky<5000)return;
 const date=liveDate();state.sky=Core.sky(state.catalog,date,prefs.location);state.lineSky=Core.sky(state.vertices,date,prefs.location).slice(0,state.vertices.length);state.lastSky=performance.now();
 if(state.selected)updateDetail();
}
function project(v){return state.mode==='chart'?Core.chart(v,width,height,state.rotation,state.zoom,state.pan):(directionValid()?Core.project(v,state.pose,width,height,prefs.fov):null)}
function visible(s){return s.alt>=0&&(s.type!=='恆星'||s.mag<=prefs.magnitude)}
function drawGrid(){
 ctx.strokeStyle=prefs.night?'#52201a':'#243c52';ctx.lineWidth=1;ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillStyle=prefs.night?'#9e4d43':'#7e99b0';
 if(state.mode==='chart'){
  for(const alt of (prefs.grid?[0,30,60]:[0])){const center=Core.chart(Core.vec(0,90),width,height,state.rotation,state.zoom,state.pan),r=(90-alt)/90*Math.min(width,height)*.42*state.zoom;ctx.beginPath();ctx.arc(center.x,center.y,r,0,Math.PI*2);ctx.stroke();if(alt)ctx.fillText(alt+'°',center.x+8,center.y-r+13)}
  for(const [az,label] of [[0,'北 N'],[90,'東 E'],[180,'南 S'],[270,'西 W']]){const p=project(Core.vec(az,-5));ctx.fillStyle=prefs.night?'#d66752':az===0?'#edc88d':'#92a5ba';ctx.fillText(label,p.x,p.y+4)}
 }
 if(prefs.grid){ctx.globalAlpha=.5;for(let az=0;az<360;az+=45){ctx.beginPath();let started=false;for(let alt=0;alt<=90;alt+=3){const p=project(Core.vec(az,alt));if(p&&Math.abs(p.x)<width*5&&Math.abs(p.y)<height*5){if(started)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);started=true}else started=false}ctx.stroke()}ctx.globalAlpha=1}
}
const constNames={And:'仙女座',Ant:'唧筒座',Aps:'天燕座',Aqr:'寶瓶座',Aql:'天鷹座',Ara:'天壇座',Ari:'牡羊座',Aur:'御夫座',Boo:'牧夫座',Cae:'雕具座',Cam:'鹿豹座',Cnc:'巨蟹座',CVn:'獵犬座',CMa:'大犬座',CMi:'小犬座',Cap:'摩羯座',Car:'船底座',Cas:'仙后座',Cen:'半人馬座',Cep:'仙王座',Cet:'鯨魚座',Cha:'蝘蜓座',Cir:'圓規座',Col:'天鴿座',Com:'后髮座',CrA:'南冕座',CrB:'北冕座',Crv:'烏鴉座',Crt:'巨爵座',Cru:'南十字座',Cyg:'天鵝座',Del:'海豚座',Dor:'劍魚座',Dra:'天龍座',Equ:'小馬座',Eri:'波江座',For:'天爐座',Gem:'雙子座',Gru:'天鶴座',Her:'武仙座',Hor:'時鐘座',Hya:'長蛇座',Hyi:'水蛇座',Ind:'印第安座',Lac:'蠍虎座',Leo:'獅子座',LMi:'小獅座',Lep:'天兔座',Lib:'天秤座',Lup:'豺狼座',Lyn:'天貓座',Lyr:'天琴座',Men:'山案座',Mic:'顯微鏡座',Mon:'麒麟座',Mus:'蒼蠅座',Nor:'矩尺座',Oct:'南極座',Oph:'蛇夫座',Ori:'獵戶座',Pav:'孔雀座',Peg:'飛馬座',Per:'英仙座',Phe:'鳳凰座',Pic:'繪架座',Psc:'雙魚座',PsA:'南魚座',Pup:'船尾座',Pyx:'羅盤座',Ret:'網罟座',Sge:'天箭座',Sgr:'人馬座',Sco:'天蠍座',Scl:'玉夫座',Sct:'盾牌座',Ser:'巨蛇座',Sex:'六分儀座',Tau:'金牛座',Tel:'望遠鏡座',Tri:'三角座',TrA:'南三角座',Tuc:'杜鵑座',UMa:'大熊座',UMi:'小熊座',Vel:'船帆座',Vir:'室女座',Vol:'飛魚座',Vul:'狐狸座'};
function drawConstellations(){
 if(!prefs.lines&&!prefs.constNames)return;ctx.strokeStyle=prefs.night?'#78352b':'#41677b';ctx.lineWidth=.8;ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillStyle=prefs.night?'#a44b3c':'#73999c';
 for(const c of state.constellations){let sx=0,sy=0,n=0;
  for(const line of c.lines){let prev=null;for(const i of line){const s=state.lineSky[i],p=s&&s.alt>=0?project(s.v):null;if(p&&p.x>=0&&p.y>=45&&p.x<width&&p.y<height-35){sx+=p.x;sy+=p.y;n++}if(p&&prev&&Math.hypot(p.x-prev.x,p.y-prev.y)<Math.max(width,height)*.6&&prefs.lines){ctx.beginPath();ctx.moveTo(prev.x,prev.y);ctx.lineTo(p.x,p.y);ctx.stroke()}prev=p}}
  if(prefs.constNames&&n>=3)ctx.fillText(constNames[c.id]||c.id,sx/n,sy/n+20);
 }
}
function drawStars(){
 state.hits=[];const boxes=[];ctx.textAlign='left';ctx.font='12px system-ui';
 const items=state.sky.filter(s=>visible(s)||s.id===state.selected||s.id===state.target).sort((a,b)=>a.mag-b.mag);
 let labels=0;
 for(const s of items){if(s.alt<0)continue;const p=project(s.v);if(!p||p.x<-20||p.x>width+20||p.y<-20||p.y>height+20)continue;
  const r=s.type==='恆星'?Core.clamp(3.5-s.mag*.42,.8,4.5):s.type==='月球'?6:4;
  ctx.fillStyle=prefs.night?'#c46855':s.type!=='恆星'?'#edc88d':s.ci>.8?'#ffe0bb':s.ci<.1?'#c4ddff':'#e6eef5';ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
  if(s.id===state.selected||s.id===state.target){ctx.strokeStyle=prefs.night?'#d66752':'#84daca';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r+8,0,Math.PI*2);ctx.stroke()}
  state.hits.push({id:s.id,x:p.x,y:p.y});
  if((s.zh||s.en||s.id===state.selected)&&(labels<25||s.id===state.selected)&&p.y>60&&p.y<height-65){const text=(state.mode==='camera'?'○ ':'')+name(s),w=ctx.measureText(text).width,box={x:p.x+8,y:p.y-12,w:w+6,h:17};if(box.x+w<width-4&&!boxes.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y)){ctx.fillStyle=prefs.night?'#ce6253':'#cedee9';ctx.fillText(text,box.x,p.y-2);boxes.push(box);labels++}}
 }
}
function updateHUD(){
 const fresh=!!state.pose&&performance.now()-state.sensorTime<2500,ok=directionValid(),h=state.pose?Core.azalt(state.pose.f):null;
 $('clock').dateTime=liveDate().toISOString();$('clock').textContent=formatTime(liveDate());$('timeMode').textContent=state.preview?'預覽時間 · 非即時天空':'即時 · 裝置當地時間';
 $('heading').textContent=ok?Core.cardinal(h.az)+' '+h.az.toFixed(0)+'°':'—';$('altitude').textContent=fresh?h.alt.toFixed(0)+'°':'—';$('quality').textContent=!fresh?(state.pose?'資料逾時':'未讀到方向'):ok?(state.relativeAnchored?'已知星體校正':'感測器 · 待核對'):'北方基準未知';
 if(ok)$('needle').style.transform=`rotate(${h.az}deg)`;
 if(state.follow&&ok)state.rotation=h.az;
 if(state.target){const target=state.sky.find(s=>s.id===state.target);$('guide').hidden=false;if(target){if(target.alt<0)$('guide').textContent=name(target)+' 目前在地平線下';else if(state.mode==='camera'&&ok){const da=Core.delta(h.az,target.az),dh=target.alt-h.alt;$('guide').textContent=`${name(target)} · ${Math.abs(da)<2?'左右已對準':(da>0?'右轉 ':'左轉 ')+Math.abs(da).toFixed(0)+'°'} · ${Math.abs(dh)<2?'仰角已對準':(dh>0?'抬高 ':'降低 ')+Math.abs(dh).toFixed(0)+'°'}`}else $('guide').textContent=`${name(target)} · ${Core.cardinal(target.az)} ${target.az.toFixed(0)}° · 高度 ${target.alt.toFixed(0)}°`}}else $('guide').hidden=true;
 $('capture').disabled=state.busy||state.mode!=='camera'||!state.stream||$('video').readyState<2;
}
function draw(now){requestAnimationFrame(draw);if(document.hidden||state.page!=='observe'||now-lastFrame<(prefs.eco?100:33))return;lastFrame=now;
 try{refreshSky();updateHUD();ctx.clearRect(0,0,width,height);if(state.mode==='camera'&&!directionValid()){ctx.fillStyle=prefs.night?'#ce6253':'#c9d6e2';ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText('啟用方向或校正已知星體後顯示推算位置',width/2,height/2+50);return}if(!prefs.location){ctx.fillStyle='#92a5ba';ctx.textAlign='center';ctx.font='15px system-ui';ctx.fillText('取得 GPS 或設定觀測位置後開始',width/2,height/2);return}drawGrid();drawConstellations();drawStars()}catch(e){$('status').textContent='星空運算未完成：'+errorMessage(e)}
}
const pointers=new Map();let gesture=null;
canvas.addEventListener('pointerdown',e=>{if(state.mode!=='chart')return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);const ps=[...pointers.values()];gesture={x:e.clientX,y:e.clientY,rotation:state.rotation,pan:[...state.pan],zoom:state.zoom,distance:ps.length===2?Math.hypot(ps[0][0]-ps[1][0],ps[0][1]-ps[1][1]):0,moved:false};state.follow=false;$('follow').textContent='北方固定';$('follow').setAttribute('aria-pressed','false')});
canvas.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,[e.clientX,e.clientY]);const ps=[...pointers.values()],dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;if(Math.abs(dx)+Math.abs(dy)>5)gesture.moved=true;if(ps.length===2&&gesture.distance){state.zoom=Core.clamp(gesture.zoom*Math.hypot(ps[0][0]-ps[1][0],ps[0][1]-ps[1][1])/gesture.distance,1,5)}else if(state.zoom>1.05){state.pan=[Core.clamp(gesture.pan[0]+dx,-width*2,width*2),Core.clamp(gesture.pan[1]+dy,-height*2,height*2)]}else state.rotation=Core.norm(gesture.rotation-dx*.5)});
canvas.addEventListener('pointerup',e=>{const select=state.mode==='camera'||(gesture&&!gesture.moved&&pointers.size===1);pointers.delete(e.pointerId);gesture=null;if(select){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=state.hits.map(s=>({...s,d:Math.hypot(s.x-x,s.y-y)})).filter(s=>s.d<22).sort((a,b)=>a.d-b.d)[0];if(hit)selectObject(hit.id)}});
canvas.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);gesture=null});
canvas.addEventListener('wheel',e=>{if(state.mode!=='chart')return;e.preventDefault();state.zoom=Core.clamp(state.zoom*Math.exp(-e.deltaY*.002),1,5)},{passive:false});
function selectObject(id){state.selected=id;$('detail').hidden=false;updateDetail()}
function updateDetail(){const s=state.sky.find(x=>x.id===state.selected);if(!s)return;$('objectType').textContent=s.type+(s.c?' · '+(constNames[s.c]||s.c):'');$('objectName').textContent=name(s);$('objectInfo').textContent=`方位 ${s.az.toFixed(1)}° · 高度 ${s.alt.toFixed(1)}° · ${s.mag.toFixed(1)} 等${s.phase!==undefined?' · 受光 '+Math.round(s.phase*100)+'%':''}${s.alt<0?' · 地平線下':''}`;$('calibrateStar').hidden=state.mode!=='camera';$('calibrateStar').disabled=!state.rawPose||performance.now()-state.sensorTime>2500||s.alt<0}
function search(){const query=$('searchInput').value.trim().toLowerCase();$('searchResults').replaceChildren();if(!prefs.location){$('searchResults').textContent='請先設定觀測位置。';return}const results=state.sky.filter(s=>!query?(s.alt>0&&(s.zh||s.en)):[s.zh,s.en,s.hip,s.c,constNames[s.c],s.id].some(v=>v&&String(v).toLowerCase().includes(query))).sort((a,b)=>a.mag-b.mag).slice(0,70);for(const s of results){const b=document.createElement('button'),a=document.createElement('span'),d=document.createElement('small');a.textContent=name(s);d.textContent=`${s.alt>=0?Core.cardinal(s.az)+' '+s.alt.toFixed(0)+'°':'地平線下'} · ${s.type}`;b.append(a,d);b.onclick=()=>{$('searchDialog').close();selectObject(s.id)};$('searchResults').append(b)}if(!results.length)$('searchResults').textContent='沒有符合的天體。請試英文、星座名稱或 HIP 編號。'}
function frameFromAngles(az,alt,roll=0){const f=Core.vec(az,alt),r=Core.vec(az+90,0),u=Core.unit(Core.cross(r,f)),a=roll*Core.D;return{f,r:r.map((v,i)=>v*Math.cos(a)+u[i]*Math.sin(a)),u:u.map((v,i)=>v*Math.cos(a)-r[i]*Math.sin(a))}}
function toBlob(c,quality=.92){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('照片轉換失敗')),'image/jpeg',quality))}
function newCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
async function decodeImage(blob){if(window.createImageBitmap)return createImageBitmap(blob,{imageOrientation:'from-image'});return new Promise((resolve,reject)=>{const i=new Image(),u=URL.createObjectURL(blob);i.onload=()=>{URL.revokeObjectURL(u);resolve(i)};i.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('瀏覽器無法讀取此圖片，請轉成 JPEG 或 PNG。'))};i.src=u})}
async function normalizedImage(blob){if(blob.size>25*1024*1024)throw new Error('單張照片請小於 25 MB。');const im=await decodeImage(blob);if(im.width*im.height>80e6){im.close?.();throw new Error('照片尺寸過大，請先縮小。')}const scale=Math.min(1,1600/Math.max(im.width,im.height)),c=newCanvas(im.width*scale,im.height*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);im.close?.();return c}
function startBusy(text,cancellable=false){if(state.busy)throw new Error('請等目前操作完成。');state.busy=true;$('busyText').textContent=text;$('cancelAnalysis').hidden=!cancellable;openDialog('busyDialog');$('capture').disabled=true}
function endBusy(applyUpdate=true){state.busy=false;state.cancel=null;$('busyDialog').close();if(applyUpdate)tryApplyUpdate()}
$('busyDialog').addEventListener('cancel',e=>{e.preventDefault();state.cancel?.()});
function runWorker(c,pred){return new Promise((resolve,reject)=>{const worker=new Worker('./worker.js?v='+APP_VERSION);state.worker=worker;let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();state.worker=null;state.cancel=null;error?reject(error):resolve(result)};const timer=setTimeout(()=>finish(new Error('分析逾時，原圖仍會保留。')),30000);state.cancel=()=>finish(Object.assign(new Error('已取消分析，原圖已保留。'),{name:'AbortError'}));worker.onmessage=e=>finish(null,e.data);worker.onerror=()=>finish(new Error('分析程序無法啟動，原圖仍會保留。'));const image=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);worker.postMessage({pixels:image.data.buffer,width:c.width,height:c.height,pred},[image.data.buffer])})}
async function analyzeAndSave(c,meta,originalBlob){
 let result={status:'unresolved',matches:[]},points=[],pred=[],message='方向或拍攝位置不完整，已保存照片。';const scale=Math.min(1,960/c.width,960/c.height),small=newCanvas(c.width*scale,c.height*scale);small.getContext('2d').drawImage(c,0,0,small.width,small.height);
 if(meta.pose&&validLocation(meta.location)){
  pred=Core.sky(state.catalog,new Date(meta.capturedAt),meta.location).filter(s=>s.type==='恆星'&&s.alt>=0&&s.mag<=6).map(s=>({...s,...Core.project(s.v,meta.pose,small.width,small.height,meta.fov)})).filter(s=>Number.isFinite(s.x)&&s.x>5&&s.x<small.width-5&&s.y>5&&s.y<small.height-5).sort((a,b)=>a.mag-b.mag).slice(0,160);
  try{({result,points}=await runWorker(small,pred));message=result.status==='matched'?`多星配對通過：${result.count} 顆，影像幾何殘差 ${result.rms.toFixed(2)} px（分析尺寸）。此為附近星群配對，仍請核對。`:result.status==='ambiguous'?'有多組相近配對，無法確定星名。':`偵測到 ${points.length} 個候選亮點；未達多星配對條件，不標示為辨識成功。`}catch(e){result={status:e.name==='AbortError'?'cancelled':'unresolved',matches:[]};message=e.message}
 }
 const annotated=newCanvas(c.width,c.height),g=annotated.getContext('2d');g.drawImage(c,0,0);const ratio=c.width/small.width;g.font=`${Math.max(13,c.width/65)}px system-ui`;g.lineWidth=Math.max(1,c.width/700);g.textBaseline='middle';
 const stars=[];
 for(const m of result.matches||[]){const p=points[m.j],s=pred[m.i],x=p.x*ratio,y=p.y*ratio;g.strokeStyle='#84daca';g.fillStyle='#84daca';g.beginPath();g.arc(x,y,7*ratio,0,2*Math.PI);g.stroke();g.strokeStyle='#000';g.lineWidth=3;const text='● '+name(s),labelX=Core.clamp(x+10*ratio,8,c.width-g.measureText(text).width-8),labelY=Core.clamp(y,65,c.height-18);g.strokeText(text,labelX,labelY);g.fillText(text,labelX,labelY);g.lineWidth=Math.max(1,c.width/700);stars.push({id:s.id,name:name(s),az:s.az,alt:s.alt,mag:s.mag,error:m.error})}
 if(result.status!=='matched'){g.strokeStyle='#edc88d';for(const p of points.slice(0,60)){const x=p.x*ratio,y=p.y*ratio,r=4*ratio;g.beginPath();g.moveTo(x,y-r);g.lineTo(x+r,y);g.lineTo(x,y+r);g.lineTo(x-r,y);g.closePath();g.stroke()}}
 const font=Math.max(13,c.width/70);g.font=`${font}px system-ui`;g.fillStyle='#060c17d9';g.fillRect(0,0,c.width,font*3.8);g.fillStyle='#e6eef5';g.fillText(`${formatTime(new Date(meta.capturedAt))}  ${meta.heading===null?'方位未知':Core.cardinal(meta.heading)+' '+meta.heading.toFixed(1)+'°'}  ${meta.altitude===null?'':meta.altitude.toFixed(1)+'°'}  ${result.status==='matched'?'● 多星配對通過':'◇ 未確定星名'}`,10,font*1.2);g.fillStyle='#adbdcf';g.fillText(meta.location?`${meta.location.lat.toFixed(4)}°, ${meta.location.lon.toFixed(4)}° · ${meta.timezone||''}`:'拍攝位置未知',10,font*2.6);
 const thumbnail=newCanvas(280,280*c.height/c.width);thumbnail.getContext('2d').drawImage(annotated,0,0,thumbnail.width,thumbnail.height);
 meta={...meta,width:c.width,height:c.height,status:result.status,message,stars,detected:points.length,analysisVersion:APP_VERSION,rms:result.rms??null};
 const images={original:originalBlob||await toBlob(c),annotated:await toBlob(annotated),thumbnail:await toBlob(thumbnail,.8)};
 try{await Store.save(meta,images)}catch(e){endBusy();downloadBlob(images.original,'StarGuide-unsaved-original.jpg');throw e}
 await openRecord(meta.id);endBusy();toast(result.status==='matched'?'已保存照片與多星配對結果。':'已保存照片；尚未確定星名。');
}
async function capture(){
 if(state.busy||!state.stream||$('video').readyState<2)return;
 // Snapshot synchronously, BEFORE any asynchronous image encoding or analysis.
 const time=new Date(),pose=directionValid()?structuredClone(state.pose):null,l=prefs.location?structuredClone(prefs.location):null,h=pose?Core.azalt(pose.f):null,v=$('video');
 const basis=h?frameFromAngles(h.az,h.alt):null,roll=pose?Math.atan2(Core.dot(pose.r,basis.u),Core.dot(pose.r,basis.r))/Core.D:0;
 const meta={id:time.toISOString()+'-'+crypto.randomUUID(),capturedAt:time.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,location:l,pose,heading:h?.az??null,altitude:h?.alt??null,roll,fov:prefs.fov,source:'camera',direction:state.relativeAnchored?'star-calibrated':state.absolute?'sensor':'unknown'};
 const ratio=width/height,vRatio=v.videoWidth/v.videoHeight,sw=vRatio>ratio?v.videoHeight*ratio:v.videoWidth,sh=vRatio>ratio?v.videoHeight:v.videoWidth/ratio,scale=Math.min(1,1600/Math.max(sw,sh)),c=newCanvas(sw*scale,sh*scale);c.getContext('2d').drawImage(v,(v.videoWidth-sw)/2,(v.videoHeight-sh)/2,sw,sh,0,0,c.width,c.height);
 startBusy('分析拍攝星點',true);try{await analyzeAndSave(c,meta)}catch(e){if(state.busy)endBusy();throw e}
}
async function prepareImport(blob,oldMeta=null){
 if(state.busy)return;if(blob.size>25*1024*1024)throw new Error('單張照片請小於 25 MB。');if(!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('請匯入 JPEG、PNG 或 WebP；HEIC 請先轉成 JPEG。');
 let exif={};try{exif=await readPhotoExif(blob)}catch{}
 state.pendingImport={blob,oldMeta};const l=oldMeta?.location||(Number.isFinite(exif.lat)?{lat:exif.lat,lon:exif.lon}:prefs.location);
 $('photoTime').value=oldMeta?localInput(new Date(oldMeta.capturedAt)):exif.time||'';$('photoLat').value=l?.lat??'';$('photoLon').value=l?.lon??'';$('photoAz').value=oldMeta?.heading??exif.az??'';$('photoAlt').value=oldMeta?.altitude??'';$('photoFov').value=oldMeta?.fov||prefs.fov;$('photoRoll').value=oldMeta?.roll??0;
 $('exifInfo').textContent=oldMeta?'從既有原圖建立新紀錄，舊紀錄不會覆寫。請核對時間、方向及視角。':`已嘗試讀取 EXIF；${exif.time?'找到拍攝時間':'缺少拍攝時間，請填寫'}。${Number.isFinite(exif.lat)?'使用照片 GPS。':'位置暫用目前觀測設定，請核對。'}時間以本裝置時區解讀，跨時區照片請換算。`;
 openDialog('importDialog');
}
function numeric(id,lo,hi,optional=false){const v=$(id).value.trim();if(optional&&v==='')return null;const n=Number(v);if(v===''||!Number.isFinite(n)||n<lo||n>hi)throw new Error('請檢查 '+$(id).closest('label').firstChild.textContent+'。');return n}
async function importSave(){
 const pending=state.pendingImport;if(!pending)return;const d=new Date($('photoTime').value);if(!Number.isFinite(d.getTime()))throw new Error('請填入實際拍攝時間。');
 const lat=numeric('photoLat',-90,90,true),lon=numeric('photoLon',-180,180,true),az=numeric('photoAz',0,360,true),alt=numeric('photoAlt',-90,90,true),roll=numeric('photoRoll',-180,180),fov=numeric('photoFov',20,110);
 if((lat===null)!==(lon===null))throw new Error('經度與緯度需一起填寫或一起留空。');if((az===null)!==(alt===null))throw new Error('方位與仰角需一起填寫或一起留空。');
 const meta={id:new Date().toISOString()+'-'+crypto.randomUUID(),capturedAt:d.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,location:lat===null?null:{lat,lon,source:'photo-manual'},heading:az,altitude:alt,roll,fov,pose:az===null?null:frameFromAngles(az,alt,roll),source:'import',parentId:pending.oldMeta?.id||null,direction:'photo-manual'};
 startBusy('讀取並分析照片',true);state.pendingImport=null;try{const c=await normalizedImage(pending.blob);await analyzeAndSave(c,meta,pending.blob)}catch(e){if(state.busy)endBusy();throw e}
}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
const statusLabel=s=>({matched:'● 多星配對通過',candidate:'◇ 候選星點',ambiguous:'◇ 配對不唯一',unresolved:'尚未確定星名',cancelled:'分析已取消',legacy:'舊版紀錄'})[s]||'尚未確定星名';
async function renderRecords(reset=false){
 if(reset){state.recordOffset=0;state.listURLs.forEach(URL.revokeObjectURL);state.listURLs=[];$('recordsList').replaceChildren()}
 const rows=await Store.list(state.recordOffset,20);if(!rows.length&&reset){const p=document.createElement('p');p.className='empty';p.textContent='還沒有觀測紀錄。拍一張星空，或匯入既有照片。';$('recordsList').append(p)}
 for(const m of rows){const ims=await Store.get('thumbnails',m.id);if(!ims?.thumbnail)continue;const a=document.createElement('article');a.className='record-card';const im=document.createElement('img');const url=URL.createObjectURL(ims.thumbnail);state.listURLs.push(url);im.src=url;im.alt='觀測縮圖';im.loading='lazy';const box=document.createElement('div'),h=document.createElement('h2'),p=document.createElement('p'),b=document.createElement('button');h.textContent=formatTime(new Date(m.capturedAt));p.textContent=statusLabel(m.status);b.textContent='檢視照片';b.className='small';b.onclick=action(()=>openRecord(m.id));box.append(h,p,b);a.append(im,box);$('recordsList').append(a)}
 state.recordOffset+=rows.length;$('moreRecords').hidden=rows.length<20;
}
async function openRecord(id){
 const [m,ims]=await Promise.all([Store.get('records',id),Store.get('images',id)]);if(!m||!ims)throw new Error('找不到此紀錄。');state.record=m;state.recordImages=ims;state.showOriginal=false;
 $('recordTitle').textContent=formatTime(new Date(m.capturedAt));$('recordMeta').textContent=`${m.location?m.location.lat.toFixed(4)+'°, '+m.location.lon.toFixed(4)+'°':'位置未知'} · ${m.heading===null?'方位未知':Number(m.heading).toFixed(1)+'°'} · ${m.timezone||'時區未記錄'}`;$('recordResult').textContent=statusLabel(m.status)+'。'+(m.message||'');$('recordStarList').replaceChildren();for(const s of m.stars||[]){const p=document.createElement('span');p.className='pill';p.textContent=s.name;$('recordStarList').append(p)}
 $('reanalyze').disabled=m.source==='legacy';openDialog('recordDialog');showRecordImage();
}
function showRecordImage(){URL.revokeObjectURL(state.recordURL);state.recordURL=URL.createObjectURL(state.showOriginal?state.recordImages.original:state.recordImages.annotated);$('recordImage').src=state.recordURL;$('toggleOriginal').textContent=state.showOriginal?'查看標示圖':'查看原圖'}
async function storageInfo(){if(navigator.storage?.estimate){const e=await navigator.storage.estimate();$('storageInfo').textContent=`此網站已使用約 ${((e.usage||0)/1048576).toFixed(1)} MB。瀏覽器可能清除未備份的資料。`}else $('storageInfo').textContent='照片保存在此裝置與此網站路徑中，請定期備份。'}
async function exportBackup(records){startBusy('整理備份');try{const b=await Store.backup(records);downloadBlob(new Blob([JSON.stringify(b)],{type:'application/json'}),`StarGuide-${records?'backup':'settings'}-${new Date().toISOString().slice(0,10)}.json`);toast('已建立備份下載。')}finally{endBusy()}}
async function restoreBackup(file){if(!file)return;if(file.size>180*1024*1024)throw new Error('備份檔過大，請分批整理。');startBusy('驗證並匯入備份');try{const d=JSON.parse(await file.text()),r=await Store.restore(d);if(r.prefs){prefs=sanitizePrefs(r.prefs);savePrefs();syncSettings();refreshSky(true)}toast(`已合併 ${r.count} 筆新紀錄，重複紀錄未覆寫。`)}finally{endBusy()}}
function compareVersion(a,b){const aa=a.replace(/^v/i,'').split('.').map(Number),bb=b.replace(/^v/i,'').split('.').map(Number);for(let i=0;i<3;i++)if((aa[i]||0)!==(bb[i]||0))return (aa[i]||0)-(bb[i]||0);return 0}
async function checkUpdate(manual=false){
 if(!navigator.onLine){$('updateStatus').textContent='目前離線，保留已安裝版本。';return}
 try{const r=await fetch('./version.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();if(!/^\d+\.\d+\.\d+$/.test(data.version))throw new Error('版本資料無效');$('latest').textContent='V'+data.version;
  if(compareVersion(data.version,APP_VERSION)>0){$('updateStatus').textContent='發現新版，下載完整離線資源後於閒置時更新。';await state.registration?.update()}else $('updateStatus').textContent='目前已是此部署的最新版本。';
  if(state.registration?.waiting){state.waitingSW=state.registration.waiting;tryApplyUpdate()}
 }catch(e){$('updateStatus').textContent='檢查失敗，保留目前版本。請稍後重試。';if(manual)toast('未能確認最新版本，沒有變更資料。')}
}
function idleForUpdate(){return !state.busy&&!document.querySelector('dialog[open]')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)}
function reloadAfterUpdate(){if(!idleForUpdate()){state.reloadPending=true;return}const key=Store.key+':last-reload';if(sessionStorage.getItem(key)===APP_VERSION)return;sessionStorage.setItem(key,APP_VERSION);state.reloadPending=false;location.reload()}
function tryApplyUpdate(){if(!idleForUpdate())return;if(state.reloadPending){reloadAfterUpdate();return}if(!state.waitingSW)return;$('updateStatus').textContent='新版已備妥，正在重新開啟；觀測紀錄保留。';state.waitingSW.postMessage({type:'ACTIVATE',version:APP_VERSION});state.waitingSW=null}
async function registerSW(){
 if(!('serviceWorker' in navigator)){$('updateStatus').textContent='此瀏覽器不支援離線快取。';return}
 let controlled=!!navigator.serviceWorker.controller;
 const r=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});state.registration=r;
 const observe=()=>{const w=r.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller){state.waitingSW=r.waiting;$('updateStatus').textContent='新版已下載，待操作結束後套用。';tryApplyUpdate()}})};r.addEventListener('updatefound',observe);observe();
 if(r.waiting){state.waitingSW=r.waiting;tryApplyUpdate()}
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!controlled){controlled=true;return}if(state.started)reloadAfterUpdate()});
 await checkUpdate();
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=action(()=>setPage(b.dataset.page)));
$('cameraMode').onclick=action(()=>setMode('camera'));$('chartMode').onclick=action(()=>setMode('chart'));
$('enable').onclick=action(async()=>{const orientation=enableOrientation();startGPS();await Promise.all([orientation,setMode('camera')])});
$('permissions').onclick=action(async()=>{const orientation=enableOrientation();await Promise.all([orientation,setPage('observe').then(()=>setMode('camera'))])});
$('gps').onclick=startGPS;$('manualLocation').onclick=action(()=>{const lat=numeric('lat',-90,90),lon=numeric('lon',-180,180);if(state.gpsWatch!==null){navigator.geolocation.clearWatch(state.gpsWatch);state.gpsWatch=null}setLocation({lat,lon,source:'manual'});toast('已使用手動觀測位置。')});
$('cameraSelect').onchange=action(async()=>{prefs.camera=$('cameraSelect').value;savePrefs();toast('下次啟用相機時使用所選鏡頭，請重新核對視角。')});
$('fov').oninput=()=>{$('fovLabel').textContent=$('fov').value+'°'};
$('saveCalibration').onclick=action(()=>{prefs.fov=numeric('fov',20,110);prefs.yaw=numeric('yaw',-180,180);prefs.pitch=numeric('pitch',-45,45);prefs.declination=numeric('declination',-180,180);savePrefs();state.pose=null;toast('校正已儲存。更換鏡頭或橫直向後請重新核對。')});
$('resetCalibration').onclick=action(()=>{Object.assign(prefs,{yaw:0,pitch:0,declination:0,fov:65});state.relativeAnchored=false;savePrefs();syncSettings();toast('已重設校正。')});
for(const k of ['night','eco','lines','constNames','grid'])$(k).onchange=action(()=>{prefs[k]=$(k).checked;savePrefs();syncSettings()});
$('magnitude').onchange=action(()=>{prefs.magnitude=Number($('magnitude').value);savePrefs()});
$('resetChart').onclick=()=>{state.zoom=1;state.pan=[0,0];state.rotation=0;state.follow=false;$('follow').textContent='北方固定';$('follow').setAttribute('aria-pressed','false')};
$('zoomIn').onclick=()=>state.zoom=Core.clamp(state.zoom*1.35,1,5);$('zoomOut').onclick=()=>{state.zoom=Core.clamp(state.zoom/1.35,1,5);if(state.zoom===1)state.pan=[0,0]};
$('follow').onclick=()=>{if(!directionValid()){toast('請先啟用方向並完成北方基準校正。');return}state.follow=!state.follow;$('follow').textContent=state.follow?'隨鏡頭方向':'北方固定';$('follow').setAttribute('aria-pressed',String(state.follow));if(!state.follow)state.rotation=0};
$('closeDetail').onclick=()=>{state.selected=null;state.target=null;$('detail').hidden=true};$('track').onclick=()=>{state.target=state.selected;$('detail').hidden=true};
$('calibrateStar').onclick=action(()=>{if(!state.rawPose||performance.now()-state.sensorTime>2500)throw new Error('請先啟用方向感測器。');const s=state.sky.find(x=>x.id===state.selected);if(!s||s.alt<0)return;const h=Core.azalt(state.rawPose.f);if(!confirm(`請確認已將「${name(s)}」置於相機中央準星。這是人工校正，不是自動辨識。`))return;prefs.yaw=Core.clamp(Core.delta(h.az,s.az)-prefs.declination,-180,180);prefs.pitch=Core.clamp(s.alt-h.alt,-45,45);state.relativeAnchored=true;state.pose=null;savePrefs();syncSettings();toast('已按此星體校正；仍需核對其他星體與視角。')});
$('searchBtn').onclick=()=>{refreshSky(true);openDialog('searchDialog');search();$('searchInput').focus()};$('searchInput').oninput=search;
$('layers').onclick=()=>{$('previewTime').value=localInput(liveDate());openDialog('layersDialog')};
$('applyTime').onclick=action(async()=>{const d=new Date($('previewTime').value);if(!Number.isFinite(d.getTime())||d.getFullYear()<1900||d.getFullYear()>2100)throw new Error('預覽時間請介於 1900–2100 年。');$('layersDialog').close();await setMode('chart');state.preview=d.toISOString();refreshSky(true)});
$('nowTime').onclick=()=>{state.preview=null;refreshSky(true);$('layersDialog').close()};$('openDisplay').onclick=action(async()=>{$('layersDialog').close();await setPage('settings')});
$('capture').onclick=action(capture);$('cancelAnalysis').onclick=()=>state.cancel?.();$('importPhoto').onclick=()=>{if(!state.busy)$('photoFile').click()};$('photoFile').onchange=action(async()=>{const f=$('photoFile').files[0];$('photoFile').value='';if(f)await prepareImport(f)});$('analyzeImport').onclick=action(importSave);
$('moreRecords').onclick=action(()=>renderRecords());$('toggleOriginal').onclick=()=>{state.showOriginal=!state.showOriginal;showRecordImage()};
$('downloadPhoto').onclick=()=>{const blob=state.showOriginal?state.recordImages.original:state.recordImages.annotated;downloadBlob(blob,`StarGuide-${state.record.capturedAt.replace(/[:.]/g,'-')}-${state.showOriginal?'original':'annotated'}.${blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg'}`)};
$('reanalyze').onclick=action(()=>prepareImport(state.recordImages.original,state.record));
$('deleteRecord').onclick=action(async()=>{if(!confirm('確定刪除此紀錄及其照片？此操作無法復原，請先備份。'))return;await Store.remove(state.record.id);$('recordDialog').close();await renderRecords(true);toast('已刪除此紀錄與照片；只能由先前備份還原。')});
$('backup').onclick=action(()=>exportBackup(true));$('exportSettings').onclick=action(()=>exportBackup(false));$('restore').onclick=()=>$('backupFile').click();$('backupFile').onchange=action(async()=>{const f=$('backupFile').files[0];$('backupFile').value='';await restoreBackup(f)});
$('persist').onclick=action(async()=>{const ok=await navigator.storage?.persist?.();toast(ok?'瀏覽器已允許保留資料，仍建議定期備份。':'瀏覽器未核准保留，請定期匯出備份。')});
$('version').onclick=action(async()=>{await setPage('settings');$('checkUpdate').scrollIntoView({block:'center'});await checkUpdate(true)});$('checkUpdate').onclick=action(()=>checkUpdate(true));
window.addEventListener('focus',()=>{tryApplyUpdate();if(state.started)checkUpdate()});window.addEventListener('online',()=>checkUpdate());document.addEventListener('focusout',()=>setTimeout(tryApplyUpdate,250));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopCamera();state.pose=null;state.rawPose=null;if(state.gpsWatch!==null){navigator.geolocation.clearWatch(state.gpsWatch);state.gpsWatch=null}}else{state.lastSky=0;if(state.page==='observe'&&state.mode==='camera')action(startCamera)();if(prefs.location?.source==='gps')startGPS();tryApplyUpdate()}});
screen.orientation?.addEventListener('change',()=>{state.pose=null;toast('畫面方向已改變，請核對水平視角與星體對齊。')});
async function init(){
 try{await Store.migrate();prefs=sanitizePrefs(Store.prefs())}catch(e){toast('舊資料遷移未完成，原資料未刪除：'+errorMessage(e))}syncSettings();
 const [stars,lines]=await Promise.all([fetch('./stars.json?v='+APP_VERSION).then(r=>{if(!r.ok)throw new Error('星表載入失敗');return r.json()}),fetch('./constellations.json?v='+APP_VERSION).then(r=>r.json())]);state.catalog=stars;
 for(const f of lines.features){const entry={id:f.id,lines:[]};for(const line of f.geometry.coordinates){const indices=[];for(const [ra,dec] of line){indices.push(state.vertices.length);state.vertices.push({id:'v'+state.vertices.length,ra:Core.norm(ra)/15,dec,mag:0})}entry.lines.push(indices)}state.constellations.push(entry)}
 if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission!=='function')await enableOrientation();
 refreshSky(true);resize();requestAnimationFrame(draw);$('status').textContent=`${stars.length.toLocaleString()} 顆恆星 · 月球與七大行星 · 本機運算`;
 registerSW().catch(e=>{$('updateStatus').textContent='離線快取未啟用：'+errorMessage(e)});state.started=true;
 const camera=setMode('camera');if(!prefs.location||prefs.location.source==='gps')startGPS();await camera;
}
action(init)();
