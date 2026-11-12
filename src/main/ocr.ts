import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export interface OcrLine {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  width: number;
  height: number;
}

function binaryPath(): string | null {
  if (process.platform !== 'darwin') return null;
  const candidates = [
    path.join(process.cwd(), 'native/ocr'),
    path.join(app.getAppPath(), 'native/ocr'),
    path.join(process.resourcesPath, 'native/ocr'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export async function runOcr(imageBase64: string): Promise<OcrResult | null> {
  const binary = binaryPath();
  if (!binary) return null;

  const file = path.join(os.tmpdir(), `deskmate-ocr-${process.pid}-${randomUUID()}.jpg`);
  try {
    fs.writeFileSync(file, Buffer.from(imageBase64, 'base64'), { mode: 0o600 });
    const { stdout } = await execFileAsync(binary, [file], {
      timeout: 8_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as OcrResult;
    if (!parsed || typeof parsed.text !== 'string' || !Array.isArray(parsed.lines)) return null;
    return {
      text: parsed.text.slice(0, 8_000),
      lines: parsed.lines.slice(0, 120),
      width: Number(parsed.width) || 0,
      height: Number(parsed.height) || 0,
    };
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore cleanup failure
    }
  }
}
