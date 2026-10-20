/* eslint-disable no-console -- this module is the single console gateway. */

export interface Logger {
  /** Diagnostics, printed only when debug mode is on. */
  debug(...args: unknown[]): void;
  /** Unexpected failures, always printed. */
  error(...args: unknown[]): void;
}

export function createLogger(scope: string, isDebug: () => boolean): Logger {
  const prefix = `[Menu Account Switcher:${scope}]`;
  return {
    debug: (...args) => {
      if (isDebug()) console.debug(prefix, ...args);
    },
    error: (...args) => {
      console.error(prefix, ...args);
    },
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  error: () => undefined,
};
