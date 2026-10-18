const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAge(startedAt: number | null, now: number): string {
  if (startedAt === null) return '';
  const ms = now - startedAt;
  if (ms < MINUTE) return '刚刚';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} 分钟`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} 小时`;
  return `${Math.floor(ms / DAY)} 天`;
}

export function dropIndex(cardMidpoints: number[], y: number): number {
  const i = cardMidpoints.findIndex((mid) => y < mid);
  return i === -1 ? cardMidpoints.length : i;
}

export function summary(tones: string[]): string {
  const running = tones.filter((t) => t === 'running').length;
  const waiting = tones.filter((t) => t === 'waiting').length;
  const parts = [running > 0 ? `${running} 个运行中` : '', waiting > 0 ? `${waiting} 个等待输入` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join('，') : '没有正在运行的 session';
}
