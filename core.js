'use strict';
const Core=(()=>{
 const D=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),norm=x=>(x%360+360)%360;
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=a=>{let n=Math.hypot(...a);return n?a.map(v=>v/n):[0,0,0]},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const vec=(az,alt)=>[Math.cos(alt*D)*Math.sin(az*D),Math.cos(alt*D)*Math.cos(az*D),Math.sin(alt*D)];
 const azalt=v=>({az:norm(Math.atan2(v[0],v[1])/D),alt:Math.asin(clamp(v[2],-1,1))/D});
 const delta=(a,b)=>(b-a+540)%360-180;
 const cardinal=a=>['北','東北','東','東南','南','西南','西','西北'][Math.round(norm(a)/45)%8];
 function pose(alpha,beta,gamma,screen=0){
  const a=alpha*D,b=beta*D,g=gamma*D,s=screen*D;
  function rotate([x,y,z]){let xx=Math.cos(g)*x+Math.sin(g)*z,zz=-Math.sin(g)*x+Math.cos(g)*z;let yy=Math.cos(b)*y-Math.sin(b)*zz;zz=Math.sin(b)*y+Math.cos(b)*zz;return [Math.cos(a)*xx-Math.sin(a)*yy,Math.sin(a)*xx+Math.cos(a)*yy,zz]}
  // Screen angle is the device's counter-clockwise rotation; compensate in screen basis.
  return {f:rotate([0,0,-1]),r:rotate([Math.cos(s),-Math.sin(s),0]),u:rotate([Math.sin(s),Math.cos(s),0])};
 }
 function yaw(p,degrees){const a=degrees*D;const rot=v=>[Math.cos(a)*v[0]+Math.sin(a)*v[1],-Math.sin(a)*v[0]+Math.cos(a)*v[1],v[2]];return{f:rot(p.f),r:rot(p.r),u:rot(p.u)}}
 function offset(p,az,alt){p=yaw(p,az);const a=alt*D,axis=vec(azalt(p.f).az+90,0),rot=v=>{const c=cross(axis,v),d=dot(axis,v);return v.map((x,i)=>x*Math.cos(a)+c[i]*Math.sin(a)+axis[i]*d*(1-Math.cos(a)))};return{f:rot(p.f),r:rot(p.r),u:rot(p.u)}}
 function smooth(old,p,rate=.25){if(!old||dot(old.f,p.f)<-.5)return p;const mix=(a,b)=>unit(a.map((v,i)=>v*(1-rate)+b[i]*rate));const f=mix(old.f,p.f),r=unit(cross(f,mix(old.u,p.u))),u=unit(cross(r,f));return{f,r,u}}
 function project(v,p,w,h,fov){const depth=dot(v,p.f);if(depth<=.01)return null;const focal=w/2/Math.tan(fov*D/2);return {x:w/2+dot(v,p.r)/depth*focal,y:h/2-dot(v,p.u)/depth*focal}}
 function chart(v,w,h,rotation=0,zoom=1,pan=[0,0]){const {az,alt}=azalt(v),rad=(90-alt)/90*Math.min(w,h)*.42*zoom,a=(az-rotation)*D;return{x:w/2+pan[0]-rad*Math.sin(a),y:h/2+pan[1]-rad*Math.cos(a)}}
 function sky(catalog,date,location){
  const A=Astronomy,obs=new A.Observer(location.lat,location.lon,location.height||0),t=A.MakeTime(date),rot=A.Rotation_EQJ_EQD(t),years=(date.getTime()-946728000000)/31557600000;
  const convert=(s)=>{
   let dec=s.dec+(s.pmdec||0)*years/3600000,ra=s.ra+(s.pmra||0)*years/(3600000*15*Math.max(.001,Math.cos(s.dec*D)));
   const v=new A.Vector(Math.cos(dec*D)*Math.cos(ra*15*D),Math.cos(dec*D)*Math.sin(ra*15*D),Math.sin(dec*D),t),eq=A.EquatorFromVector(A.RotateVector(rot,v));
   const h=A.Horizon(t,obs,eq.ra,eq.dec,'normal');return{...s,az:h.azimuth,alt:h.altitude,v:vec(h.azimuth,h.altitude),type:'恆星'};
  };
  const out=catalog.map(convert);
  for(const [en,zh] of [['Moon','月球'],['Mercury','水星'],['Venus','金星'],['Mars','火星'],['Jupiter','木星'],['Saturn','土星'],['Uranus','天王星'],['Neptune','海王星']]){
   const eq=A.Equator(en,t,obs,true,true),h=A.Horizon(t,obs,eq.ra,eq.dec,'normal'),light=A.Illumination(en,t);
   out.push({id:en,en,zh,type:en==='Moon'?'月球':'行星',mag:light.mag,phase:light.phase_fraction,az:h.azimuth,alt:h.altitude,v:vec(h.azimuth,h.altitude)});
  }
  return out;
 }
 // Guided 2-D similarity RANSAC. Never treats a single/duplicate bright point as solved.
 function match(pred,points){
  const candidates=[];for(let i=0;i<pred.length;i++)for(let j=0;j<points.length;j++)if(Math.hypot(pred[i].x-points[j].x,pred[i].y-points[j].y)<80)candidates.push({i,j});
  if(pred.length<6||points.length<6)return{status:'candidate',matches:[],count:Math.min(pred.length,points.length)};
  const buckets=new Map();points.forEach((p,i)=>{const key=Math.floor(p.x/8)+','+Math.floor(p.y/8);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i)});
  function evaluate(a,b,tx,ty){const used=new Set(),m=[];for(let i=0;i<pred.length;i++){const p=pred[i],x=a*p.x-b*p.y+tx,y=b*p.x+a*p.y+ty,cx=Math.floor(x/8),cy=Math.floor(y/8);let j=-1,d=16;for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++)for(const k of buckets.get(gx+','+gy)||[]){if(used.has(k))continue;const e=(x-points[k].x)**2+(y-points[k].y)**2;if(e<d){j=k;d=e}}if(j>=0){used.add(j);m.push({i,j,error:Math.sqrt(d)})}}return{a,b,tx,ty,matches:m,rms:m.length?Math.sqrt(m.reduce((s,x)=>s+x.error*x.error,0)/m.length):Infinity}}
  let best={matches:[],rms:Infinity},alternatives=[];let seed=19;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
  for(let trial=0;trial<1800&&candidates.length>1;trial++){
   const c=candidates[rnd(candidates.length)],d=candidates[rnd(candidates.length)];if(c.i===d.i||c.j===d.j)continue;
   const p=pred[c.i],q=pred[d.i],u=points[c.j],v=points[d.j],dx=q.x-p.x,dy=q.y-p.y,den=dx*dx+dy*dy;if(den<1600)continue;
   const a=((v.x-u.x)*dx+(v.y-u.y)*dy)/den,b=((v.y-u.y)*dx-(v.x-u.x)*dy)/den;
   if(Math.hypot(a,b)<.85||Math.hypot(a,b)>1.15||Math.abs(Math.atan2(b,a))>.18)continue;
   const r=evaluate(a,b,u.x-a*p.x+b*p.y,u.y-b*p.x-a*p.y);
   if(r.matches.length>=6)alternatives.push(r);
   if(r.matches.length>best.matches.length||(r.matches.length===best.matches.length&&r.rms<best.rms))best=r;
  }
  // Dense noise fields must not pass on only six coincidental matches.
  const minimum=Math.max(6,Math.ceil(Math.min(pred.length,points.length)*.25));
  if(best.matches.length<minimum||best.rms>2.6)return{status:'candidate',matches:[],count:best.matches.length};
  const ps=best.matches.map(m=>pred[m.i]),mx=ps.reduce((s,p)=>s+p.x,0)/ps.length,my=ps.reduce((s,p)=>s+p.y,0)/ps.length;
  let xx=0,yy=0,xy=0;for(const p of ps){xx+=(p.x-mx)**2;yy+=(p.y-my)**2;xy+=(p.x-mx)*(p.y-my)}
  if(xx*yy-xy*xy<.03*(xx+yy)**2)return{status:'candidate',matches:[],count:best.matches.length};
  const set=new Set(best.matches.map(m=>m.i+':'+m.j));
  if(alternatives.some(r=>r.matches.length>=best.matches.length&&r.matches.filter(m=>set.has(m.i+':'+m.j)).length<best.matches.length*.65))return{status:'ambiguous',matches:[],count:best.matches.length};
  return {...best,status:'matched',count:best.matches.length};
 }
 return{D,clamp,norm,unit,dot,cross,vec,azalt,delta,cardinal,pose,yaw,offset,smooth,project,chart,sky,match};
})();
if(typeof module!=='undefined')module.exports=Core;
