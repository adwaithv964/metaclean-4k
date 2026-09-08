import { MetadataItem } from '../types/model.js';
import { sha256 } from '../utils/crypto.js';
import { parseTiff, cleanTiff } from './tiff.js';

function markerName(marker: number): string {
  const names: Record<number,string> = {0xE0:'APP0/JFIF',0xE1:'APP1/EXIF-XMP',0xE2:'APP2/ICC',0xE3:'APP3',0xE4:'APP4',0xE5:'APP5',0xE6:'APP6',0xE7:'APP7',0xE8:'APP8',0xE9:'APP9',0xEA:'APP10',0xEB:'APP11/JUMBF-C2PA',0xEC:'APP12',0xED:'APP13/IPTC',0xEE:'APP14/Adobe',0xEF:'APP15'};
  return names[marker] ?? `APP${marker-0xE0}`;
}
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
export interface JpegParse { items: MetadataItem[]; segments: { start:number; end:number; marker:number; payload:Uint8Array }[]; sosOffset:number; scanEnd:number; }
export function parseJpeg(data: Uint8Array): JpegParse {
  if (data[0]!==0xff||data[1]!==0xd8) throw new Error('Invalid JPEG SOI');
  const items: MetadataItem[]=[]; const segments=[]; let p=2; let sosOffset=-1;
  while (p+1 < data.length) {
    if (data[p]!==0xff) throw new Error(`Malformed JPEG marker at ${p}`);
    while (p < data.length && data[p]===0xff) p++;
    const marker=data[p++]; if (marker===0xda) { sosOffset=p-2; break; }
    if (marker===0xd9) break;
    if ((marker>=0xd0&&marker<=0xd7)||marker===0x01) continue;
    if (p+2>data.length) throw new Error('Truncated JPEG segment length');
    const len=(data[p]<<8)|data[p+1]; if (len<2 || p+len>data.length) throw new Error('Invalid JPEG segment length');
    const start=p-2; const payload=data.subarray(p+2,p+len); const end=p+len; segments.push({start,end,marker,payload});
    const t=text(payload.subarray(0, Math.min(payload.length,256)));
    if(marker===0xe1){ if(t.startsWith('Exif\0\0')) { items.push({path:'EXIF',group:'exif',value:`EXIF block (${payload.length} bytes)`,source:'JPEG APP1',confidence:'confirmed',removable:true}); try{ const ex=parseTiff(payload.subarray(6)); for(const i of ex.items) items.push({...i,source:'JPEG APP1 / EXIF'}); }catch{/* malformed EXIF is still represented by the enclosing block */} } else if(t.includes('http://ns.adobe.com/xap/1.0/')||t.includes('<x:xmpmeta')||t.includes('<?xpacket')) items.push({path:'XMP',group:'xmp',value:'XMP packet',source:'JPEG APP1',confidence:'confirmed',removable:true}); else items.push({path:'APP1',group:'other',value:'Application metadata block',source:'JPEG APP1',confidence:'heuristic',removable:true}); }
    if(marker===0xed) items.push({path:'IPTC',group:'iptc',value:`IPTC APP13 block (${payload.length} bytes)`,source:'JPEG APP13',confidence:'confirmed',removable:true});
    if(marker===0xeb) items.push({path:'C2PA/JUMBF',group:'c2pa',value:`APP11 block (${payload.length} bytes)`,source:'JPEG APP11',confidence:'confirmed',removable:true});
    if(marker===0xfe) items.push({path:'JPEG Comment',group:'other',value:text(payload),source:'JPEG COM',confidence:'confirmed',removable:true});
    if(marker===0xe2 && t.includes('ICC_PROFILE')) items.push({path:'ICC Profile',group:'technical',value:'ICC profile',source:'JPEG APP2',confidence:'confirmed',removable:false,reason:'Preserved to avoid color-rendering changes'});
    if(marker===0xee) items.push({path:'Adobe Transform',group:'technical',value:'Adobe APP14 transform metadata',source:'JPEG APP14',confidence:'confirmed',removable:false,reason:'Preserved because it can affect rendered appearance'});
    p=end;
  }
  const scanStart = sosOffset>=0 ? sosOffset : data.length; let scanEnd=data.length;
  if(sosOffset>=0){ let q=sosOffset; while(q+1<data.length){ if(data[q]===0xff){ const n=data[q+1]; if(n===0xd9){scanEnd=q+2; break;} if(n===0x00){q+=2;continue;} if(n>=0xd0&&n<=0xd7){q+=2;continue;} } q++; } }
  return {items,segments,sosOffset,scanEnd};
}
export function cleanJpeg(data: Uint8Array, removeGroups: Set<string>): Uint8Array {
  const parsed = parseJpeg(data);
  const chunks: Uint8Array[] = [data.subarray(0, 2)];
  for (const seg of parsed.segments) {
    const payloadText = text(seg.payload.subarray(0, 512));
    let drop = false;
    if (seg.marker === 0xe1) {
      if (payloadText.startsWith('Exif\0\0')) {
        if (removeGroups.has('exif') || removeGroups.has('everything')) {
          drop = true;
        } else {
          const exGroups = ['gps','device','identity','time','software','other','xmp','thumbnail'].some(g => removeGroups.has(g));
          if (exGroups) {
            const cleanedExif = cleanTiff(seg.payload.subarray(6), removeGroups);
            const np = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from(cleanedExif)]);
            if (np.length > 65533) throw new Error('EXIF payload too large');
            chunks.push(Buffer.from([0xff, seg.marker, (np.length + 2) >> 8, (np.length + 2) & 255]), np);
            continue;
          }
        }
      } else if (removeGroups.has('xmp') || removeGroups.has('everything')) {
        drop = true;
      }
    }
    if (seg.marker === 0xed && (removeGroups.has('iptc') || removeGroups.has('everything'))) drop = true;
    if (seg.marker === 0xfe && (removeGroups.has('other') || removeGroups.has('everything'))) drop = true;
    if (seg.marker === 0xeb && (removeGroups.has('c2pa') || removeGroups.has('everything'))) drop = true;
    if (seg.marker === 0xe2 && payloadText.includes('ICC_PROFILE')) drop = false;
    if (seg.marker === 0xee) drop = false;
    if (!drop) chunks.push(data.subarray(seg.start, seg.end));
  }
  if (parsed.sosOffset >= 0) chunks.push(data.subarray(parsed.sosOffset));
  return Buffer.concat(chunks);
}
export function jpegPixelStreamHash(data: Uint8Array): string { const p=parseJpeg(data); const ranges:Uint8Array[]=[]; for (const seg of p.segments) { if(seg.marker===0xd8||seg.marker===0xd9) continue; }
  // Hash the entropy-coded scan section only. This detects accidental scan rewrites without decoding.
  if(p.sosOffset>=0) ranges.push(data.subarray(p.sosOffset));
  return sha256(Buffer.concat(ranges)); }
