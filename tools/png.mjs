// Minimal non-interlaced 8-bit PNG reader, enough for Playwright screenshots.
import zlib from 'node:zlib';
export function readPng(buf){
  let off=8,w=0,h=0,ch=4,idat=[];
  while(off<buf.length){
    const len=buf.readUInt32BE(off);
    const type=buf.toString('ascii',off+4,off+8);
    const data=buf.subarray(off+8,off+8+len);
    if(type==='IHDR'){
      w=data.readUInt32BE(0);h=data.readUInt32BE(4);
      const bits=data[8],color=data[9];
      if(bits!==8)throw new Error('bit depth '+bits);
      ch={0:1,2:3,4:2,6:4}[color];
      if(!ch)throw new Error('colour type '+color);
    }else if(type==='IDAT')idat.push(data);
    else if(type==='IEND')break;
    off+=12+len;
  }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const stride=w*ch;
  const out=Buffer.alloc(h*stride);
  let prev=Buffer.alloc(stride);
  for(let y=0;y<h;y++){
    const filter=raw[y*(stride+1)];
    const line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
    const cur=out.subarray(y*stride,(y+1)*stride);
    for(let i=0;i<stride;i++){
      const a=i>=ch?cur[i-ch]:0,b=prev[i],c=i>=ch?prev[i-ch]:0;
      let v=line[i];
      if(filter===1)v+=a;
      else if(filter===2)v+=b;
      else if(filter===3)v+=(a+b)>>1;
      else if(filter===4){
        const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
        v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      }
      cur[i]=v&255;
    }
    prev=cur;
  }
  return{width:w,height:h,channels:ch,data:out};
}
