import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'crop.py');
const python = process.env.DESKMATE_PYTHON || 'python3';

/** 绝对像素裁剪并缩放到 outW x outH（Pillow，避免 sips 的中心裁剪语义）。 */
export function cropImage(src, dst, rect, outW, outH) {
  execFileSync(
    python,
    [
      script,
      src,
      dst,
      String(Math.round(rect.x)),
      String(Math.round(rect.y)),
      String(Math.round(rect.w)),
      String(Math.round(rect.h)),
      String(Math.round(outW)),
      String(Math.round(outH)),
    ],
    { stdio: 'ignore' },
  );
}
