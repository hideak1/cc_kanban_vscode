const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAge(startedAt: number | null, now: number): string {
  if (startedAt === null) return '';
  const ms = now - startedAt;
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

export function dropIndex(cardMidpoints: number[], y: number): number {
  const i = cardMidpoints.findIndex((mid) => y < mid);
  return i === -1 ? cardMidpoints.length : i;
}

export function summary(tones: string[]): string {
  const running = tones.filter((t) => t === 'running').length;
  const waiting = tones.filter((t) => t === 'waiting').length;
  const parts = [running > 0 ? `${running} running` : '', waiting > 0 ? `${waiting} need${waiting === 1 ? 's' : ''} input` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No sessions running';
}
