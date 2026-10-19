export interface AttachTerminalOptions {
  name: string;
  cwd?: string;
  shellPath: string;
  shellArgs: string[];
  hideFromUser: boolean;
}

/**
 * The terminal's process is `claude attach <id>` itself (no shell in between): detaching
 * ends the terminal, so the next click on the card creates a fresh one and re-attaches.
 */
export function attachTerminalOptions(o: {
  shortId: string;
  name: string;
  cwd: string;
  claudePath: string;
  cwdExists: boolean;
}): AttachTerminalOptions {
  return {
    name: `Claude: ${o.name}`,
    ...(o.cwd && o.cwdExists ? { cwd: o.cwd } : {}),
    shellPath: o.claudePath,
    shellArgs: ['attach', o.shortId],
    // Extensions such as Python Environments type `source …/activate` into every new terminal,
    // which here would land in Claude's prompt; they skip hideFromUser terminals. The caller
    // calls show() right away, so the terminal is still revealed.
    hideFromUser: true,
  };
}
