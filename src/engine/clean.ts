import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AnalysisResult, CleanConfig, CleanReport, MetadataCategory } from '../types/model.js';
import { analyze } from './analyze.js';
import { cleanJpeg } from './jpeg.js';
import { cleanPng } from './png.js';
import { cleanWebp } from './webp.js';
import { cleanTiff } from './tiff.js';
import { config } from '../utils/config.js';

const tmpRoot=path.resolve('tmp');
const pixelHash=async(data:Uint8Array)=>{ const h=createHash('sha256'); const buf=await sharp(data,{limitInputPixels:config.maxPixels}).ensureAlpha().raw().toBuffer(); h.update(buf); return h.digest('hex'); };
function selected(cfg:CleanConfig):Set<string>{ if(cfg.mode==='everything') return new Set(['everything']); if(cfg.mode==='privacy') return new Set(['gps','device','identity','time','software','ai','c2pa','exif','xmp','iptc','thumbnail','other']); return new Set(cfg.remove); }
function cleanBytes(data:Uint8Array,format:AnalysisResult['file']['format'],cfg:CleanConfig):Uint8Array{
 const set=selected(cfg); if(format==='JPEG')return cleanJpeg(data,set); if(format==='PNG')return cleanPng(data,set); if(format==='WEBP')return cleanWebp(data,set); if(format==='TIFF')return cleanTiff(data,set); throw new Error(`Cleaning unsupported for ${format}`);
}
export async function clean(data:Uint8Array,filename:string,cfg:CleanConfig):Promise<{report:CleanReport;cleaned:Uint8Array}> {
 const before=await analyze(data,filename); if(before.processing.status==='UNSUPPORTED') throw new Error(before.processing.reason); if(before.file.size>config.maxUploadBytes) throw new Error('Input exceeds configured size limit');
 const cleaned=cleanBytes(data,before.file.format,cfg); if(cleaned.length===0) throw new Error('Cleaner produced an empty file');
 const after=await analyze(cleaned,filename.replace(/\.[^.]+$/,'')+'-cleaned');
 const pBefore=await pixelHash(data); const pAfter=await pixelHash(cleaned); const dims=before.file.width===after.file.width&&before.file.height===after.file.height;
 const color=before.file.colorProfile===after.file.colorProfile; const alpha=before.file.alpha===after.file.alpha; const bitDepth=before.file.bitDepth===after.file.bitDepth;
 if(!dims||!alpha||!bitDepth||pBefore!==pAfter) throw new Error('Integrity verification failed: decoded pixel representation changed or image properties changed');
 const removed:string[]=[]; const preserved:string[]=[]; const skipped:string[]=[]; const unsupported:string[]=[];
 const beforeGroups=before.metadata.present; const afterGroups=after.metadata.present;
 for(const g of Object.keys(beforeGroups) as MetadataCategory[]){ if(!beforeGroups[g]) continue; if(beforeGroups[g]&&!afterGroups[g]) removed.push(g.toUpperCase()); else if(afterGroups[g]&&selected(cfg).has(g)) skipped.push(g.toUpperCase()); else if(afterGroups[g]) preserved.push(g.toUpperCase()); }
 if(before.c2pa.present&&!after.c2pa.present) removed.push('C2PA / CONTENT CREDENTIALS'); else if(before.c2pa.present) skipped.push('C2PA / CONTENT CREDENTIALS');
 if(before.file.colorProfile!=='None detected') preserved.push('ICC COLOR PROFILE');
 let status:CleanReport['before']['processing']['status']='LOSSLESS METADATA REMOVAL';
 if(before.file.format==='TIFF') status='QUALITY-PRESERVING FALLBACK';
 const report:CleanReport={id:randomUUID(),createdAt:new Date().toISOString(),before,after,actions:{removed:[...new Set(removed)],preserved:[...new Set(preserved)],skipped:[...new Set(skipped)],unsupported},integrity:{dimensions:dims,pixelData:pBefore===pAfter?'UNCHANGED':'MODIFIED',colorProfile:color,alpha,bitDepth,originalHash:before.file.fileHash,cleanedHash:after.file.fileHash,pixelHashBefore:pBefore,pixelHashAfter:pAfter,fileSizeBefore:data.length,fileSizeAfter:cleaned.length},downloadName:filename.replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.[^.]+$/,'')+'-cleaned.'+before.file.format.toLowerCase().replace('jpeg','jpg'),warnings:[...before.warnings,...(before.c2pa.present?['Removing Content Credentials removes the embedded provenance manifest and can break provenance continuity.']:[]),...(color?[]:['No change to detected color profile could be proven.'])]};
 await mkdir(tmpRoot,{recursive:true}); await writeFile(path.join(tmpRoot,`${report.id}.bin`),cleaned,{mode:0o600}); await writeFile(path.join(tmpRoot,`${report.id}.json`),JSON.stringify(report,null,2),{mode:0o600});
 setTimeout(()=>{ void Promise.allSettled([unlink(path.join(tmpRoot,`${report.id}.bin`)),unlink(path.join(tmpRoot,`${report.id}.json`))]); },config.tempRetentionMs).unref();
 return {report,cleaned};
}
export async function readStored(id:string):Promise<{bytes:Buffer;report:CleanReport}>{ const safe=id.replace(/[^a-zA-Z0-9-]/g,''); if(safe!==id) throw new Error('Invalid file id'); return {bytes:await readFile(path.join(tmpRoot,`${safe}.bin`)),report:JSON.parse(await readFile(path.join(tmpRoot,`${safe}.json`),'utf8')) as CleanReport}; }
