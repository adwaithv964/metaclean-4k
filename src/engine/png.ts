import { MetadataItem } from '../types/model.js';
const four=(b:Uint8Array)=>new TextDecoder('ascii').decode(b);
export interface PngChunk { start:number; end:number; type:string; data:Uint8Array; }
export function parsePng(data:Uint8Array): {chunks:PngChunk[];items:MetadataItem[]} {
  if(data.length<8||Buffer.from(data.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a') throw new Error('Invalid PNG signature');
  const chunks=[]; const items:MetadataItem[]=[]; let p=8;
  while(p+12<=data.length){ const len=Buffer.from(data).readUInt32BE(p); const type=four(data.subarray(p+4,p+8)); const end=p+12+len; if(end>data.length) throw new Error('Truncated PNG chunk'); const body=data.subarray(p+8,p+8+len); chunks.push({start:p,end,type,data:body});
    if(['tEXt','zTXt','iTXt'].includes(type)) items.push({path:type,group:'other',value:`PNG textual chunk (${len} bytes)`,source:type,confidence:'confirmed',removable:true});
    if(type==='eXIf') items.push({path:'eXIf',group:'exif',value:`PNG EXIF chunk (${len} bytes)`,source:'PNG eXIf',confidence:'confirmed',removable:true});
    if(type==='caBX') items.push({path:'C2PA/JUMBF',group:'c2pa',value:`PNG caBX (${len} bytes)`,source:'PNG caBX',confidence:'confirmed',removable:true});
    if(type==='iCCP') items.push({path:'ICC Profile',group:'technical',value:'PNG embedded ICC profile',source:'PNG iCCP',confidence:'confirmed',removable:false,reason:'Preserved to avoid color-rendering changes'});
    if(type==='pHYs') items.push({path:'Pixel Density',group:'technical',value:'pHYs chunk',source:'PNG pHYs',confidence:'confirmed',removable:false,reason:'Preserved as technical display metadata'});
    p=end; if(type==='IEND') break; }
  if(!chunks.some(c=>c.type==='IEND')) throw new Error('PNG missing IEND');
  return {chunks,items};
}
export function cleanPng(data:Uint8Array, removeGroups:Set<string>):Uint8Array { const p=parsePng(data); const out=[data.subarray(0,8)]; for(const c of p.chunks){ const drop=(['tEXt','zTXt','iTXt'].includes(c.type)&& (removeGroups.has('other')||removeGroups.has('everything'))) || (c.type==='eXIf'&&(removeGroups.has('exif')||removeGroups.has('everything'))) || (c.type==='caBX'&&(removeGroups.has('c2pa')||removeGroups.has('everything'))); if(!drop) out.push(data.subarray(c.start,c.end)); } return Buffer.concat(out); }
