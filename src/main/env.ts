import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface DeepSeekEnv {
  apiKey: string;
  baseUrl: string;
  model: string;
  visionModel: string;
}

let cached: DeepSeekEnv | null = null;

function parseEnvFile(file: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(file)) return result;

  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadFiles(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(app.getPath('userData'), '.env.local'),
    path.join(app.getPath('userData'), '.env'),
    path.join(app.getAppPath(), '.env.local'),
    path.join(app.getAppPath(), '.env'),
  ];

  const seen = new Set<string>();
  const merged: Record<string, string> = {};
  for (const file of candidates) {
    const real = path.resolve(file);
    if (seen.has(real)) continue;
    seen.add(real);
    Object.assign(merged, parseEnvFile(real));
  }
  return merged;
}

export function getDeepSeekEnv(): DeepSeekEnv {
  if (cached) return cached;

  const fileEnv = loadFiles();
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() ||
    fileEnv.DEEPSEEK_API_KEY?.trim() ||
    '';
  const baseUrl =
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    fileEnv.DEEPSEEK_BASE_URL?.trim() ||
    'https://oneapi-comate.baidu-int.com/v1';
  const model =
    process.env.DEEPSEEK_MODEL?.trim() ||
    fileEnv.DEEPSEEK_MODEL?.trim() ||
    'DeepSeek-V4.1-Flash';
  const visionModel =
    process.env.DEEPSEEK_VISION_MODEL?.trim() ||
    fileEnv.DEEPSEEK_VISION_MODEL?.trim() ||
    'DeepSeek-V4-Flash-Vision-Exp';

  cached = {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    visionModel,
  };
  return cached;
}
