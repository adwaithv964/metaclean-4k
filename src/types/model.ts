export type ImageFormat = 'JPEG' | 'PNG' | 'WEBP' | 'TIFF' | 'HEIC' | 'HEIF' | 'AVIF' | 'UNKNOWN';
export type ProcessingStatus = 'LOSSLESS METADATA REMOVAL' | 'PIXEL DATA UNCHANGED' | 'REENCODING REQUIRED' | 'LOSSLESS TRANSFORM' | 'QUALITY-PRESERVING FALLBACK' | 'UNSUPPORTED';
export type MetadataCategory = 'exif' | 'xmp' | 'iptc' | 'gps' | 'device' | 'identity' | 'time' | 'software' | 'ai' | 'c2pa' | 'thumbnail' | 'technical' | 'other';

export interface MetadataItem { path: string; group: MetadataCategory; value: string; source: string; confidence: 'confirmed' | 'heuristic'; removable: boolean; reason?: string; }
export interface MetadataSummary { counts: Record<MetadataCategory, number>; present: Record<MetadataCategory, boolean>; items: MetadataItem[]; }
export interface C2paSummary { present: boolean; structural: boolean; validation: 'Valid' | 'Invalid' | 'Unknown' | 'Validation unavailable'; signer?: string; created?: string; software?: string; aiGeneration?: 'Detected' | 'Not Detected' | 'Unknown'; actions: string[]; manifestCount: number; warning?: string; }
export interface ImageInfo { format: ImageFormat; mime: string; width: number; height: number; size: number; fileHash: string; pixelFormat: string; channels: number; bitDepth: number | null; alpha: boolean; colorProfile: string; }
export interface AnalysisResult { file: ImageInfo; metadata: MetadataSummary; c2pa: C2paSummary; processing: { status: ProcessingStatus; reason: string; }; warnings: string[]; }
export interface CleanConfig { mode: 'everything' | 'privacy' | 'selective'; remove: MetadataCategory[]; preserveIcc: boolean; }
export interface CleanReport { id: string; createdAt: string; before: AnalysisResult; after: AnalysisResult; actions: { removed: string[]; preserved: string[]; skipped: string[]; unsupported: string[] }; integrity: { dimensions: boolean; pixelData: 'UNCHANGED' | 'MODIFIED' | 'NOT_VERIFIABLE'; colorProfile: boolean; alpha: boolean; bitDepth: boolean; originalHash: string; cleanedHash: string; pixelHashBefore?: string; pixelHashAfter?: string; fileSizeBefore: number; fileSizeAfter: number; }; downloadName: string; warnings: string[]; }
