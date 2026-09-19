self.onmessage=function(event){
  const {pixels,width,height}=event.data;
  const rgba=new Uint8ClampedArray(pixels),gray=new Uint8Array(width*height);
  let sum=0,sum2=0;
  for(let i=0,j=0;i<rgba.length;i+=4,j++){
    const v=Math.round(rgba[i]*.2126+rgba[i+1]*.7152+rgba[i+2]*.0722);
    gray[j]=v;sum+=v;sum2+=v*v;
  }
  const n=gray.length,mean=sum/n,std=Math.sqrt(Math.max(0,sum2/n-mean*mean));
  const threshold=Math.max(145,mean+Math.max(22,std*2.45));
  const points=[];
  for(let y=3;y<height-3;y+=2){
    for(let x=3;x<width-3;x+=2){
      const idx=y*width+x,v=gray[idx];
      if(v<threshold)continue;
      let peak=true;
      for(let oy=-2;oy<=2&&peak;oy++)for(let ox=-2;ox<=2;ox++)if((ox||oy)&&gray[(y+oy)*width+x+ox]>v){peak=false;break}
      if(!peak)continue;
      let local=0;
      for(let oy=-3;oy<=3;oy++)for(let ox=-3;ox<=3;ox++)local+=gray[(y+oy)*width+x+ox];
      const contrast=v-local/49;
      if(contrast>15)points.push({x,y,v,contrast});
    }
  }
  points.sort((a,b)=>(b.contrast+b.v*.08)-(a.contrast+a.v*.08));
  const kept=[];
  for(const p of points){
    if(kept.every(k=>(k.x-p.x)**2+(k.y-p.y)**2>64))kept.push(p);
    if(kept.length>=120)break;
  }
  self.postMessage({points:kept,mean,std,threshold});
};
