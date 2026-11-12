import { spawn, type ChildProcess } from 'node:child_process';

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

  // 新的语音会打断上一条，避免聊天和主动提醒同时说话。
  runSay(['-v', 'Tingting', '-r', '180', clean], ['-r', '180', clean]);
  return estimate;
}
