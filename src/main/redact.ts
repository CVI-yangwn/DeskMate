const REPLACEMENT = '[已脱敏]';

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g,
  /\b\d{17}[\dXx]\b/g,
  /\b(?:\d[ -]?){13,19}\b/g,
];

/**
 * 只用于“证据送模前”的脱敏，不改库里的原文。
 * 目标是阻断常见密钥/联系方式/证件/卡号，不追求完美 DLP。
 */
export function redactSensitive(text: string): string {
  if (!text) return '';
  let next = text;
  for (const pattern of PATTERNS) {
    next = next.replace(pattern, REPLACEMENT);
  }
  return next;
}

export function containsSensitive(text: string): boolean {
  return PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
