/** GUI 控制默认开启；显式 0/false/off/no 才关闭。 */
export function parseGuiEnabled(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}
