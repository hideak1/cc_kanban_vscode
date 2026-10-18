export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function attachCommand(claudePath: string, shortId: string): string {
  return `${shellQuote(claudePath)} attach ${shortId}`;
}
