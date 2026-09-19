(function(){
  'use strict';
  const APP_VERSION='V1.0.0';
  const $=id=>document.getElementById(id);
  const els={
    camera:$('camera'),stage:$('cameraStage'),overlay:$('overlay'),fallback:$('cameraFallback'),start:$('startBtn'),startHint:$('startHint'),
    capture:$('captureBtn'),calibrate:$('calibrateBtn'),labels:$('labelsBtn'),busy:$('busyLayer'),time:$('hudTime'),heading:$('headingText'),cardinal:$('cardinalText'),
    azimuth:$('azimuthText'),altitude:$('altitudeText'),accuracy:$('accuracyText'),sensor:$('sensorStatus'),gpsDot:$('gpsDot'),quality:$('qualityNotice'),
    compass:$('compassTape'),toast:$('toast'),captureCanvas:$('captureCanvas'),recordsList:$('recordsList'),recordsEmpty:$('recordsEmpty'),clearRecords:$('clearRecordsBtn'),
    calibrationDialog:$('calibrationDialog'),recordDialog:$('recordDialog'),recordPreview:$('recordPreview'),recordTitle:$('recordDialogTitle'),recordMeta:$('recordDialogMeta'),recordStars:$('recordStars'),
    downloadRecord:$('downloadRecordBtn'),closeRecord:$('closeRecordBtn'),fov:$('fovRange'),fovValue:$('fovValue'),headingOffset:$('headingOffset'),headingOffsetValue:$('headingOffsetValue'),
    altitudeOffset:$('altitudeOffset'),altitudeOffsetValue:$('altitudeOffsetValue'),magnitude:$('magnitudeSelect'),constellations:$('constellationToggle'),
    cameraPermission:$('cameraPermission'),locationPermission:$('locationPermission'),motionPermission:$('motionPermission'),currentVersion:$('currentVersion'),latestVersion:$('latestVersion'),
    updateStatus:$('updateStatus'),checkUpdate:$('checkUpdateBtn'),versionBtn:$('versionBtn')
  };
  const state={stream:null,location:null,frame:null,rawFrame:null,heading:null,altitude:null,compassAccuracy:null,labels:true,projected:[],orientationSeen:false,lastDraw:0,worker:null,currentRecord:null,db:null,anim:null,watchId:null,starting:false};
  const prefs=loadPrefs();
  els.fov.value=prefs.fov;els.headingOffset.value=prefs.headingOffset;els.altitudeOffset.value=prefs.altitudeOffset;els.magnitude.value=prefs.magnitude;els.constellations.checked=prefs.constellations;

  function loadPrefs(){
    try{return Object.assign({fov:65,headingOffset:0,altitudeOffset:0,magnitude:2.5,constellations:true},JSON.parse(localStorage.getItem('starGuidePrefs')||'{}'))}catch{return{fov:65,headingOffset:0,altitudeOffset:0,magnitude:2.5,constellations:true}}
  }
  function savePrefs(){localStorage.setItem('starGuidePrefs',JSON.stringify(prefs))}
  function showToast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>els.toast.classList.remove('show'),2600)}
  function formatTime(date=new Date(),seconds=false){
    const p=n=>String(n).padStart(2,'0');
    return `${p(date.getFullYear()%100)}/${p(date.getMonth()+1)}/${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}${seconds?':'+p(date.getSeconds()):''}`;
  }
  function updateClock(){els.time.textContent=formatTime()}
  function degrees(v,digits=0){return Number.isFinite(v)?`${v.toFixed(digits)}°`:'--°'}
  function shortestDelta(a,b){return((b-a+540)%360)-180}
  function lerpAngle(a,b,t){return Astro.norm360(a+shortestDelta(a,b)*t)}

  function buildCompass(){
    els.compass.innerHTML='';
    for(let i=-12;i<=12;i++){
      const tick=document.createElement('span');tick.className='tick'+(i%3===0?' major':'');tick.dataset.offset=String(i*5);
      if(i%3===0){const label=document.createElement('label');tick.append(label)}
      els.compass.append(tick);
    }
  }
  function updateCompass(heading){
    const pxPerDegree=3;
    [...els.compass.children].forEach(tick=>{
      const off=Number(tick.dataset.offset),deg=Astro.norm360(Math.round((heading+off)/5)*5);
      const snapDelta=shortestDelta(heading,deg);
      tick.style.transform=`translateX(${snapDelta*pxPerDegree}px)`;
      const label=tick.querySelector('label');
      if(label)label.textContent=deg===0?'北':deg===90?'東':deg===180?'南':deg===270?'西':String(deg);
    });
  }

  async function startExperience(fullPermission=true){
    if(state.starting)return;state.starting=true;
    els.start.disabled=true;els.start.textContent='正在啟用…';els.startHint.textContent='請依序允許系統權限。';
    const motionPromise=fullPermission?requestMotion():Promise.resolve('skipped');
    const cameraPromise=startCamera();
    const locationPromise=startLocation();
    const [motion,camera,location]=await Promise.allSettled([motionPromise,cameraPromise,locationPromise]);
    if(camera.status==='fulfilled'){
      els.fallback.classList.add('hidden');els.capture.disabled=false;els.calibrate.disabled=false;localStorage.setItem('starGuideSetup','1');
    }else{
      els.cameraPermission.textContent='無法使用';els.startHint.textContent=camera.reason?.message||'無法開啟相機，請檢查權限。';showToast('相機尚未啟用');
    }
    if(motion.status==='rejected')showToast('方向感測未啟用，可在設定重試');
    if(location.status==='rejected')showToast('位置未啟用，暫時無法計算星位');
    els.start.disabled=false;els.start.textContent='重新啟用';state.starting=false;updateSensorStatus();
  }

  async function startCamera(){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('此瀏覽器不支援相機');
    if(state.stream)state.stream.getTracks().forEach(t=>t.stop());
    try{
      state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:24,max:30}}});
      els.camera.srcObject=state.stream;await els.camera.play();els.cameraPermission.textContent='已啟用';return true;
    }catch(error){els.cameraPermission.textContent=error.name==='NotAllowedError'?'已拒絕':'啟用失敗';throw error}
  }

  function getPosition(){return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('裝置不支援定位'));return}
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  })}
  async function startLocation(){
    try{
      const pos=await getPosition();applyPosition(pos);
      if(state.watchId!==null)navigator.geolocation.clearWatch(state.watchId);
      state.watchId=navigator.geolocation.watchPosition(applyPosition,()=>{}, {enableHighAccuracy:true,maximumAge:30000,timeout:20000});
      return true;
    }catch(error){els.locationPermission.textContent=error.code===1?'已拒絕':'定位失敗';throw error}
  }
  function applyPosition(pos){state.location={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy};els.locationPermission.textContent=`已啟用・±${Math.round(pos.coords.accuracy)}m`;els.gpsDot.classList.add('ok');updateSensorStatus()}

  async function requestMotion(){
    try{
      if(typeof DeviceOrientationEvent==='undefined')throw new Error('裝置不支援方向感測');
      if(typeof DeviceOrientationEvent.requestPermission==='function'){
        const result=await DeviceOrientationEvent.requestPermission();
        if(result!=='granted')throw new Error('方向權限未允許');
      }
      attachOrientation();els.motionPermission.textContent='已啟用';return true;
    }catch(error){els.motionPermission.textContent='尚未啟用';throw error}
  }
  function attachOrientation(){window.removeEventListener('deviceorientation',onOrientation,true);window.addEventListener('deviceorientation',onOrientation,true)}
  function onOrientation(event){
    if(event.alpha==null&&event.webkitCompassHeading==null)return;
    state.orientationSeen=true;
    const alpha=Number.isFinite(event.webkitCompassHeading)?Astro.norm360(360-event.webkitCompassHeading):event.alpha;
    const beta=event.beta||0,gamma=event.gamma||0,screenAngle=screen.orientation?.angle||window.orientation||0;
    const fresh=Astro.deviceFrame(alpha,beta,gamma,screenAngle);
    state.rawFrame=Astro.blendFrame(state.rawFrame,fresh,.22);
    const rawHeading=Astro.frameHeading(state.rawFrame),rawAltitude=Astro.frameAltitude(state.rawFrame);
    const heading=Astro.norm360(rawHeading+prefs.headingOffset),altitude=Math.max(-89,Math.min(89,rawAltitude+prefs.altitudeOffset));
    state.heading=state.heading==null?heading:lerpAngle(state.heading,heading,.22);
    state.altitude=state.altitude==null?altitude:state.altitude+(altitude-state.altitude)*.22;
    state.frame=Astro.offsetFrame(state.rawFrame,prefs.headingOffset,prefs.altitudeOffset);
    state.compassAccuracy=Number.isFinite(event.webkitCompassAccuracy)?event.webkitCompassAccuracy:null;
    els.motionPermission.textContent='已啟用';updateSensorStatus();
  }
  function updateSensorStatus(){
    if(state.location&&state.orientationSeen){els.sensor.textContent='GPS＋方向已連線';els.gpsDot.classList.add('ok');els.quality.textContent=state.compassAccuracy>25?'指南針誤差偏高，請進行校正':'即時推算・拍照後確認星點'}
    else if(state.location){els.sensor.textContent='GPS 已連線';els.quality.textContent='請啟用方向感測，才能對準星位'}
    else{els.sensor.textContent='等待 GPS';els.quality.textContent='需要位置與方向才能計算星位'}
  }

  function resizeOverlay(){
    const r=els.stage.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    if(els.overlay.width!==Math.round(r.width*dpr)||els.overlay.height!==Math.round(r.height*dpr)){els.overlay.width=Math.round(r.width*dpr);els.overlay.height=Math.round(r.height*dpr)}
    return{width:r.width,height:r.height,dpr};
  }
  function drawLoop(now){
    state.anim=requestAnimationFrame(drawLoop);
    if(now-state.lastDraw<50)return;state.lastDraw=now;
    const size=resizeOverlay(),ctx=els.overlay.getContext('2d');ctx.setTransform(size.dpr,0,0,size.dpr,0,0);ctx.clearRect(0,0,size.width,size.height);
    if(state.frame&&state.location){
      state.projected=Astro.projectCatalog(STAR_CATALOG,new Date(),state.location.lat,state.location.lon,state.frame,size.width,size.height,prefs.fov,prefs.magnitude);
      if(state.labels)drawConstellations(ctx,state.projected,prefs.constellations),drawStars(ctx,state.projected);
    }else state.projected=[];
    const h=state.heading;els.heading.textContent=Number.isFinite(h)?`${Math.round(h).toString().padStart(3,'0')}°`:'---°';els.cardinal.textContent=Number.isFinite(h)?Astro.cardinal(h):'--';
    els.azimuth.textContent=degrees(h);els.altitude.textContent=degrees(state.altitude);els.accuracy.textContent=state.compassAccuracy==null?'估算':`±${Math.round(state.compassAccuracy)}°`;
    updateCompass(Number.isFinite(h)?h:0);
  }
  function drawConstellations(ctx,stars,enabled=true,scale=1){
    if(!enabled)return;const map=new Map(stars.map(s=>[s.id,s]));ctx.save();ctx.strokeStyle='rgba(140,176,255,.34)';ctx.lineWidth=1*scale;ctx.setLineDash([4*scale,6*scale]);
    CONSTELLATION_LINES.forEach(([a,b])=>{const p=map.get(a),q=map.get(b);if(p&&q){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}});ctx.restore();
  }
  function drawStars(ctx,stars,scale=1,forPhoto=false){
    ctx.save();ctx.textBaseline='middle';
    const occupied=[];
    stars.sort((a,b)=>a.mag-b.mag).forEach(star=>{
      const r=Math.max(2.2,5.4-star.mag)*scale;ctx.beginPath();ctx.arc(star.x,star.y,r,0,Math.PI*2);
      ctx.fillStyle=star.verified?'#64e6ad':'#eaf8ff';ctx.shadowColor=star.verified?'#64e6ad':'#73e4ff';ctx.shadowBlur=9*scale;ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle=star.verified?'rgba(100,230,173,.92)':'rgba(115,228,255,.85)';ctx.lineWidth=1.4*scale;ctx.beginPath();ctx.arc(star.x,star.y,r+4*scale,0,Math.PI*2);ctx.stroke();
      if(!forPhoto&&occupied.some(p=>Math.abs(p.x-star.x)<88&&Math.abs(p.y-star.y)<28))return;
      occupied.push(star);const label=`${star.zh}  ${star.en}`;ctx.font=`${star.mag<1?700:600} ${Math.round(12*scale)}px system-ui`;
      const tw=ctx.measureText(label).width,pad=5*scale,viewWidth=ctx.canvas.width/(ctx.getTransform().a||1),lx=Math.min(star.x+10*scale,viewWidth-tw-pad*2-4),ly=star.y;
      ctx.fillStyle='rgba(2,7,16,.72)';roundRect(ctx,lx,ly-10*scale,tw+pad*2,20*scale,5*scale);ctx.fill();ctx.fillStyle=star.verified?'#8ff0c7':'#effaff';ctx.fillText(label,lx+pad,ly);
    });ctx.restore();
  }
  function roundRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}

  function drawVideoCover(ctx,video,w,h){
    const vw=video.videoWidth||w,vh=video.videoHeight||h,scale=Math.max(w/vw,h/vh),sw=w/scale,sh=h/scale,sx=(vw-sw)/2,sy=(vh-sh)/2;
    ctx.drawImage(video,sx,sy,sw,sh,0,0,w,h);
  }
  async function captureAndAnalyze(){
    if(!state.stream||els.camera.readyState<2){showToast('相機尚未準備完成');return}
    els.busy.hidden=false;els.capture.disabled=true;
    try{
      const stageRect=els.stage.getBoundingClientRect(),w=1280,h=Math.round(w*stageRect.height/stageRect.width),canvas=els.captureCanvas,ctx=canvas.getContext('2d',{willReadFrequently:true});
      canvas.width=w;canvas.height=h;drawVideoCover(ctx,els.camera,w,h);
      const baseData=ctx.getImageData(0,0,w,h),result=await detectPoints(baseData,w,h);
      const sx=w/stageRect.width,sy=h/stageRect.height,stars=state.projected.map(s=>({...s,x:s.x*sx,y:s.y*sy}));
      matchDetectedStars(stars,result.points,result.analysisWidth,result.analysisHeight,w,h);
      drawCaptureHud(ctx,w,h,stars);
      const verified=stars.filter(s=>s.verified),visible=stars.filter(s=>s.x>=0&&s.x<=w&&s.y>=0&&s.y<=h);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
      const record={id:Date.now(),createdAt:new Date().toISOString(),displayTime:formatTime(new Date(),true),heading:state.heading,altitude:state.altitude,lat:state.location?.lat,lon:state.location?.lon,locationAccuracy:state.location?.accuracy,verified:verified.map(compactStar),predicted:visible.slice(0,14).map(compactStar),image:blob};
      await saveRecord(record);await renderRecords();openRecord(record);
      showToast(verified.length?`已比對 ${verified.length} 顆亮星`:'已保存照片；星點不足，結果維持推算');
    }catch(error){console.error(error);showToast('分析未完成，請保持手機穩定後重試')}
    finally{els.busy.hidden=true;els.capture.disabled=false}
  }
  function compactStar(s){return{id:s.id,zh:s.zh,en:s.en,mag:s.mag,verified:!!s.verified,confidence:s.confidence||0}}
  function detectPoints(imageData,w,h){
    const targetW=480,targetH=Math.max(240,Math.round(targetW*h/w)),temp=document.createElement('canvas');temp.width=targetW;temp.height=targetH;
    const tctx=temp.getContext('2d',{willReadFrequently:true});const source=document.createElement('canvas');source.width=w;source.height=h;source.getContext('2d').putImageData(imageData,0,0);tctx.drawImage(source,0,0,targetW,targetH);
    const data=tctx.getImageData(0,0,targetW,targetH);
    return new Promise((resolve,reject)=>{
      const worker=new Worker('./worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('analysis timeout'))},12000);
      worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve({...e.data,analysisWidth:targetW,analysisHeight:targetH})};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(e)};
      worker.postMessage({pixels:data.data.buffer,width:targetW,height:targetH},[data.data.buffer]);
    });
  }
  function matchDetectedStars(stars,points,pw,ph,w,h){
    const rx=pw/w,ry=ph/h,radius=24,candidates=[];
    stars.forEach(star=>{
      const px=star.x*rx,py=star.y*ry;let best=null,bestD=Infinity;
      for(const p of points){const d=Math.hypot(p.x-px,p.y-py);if(d<bestD){best=p;bestD=d}}
      if(best&&bestD<=radius)candidates.push({star,point:best,dx:best.x-px,dy:best.y-py,distance:bestD});
    });
    let consensus=[];
    for(const seed of candidates){
      const group=candidates.filter(c=>Math.hypot(c.dx-seed.dx,c.dy-seed.dy)<=9);
      if(group.length>consensus.length)consensus=group;
    }
    if(consensus.length<2)return;
    const used=new Set();
    consensus.sort((a,b)=>a.distance-b.distance).forEach(c=>{
      if(used.has(c.point))return;used.add(c.point);c.star.verified=true;
      c.star.confidence=Math.max(.5,Math.min(.98,1-c.distance/radius*.48));
      c.star.x=c.point.x/rx;c.star.y=c.point.y/ry;
    });
  }
  function drawCaptureHud(ctx,w,h,stars){
    const scale=w/390;drawConstellations(ctx,stars,prefs.constellations,scale);drawStars(ctx,stars,scale,true);
    const barH=58*scale;ctx.fillStyle='rgba(2,6,14,.76)';ctx.fillRect(0,0,w,barH);ctx.fillStyle='#fff';ctx.font=`700 ${16*scale}px system-ui`;ctx.fillText(formatTime(new Date()),18*scale,24*scale);
    const heading=Number.isFinite(state.heading)?`${Math.round(state.heading).toString().padStart(3,'0')}° ${Astro.cardinal(state.heading)}`:'---°';ctx.textAlign='right';ctx.fillText(`指南針  ${heading}`,w-18*scale,24*scale);ctx.font=`500 ${11*scale}px system-ui`;ctx.fillStyle='#b9c8df';ctx.fillText(`仰角 ${degrees(state.altitude)}  GPS ${state.location?'±'+Math.round(state.location.accuracy)+'m':'無'}`,w-18*scale,44*scale);ctx.textAlign='left';ctx.fillText('星空指南針・空心圈為推算，綠色為照片比對',18*scale,44*scale);
  }

  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('StarGuideDB',1);req.onupgradeneeded=()=>req.result.createObjectStore('records',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function saveRecord(record){state.db=state.db||await openDb();return new Promise((resolve,reject)=>{const req=state.db.transaction('records','readwrite').objectStore('records').put(record);req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}
  async function getRecords(){state.db=state.db||await openDb();return new Promise((resolve,reject)=>{const req=state.db.transaction('records').objectStore('records').getAll();req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.id-a.id));req.onerror=()=>reject(req.error)})}
  async function deleteRecord(id){state.db=state.db||await openDb();return new Promise((resolve,reject)=>{const req=state.db.transaction('records','readwrite').objectStore('records').delete(id);req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}
  async function clearRecords(){state.db=state.db||await openDb();return new Promise((resolve,reject)=>{const req=state.db.transaction('records','readwrite').objectStore('records').clear();req.onsuccess=resolve;req.onerror=()=>reject(req.error)})}
  async function renderRecords(){
    const records=await getRecords();els.recordsList.innerHTML='';els.recordsEmpty.hidden=records.length>0;els.clearRecords.hidden=records.length===0;
    records.forEach(record=>{
      const card=document.createElement('article');card.className='record-card';const url=URL.createObjectURL(record.image),verified=record.verified?.length||0,predicted=record.predicted?.length||0;
      card.innerHTML=`<img alt="${record.displayTime} 的星空照片"><div><h2>${record.displayTime}</h2><p>${Math.round(record.heading||0)}° ${Astro.cardinal(record.heading||0)}・仰角 ${Math.round(record.altitude||0)}°<br>${verified?`已比對 ${verified} 顆亮星`:`${predicted} 顆位置推算，未完成照片比對`}</p><div class="card-actions"><button class="small-btn open-record" type="button">查看結果</button><button class="small-btn delete-btn" type="button">刪除</button></div></div>`;
      card.querySelector('img').src=url;card.querySelector('.open-record').onclick=()=>openRecord(record);card.querySelector('.delete-btn').onclick=async()=>{await deleteRecord(record.id);URL.revokeObjectURL(url);renderRecords();showToast('紀錄已刪除')};els.recordsList.append(card);
    });
  }
  function openRecord(record){
    state.currentRecord=record;const url=URL.createObjectURL(record.image);els.recordPreview.onload=()=>URL.revokeObjectURL(url);els.recordPreview.src=url;els.recordTitle.textContent=(record.verified?.length||0)?`已比對 ${record.verified.length} 顆亮星`:'星位推算結果';
    els.recordMeta.textContent=`${record.displayTime}・${Math.round(record.heading||0)}° ${Astro.cardinal(record.heading||0)}・仰角 ${Math.round(record.altitude||0)}°`;
    const shown=(record.verified?.length?record.verified:record.predicted)||[];els.recordStars.innerHTML='';shown.forEach(s=>{const span=document.createElement('span');span.className='star-pill'+(s.verified?' verified':'');span.textContent=`${s.zh} ${s.en}${s.verified?'・已比對':'・推算'}`;els.recordStars.append(span)});
    if(!shown.length)els.recordStars.textContent='這張照片沒有可顯示的星體。';els.recordDialog.showModal();
  }
  function downloadCurrentRecord(){if(!state.currentRecord)return;const url=URL.createObjectURL(state.currentRecord.image),a=document.createElement('a');a.href=url;a.download=`StarGuide_${state.currentRecord.displayTime.replace(/[\/: ]/g,'-')}.jpg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

  function setView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav-btn').forEach(b=>{const active=b.dataset.view===id;b.classList.toggle('active',active);active?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current')});if(id==='recordsView')renderRecords();if(id==='observeView')setTimeout(resizeOverlay,50)}
  async function checkForUpdate(manual=false){
    els.latestVersion.textContent='檢查中';els.updateStatus.textContent='正在取得版本資訊…';
    try{
      const response=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error('version fetch failed');const info=await response.json();els.latestVersion.textContent=info.version;
      if(info.version!==APP_VERSION){els.updateStatus.textContent=`發現 ${info.version}，正在更新…`;await applyUpdate(info.version)}else{els.updateStatus.textContent='目前已是最新版本。';if(manual)showToast('目前已是最新版本')}
    }catch{els.latestVersion.textContent='無法取得';els.updateStatus.textContent='目前無法檢查更新，稍後開啟時會再試一次。';if(manual)showToast('無法連線到版本資訊')}
  }
  async function applyUpdate(version){
    if(!('serviceWorker'in navigator)){els.updateStatus.textContent='發現新版本，請重新整理頁面。';return}
    const reg=await navigator.serviceWorker.getRegistration();if(!reg)return;let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;location.reload()}});
    await reg.update();if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
    setTimeout(()=>{if(!reloading)location.reload()},2200);
  }
  function bindSettings(){
    const sync=()=>{prefs.fov=Number(els.fov.value);prefs.headingOffset=Number(els.headingOffset.value);prefs.altitudeOffset=Number(els.altitudeOffset.value);prefs.magnitude=Number(els.magnitude.value);prefs.constellations=els.constellations.checked;els.fovValue.textContent=`${prefs.fov}°`;els.headingOffsetValue.textContent=`${prefs.headingOffset}°`;els.altitudeOffsetValue.textContent=`${prefs.altitudeOffset}°`;savePrefs()};
    [els.fov,els.headingOffset,els.altitudeOffset,els.magnitude,els.constellations].forEach(el=>el.addEventListener('input',sync));sync();
  }
  async function registerServiceWorker(){if('serviceWorker'in navigator)try{await navigator.serviceWorker.register('./sw.js',{scope:'./'})}catch(error){console.warn('SW unavailable',error)}}
  function init(){
    els.currentVersion.textContent=APP_VERSION;els.versionBtn.textContent=APP_VERSION;buildCompass();bindSettings();updateClock();setInterval(updateClock,1000);requestAnimationFrame(drawLoop);
    els.start.onclick=()=>startExperience(true);$('retryCameraBtn').onclick=()=>startCamera().then(()=>{els.fallback.classList.add('hidden');els.capture.disabled=false;showToast('相機已啟用')}).catch(()=>showToast('無法啟用相機'));
    $('retryLocationBtn').onclick=()=>startLocation().then(()=>showToast('位置已啟用')).catch(()=>showToast('無法取得位置'));
    $('retryMotionBtn').onclick=()=>requestMotion().then(()=>showToast('方向感測已啟用')).catch(()=>showToast('無法啟用方向感測'));
    els.capture.onclick=captureAndAnalyze;els.calibrate.onclick=()=>els.calibrationDialog.showModal();els.labels.onclick=()=>{state.labels=!state.labels;els.labels.classList.toggle('active',state.labels);els.labels.setAttribute('aria-pressed',String(state.labels))};
    document.querySelectorAll('.nav-btn').forEach(btn=>btn.onclick=()=>setView(btn.dataset.view));els.versionBtn.onclick=()=>setView('settingsView');
    els.clearRecords.onclick=async()=>{if(confirm('確定要刪除這台裝置上的全部觀測紀錄？')){await clearRecords();renderRecords();showToast('全部紀錄已刪除')}};
    els.downloadRecord.onclick=downloadCurrentRecord;els.closeRecord.onclick=()=>els.recordDialog.close();els.checkUpdate.onclick=()=>checkForUpdate(true);
    window.addEventListener('resize',resizeOverlay);screen.orientation?.addEventListener?.('change',resizeOverlay);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&localStorage.getItem('starGuideSetup')==='1'&&!state.stream)startExperience(false)});
    attachOrientation();registerServiceWorker().then(()=>checkForUpdate(false));renderRecords().catch(()=>{});
    if(localStorage.getItem('starGuideSetup')==='1')startExperience(false);
  }
  init();
})();
