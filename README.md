# MetaClean 4K

A privacy-first image metadata/provenance inspection and removal service. The application uses format-aware container surgery where possible and re-parses every output before download.

## Runtime

This bootstrap uses Node.js 22 + TypeScript and a dependency-light browser frontend because the supplied workspace did not contain an existing repository. Sharp is used **read-only** for raster property inspection and decoded pixel comparison; it is not used to write cleaned JPEG/PNG/WebP/TIFF files in the metadata-only path.

C2PA validation is intentionally reported as unavailable unless the official `@contentauth/c2pa-node` package is installed. Structural C2PA detection/removal for embedded JPEG APP11 and PNG `caBX` containers is implemented. The C2PA specification identifies JPEG APP11 and PNG caBX as manifest embedding locations. See docs/ENGINEERING.md.

## Development

```bash
node scripts/prepare-runtime.mjs
npm run build
npm test
HOST=127.0.0.1 PORT=8787 node dist/src/server.js
```

Open http://127.0.0.1:8787.

## API

- POST `/api/analyze`
- POST `/api/clean`
- POST `/api/verify`
- GET `/api/health`

All upload endpoints accept `multipart/form-data` with `file` and optional `config` JSON.

## Supported formats

- JPEG/JPG: structural segment removal, no JPEG decode/re-encode
- PNG: structural chunk removal, IDAT preserved
- WebP: RIFF chunk removal, VP8/VP8L preserved
- TIFF: conservative classic-TIFF IFD cleaning when safe; BigTIFF and unknown structures are rejected rather than rewritten
- HEIC/HEIF/AVIF: recognized but not cleaned by this release

ICC profiles are preserved by default because they can affect color rendering. Orientation is preserved rather than silently normalized.

## Security

Uploads are treated as hostile. The service uses magic-byte detection, extension/MIME mismatch checks, file-size and pixel-count ceilings, bounded buffering, random temporary paths, strict response headers, rate limiting, redacted logging, and deletion in `finally` blocks. Embedded URLs are data only; no network fetching is performed.
