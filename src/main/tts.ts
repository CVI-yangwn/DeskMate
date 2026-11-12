import { spawn } from 'node:child_process';

/**
 * macOS 自带 say。没有音频流，所以这里只负责发声；
 * 口型由 renderer 按 speakingMs 做合成包络。
 */
export function speakWithSay(text: string): number {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!clean) return 0;

  const estimate = Math.max(1800, Math.min(9000, clean.length * 150));

  if (process.platform !== 'darwin') {
    return estimate;
  }

  const speak = (voice?: string) => {
    const args = voice ? ['-v', voice, '-r', '180', clean] : ['-r', '180', clean];
    const child = spawn('say', args, { stdio: 'ignore' });
    child.on('error', () => {
      // say 不可用时静默降级到气泡
    });
    child.on('exit', (code) => {
      if (code !== 0 && voice) {
        const fallback = spawn('say', ['-r', '180', clean], { stdio: 'ignore' });
        fallback.on('error', () => undefined);
      }
    });
  };

  speak('Tingting');
  return estimate;
}
