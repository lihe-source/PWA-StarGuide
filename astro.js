(function(){
  const D=Math.PI/180;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const norm360=v=>((v%360)+360)%360;
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const normalize=v=>{const n=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/n,y:v.y/n,z:v.z/n}};
  const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
  const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});

  function julianDate(date){return date.getTime()/86400000+2440587.5}
  function gmst(date){
    const jd=julianDate(date),t=(jd-2451545)/36525;
    return norm360(280.46061837+360.98564736629*(jd-2451545)+.000387933*t*t-t*t*t/38710000);
  }
  function horizontal(star,date,lat,lon){
    const lst=norm360(gmst(date)+lon),ha=norm360(lst-star.ra*15);
    const h=(ha>180?ha-360:ha)*D,dec=star.dec*D,phi=lat*D;
    const sinAlt=Math.sin(dec)*Math.sin(phi)+Math.cos(dec)*Math.cos(phi)*Math.cos(h);
    const alt=Math.asin(clamp(sinAlt,-1,1));
    const east=-Math.cos(dec)*Math.sin(h);
    const north=Math.sin(dec)*Math.cos(phi)-Math.cos(dec)*Math.sin(phi)*Math.cos(h);
    const az=norm360(Math.atan2(east,north)/D);
    return{az,alt:alt/D,vector:normalize({x:east,y:north,z:sinAlt})};
  }
  function matMul(a,b){
    return a.map((r,i)=>b[0].map((_,j)=>r[0]*b[0][j]+r[1]*b[1][j]+r[2]*b[2][j]));
  }
  function matVec(m,v){return{x:m[0][0]*v.x+m[0][1]*v.y+m[0][2]*v.z,y:m[1][0]*v.x+m[1][1]*v.y+m[1][2]*v.z,z:m[2][0]*v.x+m[2][1]*v.y+m[2][2]*v.z}}
  function deviceFrame(alpha,beta,gamma,screenAngle){
    const a=alpha*D,b=beta*D,g=gamma*D,s=(screenAngle||0)*D;
    const rz=[[Math.cos(a),-Math.sin(a),0],[Math.sin(a),Math.cos(a),0],[0,0,1]];
    const rx=[[1,0,0],[0,Math.cos(b),-Math.sin(b)],[0,Math.sin(b),Math.cos(b)]];
    const ry=[[Math.cos(g),0,Math.sin(g)],[0,1,0],[-Math.sin(g),0,Math.cos(g)]];
    const m=matMul(matMul(rz,rx),ry);
    const dx=matVec(m,{x:1,y:0,z:0}),dy=matVec(m,{x:0,y:1,z:0});
    const forward=normalize(matVec(m,{x:0,y:0,z:-1}));
    const right=normalize(add(scale(dx,Math.cos(s)),scale(dy,-Math.sin(s))));
    const up=normalize(add(scale(dx,Math.sin(s)),scale(dy,Math.cos(s))));
    return{forward,right,up};
  }
  function frameFromAzAlt(azimuth,altitude,roll){
    const az=azimuth*D,al=altitude*D,r=(roll||0)*D;
    const forward=normalize({x:Math.cos(al)*Math.sin(az),y:Math.cos(al)*Math.cos(az),z:Math.sin(al)});
    const right0=normalize({x:Math.cos(az),y:-Math.sin(az),z:0});
    const up0=normalize({x:-Math.sin(al)*Math.sin(az),y:-Math.sin(al)*Math.cos(az),z:Math.cos(al)});
    return{forward,right:normalize(add(scale(right0,Math.cos(r)),scale(up0,Math.sin(r)))),up:normalize(add(scale(up0,Math.cos(r)),scale(right0,-Math.sin(r))))};
  }
  function frameHeading(frame){return norm360(Math.atan2(frame.forward.x,frame.forward.y)/D)}
  function frameAltitude(frame){return Math.asin(clamp(frame.forward.z,-1,1))/D}
  function offsetFrame(frame,headingOffset,altitudeOffset){
    const az=frameHeading(frame)+headingOffset,alt=clamp(frameAltitude(frame)+altitudeOffset,-89,89);
    const rawAz=frameHeading(frame)*D,rawAlt=frameAltitude(frame)*D;
    const right0=normalize({x:Math.cos(rawAz),y:-Math.sin(rawAz),z:0});
    const up0=normalize({x:-Math.sin(rawAlt)*Math.sin(rawAz),y:-Math.sin(rawAlt)*Math.cos(rawAz),z:Math.cos(rawAlt)});
    const roll=Math.atan2(dot(frame.right,up0),dot(frame.right,right0))/D;
    return frameFromAzAlt(az,alt,roll);
  }
  function blendFrame(oldFrame,newFrame,factor=.18){
    if(!oldFrame)return newFrame;
    return{forward:normalize(add(scale(oldFrame.forward,1-factor),scale(newFrame.forward,factor))),right:normalize(add(scale(oldFrame.right,1-factor),scale(newFrame.right,factor))),up:normalize(add(scale(oldFrame.up,1-factor),scale(newFrame.up,factor)))};
  }
  function projectCatalog(catalog,date,lat,lon,frame,width,height,hfov,magLimit){
    const f=(width/2)/Math.tan(hfov*D/2),margin=75;
    return catalog.filter(s=>s.mag<=magLimit).map(star=>{
      const h=horizontal(star,date,lat,lon),depth=dot(h.vector,frame.forward);
      if(depth<=.03)return null;
      const x=width/2+f*dot(h.vector,frame.right)/depth;
      const y=height/2-f*dot(h.vector,frame.up)/depth;
      if(x < -margin || x > width+margin || y < -margin || y > height+margin)return null;
      return{...star,x,y,az:h.az,alt:h.alt,depth,verified:false,confidence:0};
    }).filter(Boolean);
  }
  function cardinal(heading){return['北','東北','東','東南','南','西南','西','西北'][Math.round(norm360(heading)/45)%8]}
  window.Astro={norm360,horizontal,deviceFrame,frameFromAzAlt,frameHeading,frameAltitude,offsetFrame,blendFrame,projectCatalog,cardinal};
})();
