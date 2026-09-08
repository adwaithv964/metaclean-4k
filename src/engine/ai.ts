import { MetadataItem } from '../types/model.js';

const patterns: Array<[RegExp,string]> = [
  [/\b(?:model|model_name|modelName|checkpoint|ckpt)\s*[:=]\s*["']?([^\n,;"'}]+)/i,'Model'],
  [/\b(?:sampler|sampler_name)\s*[:=]\s*["']?([^\n,;"'}]+)/i,'Sampler'],
  [/\b(?:steps|num_inference_steps)\s*[:=]\s*(\d+)/i,'Steps'],
  [/\b(?:cfg|cfg_scale|guidance_scale)\s*[:=]\s*([0-9.]+)/i,'CFG / Guidance'],
  [/\b(?:seed)\s*[:=]\s*(-?\d+)/i,'Seed'],
  [/\b(?:scheduler)\s*[:=]\s*["']?([^\n,;"'}]+)/i,'Scheduler'],
  [/\b(?:positive prompt|prompt|text_prompt)\s*[:=]\s*["']?([\s\S]{1,500}?)(?:["']?\s*(?:,|\n|$))/i,'Prompt'],
  [/\b(?:negative prompt|negative_prompt)\s*[:=]\s*["']?([\s\S]{1,500}?)(?:["']?\s*(?:,|\n|$))/i,'Negative Prompt'],
  [/\b(?:workflow|workflow_name|graph)\s*[:=]\s*["']?([^\n]{1,250})/i,'Workflow'],
  [/\b(?:vae)\s*[:=]\s*["']?([^\n,;"'}]+)/i,'VAE'],
  [/\b(?:lora|loras)\s*[:=]\s*["']?([^\n;]+?)(?:[\n;]|$)/i,'LoRA'],
  [/\b(?:denoising strength|denoising_strength|denoise)\s*[:=]\s*([0-9.]+)/i,'Denoising Strength'],
  [/\b(?:clip skip|clip_skip)\s*[:=]\s*(\d+)/i,'Clip Skip'],
  [/\b(?:controlnet|control_net)\s*[:=]\s*([^\n;]+)/i,'ControlNet'],
  [/\b(?:upscal(?:er|ing))\s*[:=]\s*([^\n;]+)/i,'Upscaling']
];

const known = [
  'Stable Diffusion','SDXL','FLUX','ComfyUI','AUTOMATIC1111','Automatic1111','InvokeAI','Midjourney','Adobe Firefly','Gemini','Imagen','DALL-E'
];

export function detectAiMetadata(text: string): MetadataItem[] {
  const compact = text.replaceAll('\0',' ');
  const out: MetadataItem[]=[];
  for(const [re,label] of patterns){ const m=compact.match(re); if(m?.[1]) out.push({path:`AI/${label}`,group:'ai',value:m[1].trim().slice(0,1000),source:'Embedded textual metadata',confidence:'confirmed',removable:true}); }
  for(const k of known) if(compact.toLowerCase().includes(k.toLowerCase())) out.push({path:'AI/Generator',group:'ai',value:k,source:'Embedded metadata string',confidence:'confirmed',removable:true});
  if(/steps\s*[:=]|cfg[_ ]?scale\s*[:=]|sampler\s*[:=]|seed\s*[:=]/i.test(compact) && out.length===0) out.push({path:'AI/Generation parameters',group:'ai',value:'AI-generation parameter syntax detected',source:'Embedded metadata text',confidence:'heuristic',removable:true});
  return out;
}
