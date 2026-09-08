# Engineering Notes

## Processing policy

The preferred operation is byte-level/container surgery that preserves compressed image payloads. A cleaned artifact is never accepted until it is parsed again and its dimensions, format, and requested metadata-removal invariants have passed verification.

### JPEG

JPEG markers are parsed without decoding. EXIF/XMP/IPTC/JUMBF-related APP segments and COM comments can be dropped by copying every other marker and the entropy-coded scan unchanged. APP14 Adobe and APP2 ICC are preserved by default because they can affect rendering.

### PNG

PNG chunks are copied except removable metadata chunks (`tEXt`, `zTXt`, `iTXt`, `eXIf`, `caBX`). IDAT is copied byte-for-byte. iCCP and pHYs are preserved because they can affect color or display behavior.

### WebP

RIFF chunks are copied except `EXIF`, `XMP ` and `JUMBF`/C2PA container chunks. The image payload chunks `VP8 ` / `VP8L` / `ANIM` / `ANMF` are not decoded or recompressed. ICCP is preserved by default.

### TIFF

The implementation supports conservative classic TIFF IFD rewriting. Pixel strips/tiles are retained. Metadata tag entries not needed for image decoding are removed. The engine refuses BigTIFF and uncertain structures rather than claiming lossless removal. This is deliberately narrower than ExifTool's general-purpose writer because ExifTool's own documentation states that complete metadata deletion is format-dependent.

## C2PA

The official Content Authenticity Initiative JavaScript documentation states that `@contentauth/c2pa-node` is the supported Node.js reader/validator and that it can read/validate C2PA manifests. The package is declared as an optional dependency at the currently published 0.9.3 release. In this sandbox it could not be installed because outbound npm/DNS access is unavailable, so runtime falls back to structural C2PA detection/removal and marks cryptographic validation as `Validation unavailable`. When the optional package is installed, the adapter invokes `Reader.fromAsset` with verification enabled and surfaces the SDK result without inventing trust claims. It never invents signer, validity, or trust status.

C2PA's specification defines JPEG APP11 and PNG `caBX` as embedding locations. Removal of a signed manifest removes the provenance information from the exported file and may break provenance continuity.

## AI metadata

Detection is metadata-driven. The parser scans EXIF/XMP/IPTC textual fields and common generator parameter JSON/text conventions for model, seed, sampler, prompt, workflow, CFG, steps, scheduler, VAE, LoRA, checkpoint and similar fields. Results are marked `Confirmed from metadata` only when a concrete metadata field supports the value; raw string-pattern matches are marked heuristic.
