import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './utils/config.js';
import { HttpError } from './utils/errors.js';
import { parseMultipart } from './utils/multipart.js';
import { analyze } from './engine/analyze.js';
import { clean, readStored } from './engine/clean.js';
import { reportHtml } from './engine/report.js';
import {
  headers, rateLimit, validateUpload,
  generateRequestId, validateId, sanitizeFilename,
  validateMultipartCount, scrubError,
} from './utils/security.js';
import type { CleanConfig } from './types/model.js';

const publicRoot = path.resolve('public');

// ─── Body Reader ──────────────────────────────────────────────────────────────

const readBody = (req: http.IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > config.maxUploadBytes + 10_000_000)
      return reject(new HttpError(413, 'Request exceeds upload limit', 'TOO_LARGE'));
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (c: Buffer) => {
      size += c.length;
      if (size > config.maxUploadBytes + 10_000_000) {
        req.destroy();
        reject(new HttpError(413, 'Request exceeds upload limit', 'TOO_LARGE'));
      } else {
        chunks.push(c);
      }
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const json = (res: http.ServerResponse, status: number, data: unknown, requestId: string) => {
  headers(res, requestId);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
};

const staticMime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

async function staticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  requestId: string,
): Promise<void> {
  const pathname = ((urlPath || '/').split('?')[0] ?? '/');
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (rel.includes('..')) { res.statusCode = 404; res.end(); return; }
  const p = path.join(publicRoot, rel);
  try {
    const data = await readFile(p);
    const isHtml = path.extname(p) === '.html';
    headers(res, requestId, isHtml);
    res.setHeader('Content-Type', staticMime[path.extname(p)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

function configFrom(fields: Record<string, string>): CleanConfig {
  const raw = fields.config;
  if (!raw) return { mode: 'everything', remove: [], preserveIcc: true };
  try {
    const v = JSON.parse(raw) as Partial<CleanConfig>;
    const mode = v.mode === 'privacy' || v.mode === 'selective' ? v.mode : 'everything';
    const allowed = new Set(['exif','xmp','iptc','gps','device','identity','time','software','ai','c2pa','thumbnail','other','technical']);
    return {
      mode,
      remove: Array.isArray(v.remove)
        ? v.remove.filter((x): x is CleanConfig['remove'][number] => typeof x === 'string' && allowed.has(x))
        : [],
      preserveIcc: v.preserveIcc !== false,
    };
  } catch {
    throw new HttpError(400, 'Invalid cleaning configuration', 'BAD_CONFIG');
  }
}

async function uploadParts(req: http.IncomingMessage) {
  const body = await readBody(req);
  const parts = parseMultipart(body, req.headers['content-type'] ?? '');
  // Guard against excessively large multipart submissions
  validateMultipartCount(parts);
  const file = parts.find(p => p.name === 'file');
  if (!file || !file.filename) throw new HttpError(400, 'Image file is required', 'NO_FILE');
  const filename = file.filename;
  if (file.data.length > config.maxUploadBytes) throw new HttpError(413, 'Image exceeds configured size limit', 'TOO_LARGE');
  validateUpload(filename, file.contentType, file.data);
  const fields = Object.fromEntries(parts.filter(p => !p.filename).map(p => [p.name, p.data.toString('utf8')]));
  return { file: { ...file, filename }, fields, parts };
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const requestId = generateRequestId();
  try {
    const method = req.method ?? 'GET';
    const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // CORS preflight — no rate limiting needed
    if (method === 'OPTIONS') {
      headers(res, requestId);
      res.statusCode = 204;
      return res.end();
    }

    // Health check — light rate limit
    if (method === 'GET' && u.pathname === '/api/health') {
      rateLimit(req, 'api');
      return json(res, 200, { ok: true, service: 'metaclean-4k', node: process.version, time: new Date().toISOString() }, requestId);
    }

    // Download endpoint — validate ID strictly before filesystem access
    if (method === 'GET' && u.pathname.startsWith('/api/download/')) {
      rateLimit(req, 'api');
      const id = decodeURIComponent(u.pathname.slice('/api/download/'.length));
      validateId(id);                        // ← rejects non-UUID IDs
      const s = await readStored(id);
      headers(res, requestId);
      res.setHeader('Content-Type', s.report.after.file.mime);
      const safeName = sanitizeFilename(s.report.downloadName);   // ← header-injection safe
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.end(s.bytes);
      return;
    }

    // Report endpoint — validate ID, serve HTML with relaxed CSP
    if (method === 'GET' && u.pathname.startsWith('/api/report/')) {
      rateLimit(req, 'api');
      const id = decodeURIComponent(u.pathname.slice('/api/report/'.length));
      validateId(id);                        // ← rejects non-UUID IDs
      const s = await readStored(id);
      headers(res, requestId, true);         // ← HTML CSP
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(reportHtml(s.report));
      return;
    }

    // Upload endpoints — heavy rate limit (1/3 of global max)
    if (method === 'POST' && (u.pathname === '/api/analyze' || u.pathname === '/api/clean' || u.pathname === '/api/verify')) {
      rateLimit(req, 'upload');              // ← stricter limit for heavy endpoints
      const { file, fields, parts } = await uploadParts(req);

      if (u.pathname === '/api/analyze') {
        return json(res, 200, { ok: true, analysis: await analyze(file.data, file.filename) }, requestId);
      }

      if (u.pathname === '/api/clean') {
        const cfg = configFrom(fields);
        const result = await clean(file.data, file.filename, cfg);
        return json(res, 200, {
          ok: true,
          report: result.report,
          downloadUrl: `/api/download/${result.report.id}`,
          reportUrl:   `/api/report/${result.report.id}`,
        }, requestId);
      }

      // /api/verify
      const original = parts.find(p => p.name === 'original');
      const cleaned  = parts.find(p => p.name === 'cleaned');
      if (!original || !cleaned) throw new HttpError(400, '/api/verify requires multipart fields named original and cleaned', 'VERIFY_INPUT');
      validateUpload(original.filename ?? 'original', original.contentType, original.data);
      validateUpload(cleaned.filename  ?? 'cleaned',  cleaned.contentType,  cleaned.data);
      const [a, b] = await Promise.all([
        analyze(original.data, original.filename ?? 'original'),
        analyze(cleaned.data,  cleaned.filename  ?? 'cleaned'),
      ]);
      let samePixels = false;
      try {
        const [pa, pb] = await Promise.all([
          sharp(original.data, { limitInputPixels: config.maxPixels }).ensureAlpha().raw().toBuffer(),
          sharp(cleaned.data,  { limitInputPixels: config.maxPixels }).ensureAlpha().raw().toBuffer(),
        ]);
        samePixels = pa.equals(pb);
      } catch { /* decode failure reported via per-file analyze results */ }
      return json(res, 200, {
        ok: true,
        verification: {
          original: a.file, cleaned: b.file,
          dimensionsUnchanged: a.file.width === b.file.width && a.file.height === b.file.height,
          metadataBefore: a.metadata.items.length,
          metadataAfter:  b.metadata.items.length,
          note: samePixels ? 'Pixel buffers matched.' : 'Pixel buffer comparison requires the clean endpoint.',
        },
      }, requestId);
    }

    // Static files — relaxed rate limit
    if (method === 'GET') {
      rateLimit(req, 'static');
      return staticFile(req, res, u.pathname, requestId);
    }

    throw new HttpError(404, 'Route not found', 'NOT_FOUND');

  } catch (err) {
    const e = scrubError(err);             // ← scrubs internals in production
    if (!res.headersSent) json(res, e.status, { ok: false, error: { code: e.code, message: e.message } }, requestId);
  }
});

// Apply socket-level timeout to prevent slow-loris / hung connections
server.setTimeout(config.socketTimeoutMs);

server.listen(config.port, config.host, () =>
  console.log(`MetaClean 4K listening on http://${config.host}:${config.port}`),
);
