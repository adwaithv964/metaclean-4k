import { HttpError } from './errors.js';
export interface MultipartPart { name:string; filename?:string; contentType?:string; data:Buffer; }
export function parseMultipart(body:Buffer, contentType:string):MultipartPart[]{
 const m=contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i); if(!m) throw new HttpError(400,'Multipart boundary is missing','BAD_MULTIPART'); const boundary=Buffer.from(`--${m[1]??m[2]}`,'utf8');
 const parts:MultipartPart[]=[]; let pos=0;
 while(true){ const start=body.indexOf(boundary,pos); if(start<0) break; let p=start+boundary.length; if(body.subarray(p,p+2).toString()==='--') break; if(body.subarray(p,p+2).toString()==='\r\n') p+=2; const headerEnd=body.indexOf('\r\n\r\n',p); if(headerEnd<0) throw new HttpError(400,'Malformed multipart headers','BAD_MULTIPART'); const headers=body.subarray(p,headerEnd).toString('latin1').split('\r\n'); const h:Record<string,string>={}; for(const line of headers){ const i=line.indexOf(':'); if(i>0)h[line.slice(0,i).trim().toLowerCase()]=line.slice(i+1).trim(); }
   const next=body.indexOf(Buffer.from(`\r\n${boundary.toString()}`),headerEnd+4); if(next<0) throw new HttpError(400,'Malformed multipart termination','BAD_MULTIPART'); const data=body.subarray(headerEnd+4,next); const cd=h['content-disposition']??''; const nm=cd.match(/name="([^"]+)"/i)?.[1]; if(!nm){pos=next+2;continue;} const fn=cd.match(/filename="([^"]*)"/i)?.[1]; parts.push(fn ? {name:nm,filename:fn,contentType:h['content-type']??'application/octet-stream',data:Buffer.from(data)} : {name:nm,data:Buffer.from(data)}); pos=next+2; }
 return parts;
}
