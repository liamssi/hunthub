// HuntHub: the subset of Roamgate's utils/logger.ts the endpoint modules use.
export type LogFields = Record<string, unknown>;

export type Logger = {
  enabled(level: "error" | "warn" | "info" | "debug"): boolean;
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
};

export const silentLogger: Logger = {
  enabled: () => false,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  child: () => silentLogger,
};
