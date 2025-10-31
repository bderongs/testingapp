// This file exposes a minimal logger wrapper to centralise structured logging for the CLI tool.

type LogLevel = 'info' | 'warn' | 'error';

const emit = (level: LogLevel, message: string): void => {
  const timestamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level](`[${timestamp}] ${message}`);
};

export const logger = {
  info: (message: string): void => emit('info', message),
  warn: (message: string): void => emit('warn', message),
  error: (message: string): void => emit('error', message),
};
