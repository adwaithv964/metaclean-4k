import { randomBytes } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.js';
import { config } from './config.js';
import { detectFormat } from '../engine/formats.js';

// ─── Request ID ───────────────────────────────────────────────────────────────

/** Generate a short random hex request correlation ID (no uuid dep needed). */
export function generateRequestId(): string {
  return randomBytes(12).toString('hex');
}

// ─── IP Extraction (proxy-aware) ──────────────────────────────────────────────

const PRIVATE_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|::ffff:127\.)/;

/**
 * Extract the real client IP.
 * When the direct socket address is a known private/loopback range (i.e. we're
 * behind a load balancer), trust the leftmost value in X-Forwarded-For.
 */
export function clientIp(req: IncomingMessage): string {
  const socketIp = (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
  if (PRIVATE_RE.test(socketIp)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const forwarded = (Array.isArray(xff) ? xff[0] : xff).split(',')[0]!.trim();
      if (forwarded) return forwarded.replace(/^::ffff:/, '');
    }
  }
  return socketIp;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

type RateTier = 'upload' | 'api' | 'static';

interface HitRecord { start: number; count: number; }
const hits = new Map<string, HitRecord>();

/** Evict expired entries every 5 minutes to prevent unbounded memory growth. */
let lastEvict = Date.now();
function evictExpired(): void {
  const now = Date.now();
  if (now - lastEvict < 5 * 60_000) return;
  lastEvict = now;
  for (const [key, record] of hits) {
    if (now - record.start > config.rateLimitWindowMs) hits.delete(key);
  }
}

/**
 * Per-route tiered rate limiting.
 *  - 'upload' : heavy endpoints (analyze, clean) — 1/3 of global max
 *  - 'api'    : other API endpoints — global max
 *  - 'static' : static file serving — 5× global max
 */
export function rateLimit(req: IncomingMessage, tier: RateTier = 'api'): void {
  evictExpired();
  const ip = clientIp(req);
  const key = `${tier}:${ip}`;
  const now = Date.now();
  const multiplier = tier === 'upload' ? 0.33 : tier === 'static' ? 5 : 1;
  const max = Math.max(1, Math.floor(config.rateLimitMax * multiplier));

  const item = hits.get(key);
  if (!item || now - item.start > config.rateLimitWindowMs) {
    hits.set(key, { start: now, count: 1 });
    return;
  }
  item.count++;
  if (item.count > max) throw new HttpError(429, 'Rate limit exceeded', 'RATE_LIMIT');
}

// ─── Security Headers ─────────────────────────────────────────────────────────

const CSP_API = [
  "default-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const CSP_REPORT = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "script-src 'unsafe-inline'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Apply the full HTTP security header suite.
 * @param isHtml  When true, uses a relaxed CSP suitable for HTML report pages.
 */
export function headers(res: ServerResponse, requestId: string, isHtml = false, req?: IncomingMessage): void {
  // CORS — allow the Vercel frontend (production + all preview URLs) and local dev
  const origin = req?.headers.origin ?? '';
  const isAllowed =
    origin === 'https://metaclean-4k.onrender.com' ||
    /^https:\/\/metaclean-4k[a-zA-Z0-9-]*\.vercel\.app$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const corsOrigin = isAllowed ? origin : 'https://metaclean-4k.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Length');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');

  // Correlation
  res.setHeader('X-Request-Id', requestId);

  // Standard security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', isHtml ? CSP_REPORT : CSP_API);

  // HSTS — only in production (HTTPS only)
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

// ─── Filename Sanitisation ────────────────────────────────────────────────────

/**
 * Strip control characters, quotes, and newlines from a filename so it is safe
 * to embed in a Content-Disposition header.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f]/g, '')   // control characters
    .replace(/["\\\r\n]/g, '_')          // header-injection characters
    .replace(/\.\./g, '_')              // path traversal sequences
    .trim()
    .slice(0, 200) || 'download';       // hard cap to prevent excessively long headers
}

// ─── ID Validation ────────────────────────────────────────────────────────────

/** UUID v4 pattern — the only format our IDs are generated in. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a download/report ID before using it to construct a file path.
 * Rejects anything that is not a strict UUID v4.
 */
export function validateId(id: string): void {
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid resource ID', 'INVALID_ID');
}

// ─── Multipart Guard ──────────────────────────────────────────────────────────

import type { MultipartPart } from './multipart.js';

/**
 * Ensure a multipart upload does not exceed the configured maximum part count.
 * Prevents degenerate inputs that consume excessive parse time or memory.
 */
export function validateMultipartCount(parts: MultipartPart[]): void {
  if (parts.length > config.maxMultipartParts) {
    throw new HttpError(400, `Too many multipart parts (max ${config.maxMultipartParts})`, 'TOO_MANY_PARTS');
  }
}

// ─── Upload Validation ────────────────────────────────────────────────────────

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic', 'heif', 'avif']);

export function validateUpload(
  name: string,
  clientMime: string | undefined,
  data: Buffer,
): { format: string; mime: string } {
  const clean = name.split(/[\\\/]/).pop() ?? 'image';
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) throw new HttpError(415, 'Unsupported file extension', 'UNSUPPORTED_FORMAT');

  const format = detectFormat(data);
  if (format === 'UNKNOWN') throw new HttpError(415, 'File signature is not a supported image format', 'BAD_MAGIC');

  if (format === 'JPEG' && !['jpg', 'jpeg'].includes(ext)) throw new HttpError(400, 'Extension does not match JPEG signature', 'EXT_MISMATCH');
  if (format === 'PNG'  && ext !== 'png')                  throw new HttpError(400, 'Extension does not match PNG signature',  'EXT_MISMATCH');
  if (format === 'WEBP' && ext !== 'webp')                 throw new HttpError(400, 'Extension does not match WebP signature', 'EXT_MISMATCH');
  if (format === 'TIFF' && !['tif', 'tiff'].includes(ext)) throw new HttpError(400, 'Extension does not match TIFF signature', 'EXT_MISMATCH');

  const m: Record<string, string> = {
    JPEG: 'image/jpeg', PNG: 'image/png', WEBP: 'image/webp',
    TIFF: 'image/tiff', HEIC: 'image/heic', HEIF: 'image/heif', AVIF: 'image/avif',
  };
  const mime = m[format] ?? 'application/octet-stream';

  if (clientMime && clientMime !== 'application/octet-stream' && clientMime !== mime) {
    throw new HttpError(400, 'Declared MIME type does not match detected format', 'MIME_MISMATCH');
  }
  return { format, mime };
}

// ─── Error Scrubbing ──────────────────────────────────────────────────────────

/**
 * In production, replace non-HttpError messages with a generic string to avoid
 * leaking internal stack traces, file paths, or library internals.
 */
export function scrubError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (config.isProd) return new HttpError(500, 'An internal error occurred', 'INTERNAL_ERROR');
  return new HttpError(500, err instanceof Error ? err.message : 'Request failed', 'INTERNAL_ERROR');
}
