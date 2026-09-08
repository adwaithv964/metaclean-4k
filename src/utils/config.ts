import process from 'node:process';

// Comma-separated list of trusted proxy CIDRs/IPs (e.g. Render's load balancer).
// When the direct socket IP is private/loopback and a trusted proxy prefix matches,
// X-Forwarded-For is used to extract the real client IP.
const rawProxies = (process.env.TRUSTED_PROXY_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  port:               Number(process.env.PORT              ?? 8787),
  host:               process.env.HOST                     ?? '0.0.0.0',
  maxUploadBytes:     Number(process.env.MAX_UPLOAD_BYTES  ?? 100 * 1024 * 1024),
  maxPixels:          Number(process.env.MAX_PIXELS        ?? 100_000_000),
  maxProcessMs:       Number(process.env.MAX_PROCESS_MS    ?? 30_000),
  tempRetentionMs:    Number(process.env.TEMP_RETENTION_MS ?? 5 * 60_000),
  rateLimitWindowMs:  Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax:       Number(process.env.RATE_LIMIT_MAX    ?? 30),
  // New security config
  socketTimeoutMs:    Number(process.env.SOCKET_TIMEOUT_MS ?? 30_000),
  maxMultipartParts:  Number(process.env.MAX_MULTIPART_PARTS ?? 10),
  trustedProxyCidrs:  rawProxies.length > 0 ? rawProxies : ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  isProd:             (process.env.NODE_ENV ?? 'development') === 'production',
};
