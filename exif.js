// Minimal read-only JPEG EXIF parser. Unsupported formats use explicit manual metadata.
async function readPhotoExif(file){
 const v=new DataView(await file.slice(0,1024*1024).arrayBuffer()),out={};
 try{if(v.getUint16(0)!==0xffd8)return out;let p=2;
  while(p+4<v.byteLength){const marker=v.getUint16(p),len=v.getUint16(p+2);if(len<2)break;
   if(marker===0xffe1&&v.getUint32(p+4)===0x45786966){const base=p+10,le=v.getUint16(base)===0x4949,u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le),size={1:1,2:1,3:2,4:4,5:8};
    function ifd(offset){const obj={};let at=base+offset,n=u16(at);if(n>256)return obj;for(let i=0;i<n;i++){const q=at+2+i*12,tag=u16(q),type=u16(q+2),count=u32(q+4);if(!size[type]||count>1024)continue;const pos=count*size[type]<=4?q+8:base+u32(q+8);if(pos+count*size[type]>v.byteLength)continue;let a=[];for(let j=0;j<count;j++){const z=pos+j*size[type];a.push(type===5?v.getUint32(z,le)/Math.max(1,v.getUint32(z+4,le)):type===4?u32(z):type===3?u16(z):v.getUint8(z))}obj[tag]=type===2?String.fromCharCode(...a).replace(/\0/g,''):a}return obj}
    const first=ifd(u32(base+4)),ex=first[34665]?ifd(first[34665][0]):{},gps=first[34853]?ifd(first[34853][0]):{};const dt=ex[36867]||first[306];if(typeof dt==='string')out.time=dt.replace(/^(\d{4}):(\d\d):(\d\d) /,'$1-$2-$3T').slice(0,16);
    const deg=a=>a?a[0]+a[1]/60+a[2]/3600:null;if(gps[2]&&gps[4]){out.lat=deg(gps[2])*(gps[1]==='S'?-1:1);out.lon=deg(gps[4])*(gps[3]==='W'?-1:1)}if(gps[17]&&gps[16]==='T')out.az=gps[17][0];out.orientation=first[274]?.[0]||1;return out;
   }p+=2+len;
  }
 }catch{}return out;
}
