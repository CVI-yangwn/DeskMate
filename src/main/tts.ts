import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { SayVoice } from '../shared/types';

interface SayProcess {
  child: ChildProcess;
  cancelled: boolean;
}

let current: SayProcess | null = null;

function cancelCurrent(): void {
  if (!current) return;
  current.cancelled = true;
  try {
    current.child.kill();
  } catch {
    // the process may already have exited
  }
  current = null;
}

function runSay(args: string[], fallbackArgs?: string[]): void {
  cancelCurrent();

  const handle: SayProcess = {
    child: spawn('say', args, { stdio: 'ignore' }),
    cancelled: false,
  };
  current = handle;

  handle.child.on('error', () => {
    if (current === handle) current = null;
  });
  handle.child.on('exit', (code) => {
    if (current === handle) current = null;
    if (!handle.cancelled && code !== 0 && fallbackArgs) {
      runSay(fallbackArgs);
    }
  });
}

export interface SpeakOptions {
  voice?: string;
  rate?: number;
}

const FALLBACK_VOICES: SayVoice[] = [
  { name: 'Tingting', locale: 'zh_CN' },
  { name: 'Samantha', locale: 'en_US' },
  { name: 'Daniel', locale: 'en_GB' },
  { name: 'Kyoko', locale: 'ja_JP' },
];

function clampRate(value: number | undefined): number {
  return Math.min(260, Math.max(120, Math.round(Number(value) || 180)));
}

let cachedVoices: SayVoice[] | null = null;

export function listSayVoices(): SayVoice[] {
  if (cachedVoices) return cachedVoices;
  if (process.platform !== 'darwin') return FALLBACK_VOICES;
  try {
    const output = execFileSync('say', ['-v', '?'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 4000,
    });
    const voices: SayVoice[] = [];
    const seen = new Set<string>();
    for (const line of output.split('\n')) {
      const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s/);
      if (!match) continue;
      const name = match[1].trim();
      const locale = match[2];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      voices.push({ name, locale });
    }
    for (const fallback of FALLBACK_VOICES) {
      if (!seen.has(fallback.name)) voices.push(fallback);
    }
    cachedVoices = voices;
    return voices;
  } catch {
    cachedVoices = FALLBACK_VOICES;
    return FALLBACK_VOICES;
  }
}

/**
 * macOS 自带 say。没有音频流，所以这里只负责发声；
 * 口型由 renderer 按 speakingMs 做合成包络。
 */
export function speakWithSay(text: string, options: SpeakOptions = {}): number {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!clean) return 0;

  const estimate = Math.max(1800, Math.min(9000, clean.length * 150));
  if (process.platform !== 'darwin') return estimate;

  const voice = options.voice?.trim() || 'Tingting';
  const rate = clampRate(options.rate);
  // 新的语音会打断上一条，避免聊天和主动提醒同时说话。
  runSay(
    ['-v', voice, '-r', String(rate), clean],
    ['-r', String(rate), clean],
  );
  return estimate;
}
