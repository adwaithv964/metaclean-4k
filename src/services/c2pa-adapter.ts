import type { C2paSummary } from '../types/model.js';

export async function validateWithOfficialC2pa(data: Uint8Array, mimeType: string, structural: boolean): Promise<C2paSummary | null> {
  if (!structural) return null;
  try {
    // Optional because the current sandbox has no network/package registry access.
    // @ts-ignore - optional runtime dependency, intentionally absent in this sandbox.
    const mod = await import('@contentauth/c2pa-node');
    const reader = await mod.Reader.fromAsset({ buffer: Buffer.from(data), mimeType }, { verify: { verify_after_reading: true, verify_trust: true } });
    if (!reader) return null;
    const store = reader.json() as Record<string, unknown>;
    const active = typeof reader.getActive === 'function' ? reader.getActive() as Record<string, unknown> : undefined;
    const summary: C2paSummary = {
      present: true,
      structural: true,
      validation: 'Unknown',
      signer: undefined,
      created: typeof active?.claim_generator === 'string' ? active.claim_generator : undefined,
      software: typeof active?.claim_generator === 'string' ? active.claim_generator : undefined,
      aiGeneration: 'Unknown',
      actions: [],
      manifestCount: Array.isArray((store as { manifests?: unknown }).manifests) ? ((store as { manifests: unknown[] }).manifests).length : 1,
      warning: 'Official C2PA reader loaded, but trust/signature fields require the manifest-specific verification result returned by the installed SDK version.'
    };
    const json = JSON.stringify(store);
    if (/"valid"\s*:\s*true|validation.*valid/i.test(json)) summary.validation = 'Valid';
    if (/"valid"\s*:\s*false|validation.*invalid/i.test(json)) summary.validation = 'Invalid';
    if (/ai|machine[- ]generated|generative/i.test(json)) summary.aiGeneration = 'Detected';
    for (const action of ['generated','created','edited','resized','exported']) if (new RegExp(action,'i').test(json)) summary.actions.push(action[0].toUpperCase()+action.slice(1));
    return summary;
  } catch {
    return null;
  }
}
