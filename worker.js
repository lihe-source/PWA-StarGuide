importScripts('./core.js?v=1.1.0');
self.onmessage=e=>{
 const {pixels,width:w,height:h,pred}=e.data,data=new Uint8ClampedArray(pixels),gray=new Float32Array(w*h),threshold=new Float32Array(w*h),seen=new Uint8Array(w*h),points=[];
 for(let i=0;i<gray.length;i++)gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
 for(let ty=0;ty<h;ty+=32)for(let tx=0;tx<w;tx+=32){let s=0,sq=0,n=0;for(let y=ty;y<Math.min(h,ty+32);y++)for(let x=tx;x<Math.min(w,tx+32);x++){let v=gray[y*w+x];s+=v;sq+=v*v;n++}let t=s/n+Math.max(8,Math.sqrt(Math.max(0,sq/n-(s/n)**2))*3);for(let y=ty;y<Math.min(h,ty+32);y++)for(let x=tx;x<Math.min(w,tx+32);x++)threshold[y*w+x]=t}
 for(let start=0;start<gray.length;start++){
  if(seen[start]||gray[start]<=threshold[start])continue;const stack=[start];seen[start]=1;let area=0,sx=0,sy=0,weight=0,minx=w,maxx=0,miny=h,maxy=0,peak=0;
  while(stack.length){let i=stack.pop(),x=i%w,y=(i/w)|0,v=Math.max(1,gray[i]-threshold[i]);area++;weight+=v;sx+=x*v;sy+=y*v;minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);peak=Math.max(peak,gray[i]);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,ni=ny*w+nx;if(nx>=0&&nx<w&&ny>=0&&ny<h&&!seen[ni]&&gray[ni]>threshold[ni]){seen[ni]=1;stack.push(ni)}}}
  const a=maxx-minx+1,b=maxy-miny+1;if(area<=90&&Math.max(a,b)/Math.min(a,b)<3&&minx>1&&miny>1&&maxx<w-2&&maxy<h-2)points.push({x:sx/weight,y:sy/weight,weight,peak,area});
 }
 points.sort((a,b)=>b.weight-a.weight);const selected=points.slice(0,180),result=Core.match(pred,selected);self.postMessage({points:selected,result});
};
