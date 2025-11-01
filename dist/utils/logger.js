// This file exposes a minimal logger wrapper to centralise structured logging for the CLI tool.
const emit = (level, message) => {
    const timestamp = new Date().toISOString();
    // eslint-disable-next-line no-console
    console[level](`[${timestamp}] ${message}`);
};
export const logger = {
    info: (message) => emit('info', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
};
