import sharp from 'sharp';
import { detectFormat, mimeFor } from './formats.js';
import { parseJpeg } from './jpeg.js';
import { parsePng } from './png.js';
import { parseWebp } from './webp.js';
import { parseTiff } from './tiff.js';
import { detectAiMetadata } from './ai.js';
import { detectC2pa } from './c2pa.js';
import { validateWithOfficialC2pa } from '../services/c2pa-adapter.js';
import { sha256 } from '../utils/crypto.js';
import { AnalysisResult, ImageFormat, MetadataItem } from '../types/model.js';
import { config } from '../utils/config.js';

const mimeFromSharp=(m:string|undefined)=>m??'application/octet-stream';
function unique(items:MetadataItem[]):MetadataItem[]{ const seen=new Set<string>(); return items.filter(i=>{const k=`${i.group}|${i.path}|${i.value}`;if(seen.has(k))return false;seen.add(k);return true;}); }
function classify(items:MetadataItem[], raw:string):MetadataItem[]{ return unique([...items,...detectAiMetadata(raw)]); }
export async function analyze(data:Uint8Array, filename='image'):Promise<AnalysisResult>{
  const format=detectFormat(data); if(format==='UNKNOWN') throw new Error('Unsupported or unrecognized image format');
  let metaItems:MetadataItem[]=[]; const textSources:string[]=[];
  if(format==='JPEG'){ const p=parseJpeg(data); metaItems.push(...p.items); for(const s of p.segments){ if(s.marker===0xe1||s.marker===0xed||s.marker===0xec||s.marker===0xfe){ const t=new TextDecoder('latin1').decode(s.payload.subarray(0,100000)); if(!t.startsWith('Exif\0\0')) textSources.push(t); } } }
  if(format==='PNG'){ const p=parsePng(data); metaItems.push(...p.items); for(const c of p.chunks){ if(['tEXt','zTXt','iTXt','caBX'].includes(c.type)) textSources.push(new TextDecoder('latin1').decode(c.data.subarray(0,100000))); } }
  if(format==='WEBP'){ const p=parseWebp(data); metaItems.push(...p.items); for(const c of p.chunks){ if(['XMP ','JUMBF'].includes(c.type)) textSources.push(new TextDecoder('latin1').decode(c.data.subarray(0,100000))); } }
  if(format==='TIFF'){ const p=parseTiff(data); metaItems.push(...p.items); }
  const raw=textSources.join('\n'); const items=classify(metaItems,raw);
  let c2pa=detectC2pa(data, metaItems.filter(i=>i.group==='c2pa').map(i=>i.path));
  if(c2pa.present){ const verified=await validateWithOfficialC2pa(data,mimeFor(format),true); if(verified) c2pa=verified; }
  if(c2pa.present) items.push({path:'C2PA/Manifest',group:'c2pa',value:'Embedded C2PA/JUMBF structure detected',source:'Container structure',confidence:'confirmed',removable:true});
  const counts={exif:0,xmp:0,iptc:0,gps:0,device:0,identity:0,time:0,software:0,ai:0,c2pa:0,thumbnail:0,technical:0,other:0} as Record<string,number>; for(const i of unique(items)) counts[i.group]++;
  const present=Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v>0])) as AnalysisResult['metadata']['present'];
  let sharpInfo; try{ sharpInfo=await sharp(data,{limitInputPixels:config.maxPixels}).metadata(); } catch(e){ throw new Error(`Image decode validation failed: ${e instanceof Error?e.message:'unknown error'}`); }
  const width=sharpInfo.width??0,height=sharpInfo.height??0; if(!width||!height) throw new Error('Image dimensions could not be established safely');
  let bitDepth:number|null=null; if(format==='PNG'&&sharpInfo.depth) bitDepth=Number(String(sharpInfo.depth).replace(/[^0-9]/g,''))||null;
  if(format==='JPEG'&&sharpInfo.space) bitDepth=8; if(format==='WEBP') bitDepth=8;
  const colorProfile=sharpInfo.icc?`ICC profile (${sharpInfo.icc.length} bytes)`:'None detected';
  const pixelFormat=[sharpInfo.space??'unknown', sharpInfo.channels?`${sharpInfo.channels}ch`:''].filter(Boolean).join(' ');
  let status:AnalysisResult['processing']['status']='LOSSLESS METADATA REMOVAL'; let reason='Format supports container-level metadata manipulation for detected removable structures.';
  if(format==='TIFF') { status='QUALITY-PRESERVING FALLBACK'; reason='Conservative Classic TIFF IFD cleaner; BigTIFF or uncertain layouts are not rewritten.'; }
  if(['HEIC','HEIF','AVIF'].includes(format)){status='UNSUPPORTED';reason='Format recognized but this build intentionally does not rewrite it.';}
  return {file:{format,mime:mimeFor(format),width,height,size:data.length,fileHash:sha256(data),pixelFormat,channels:sharpInfo.channels??0,bitDepth,alpha:Boolean(sharpInfo.hasAlpha),colorProfile},metadata:{counts:counts as AnalysisResult['metadata']['counts'],present,items:unique(items)},c2pa,warnings:format==='JPEG'?['JPEG metadata is removed by marker surgery; compressed scan data is copied unchanged.']:[],processing:{status,reason}};
}
