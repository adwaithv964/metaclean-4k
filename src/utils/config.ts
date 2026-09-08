import process from 'node:process';
export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  maxPixels: Number(process.env.MAX_PIXELS ?? 100_000_000),
  maxProcessMs: Number(process.env.MAX_PROCESS_MS ?? 30_000),
  tempRetentionMs: Number(process.env.TEMP_RETENTION_MS ?? 5 * 60_000),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 30)
};
