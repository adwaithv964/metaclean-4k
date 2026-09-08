import { ImageFormat } from '../types/model.js';
export function detectFormat(data: Uint8Array): ImageFormat {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'JPEG';
  if (data.length >= 8 && Buffer.from(data.subarray(0,8)).toString('hex') === '89504e470d0a1a0a') return 'PNG';
  if (data.length >= 12 && Buffer.from(data.subarray(0,4)).toString('ascii') === 'RIFF' && Buffer.from(data.subarray(8,12)).toString('ascii') === 'WEBP') return 'WEBP';
  if (data.length >= 4) { const b = Buffer.from(data.subarray(0,4)); if ((b[0]===0x49&&b[1]===0x49&&b[2]===0x2a&&b[3]===0x00) || (b[0]===0x4d&&b[1]===0x4d&&b[2]===0x00&&b[3]===0x2a)) return 'TIFF'; }
  if (data.length >= 12 && Buffer.from(data.subarray(4,8)).toString('ascii') === 'ftyp') { const brand=Buffer.from(data.subarray(8,12)).toString('ascii'); if (brand==='heic'||brand==='heix'||brand==='mif1'||brand==='msf1') return brand.startsWith('he') ? 'HEIC':'HEIF'; if (brand==='avif'||brand==='avis') return 'AVIF'; }
  return 'UNKNOWN';
}
export function mimeFor(format: ImageFormat): string { return ({JPEG:'image/jpeg',PNG:'image/png',WEBP:'image/webp',TIFF:'image/tiff',HEIC:'image/heic',HEIF:'image/heif',AVIF:'image/avif',UNKNOWN:'application/octet-stream'})[format]; }
