/**
 * Logger utility for Chessr extension
 * All logs are prefixed with [Chessr.io]
 */

const PREFIX = '[Chessr.io]';

export const logger = {
  log: (message: string, ...data: unknown[]) => {
    if (data.length > 0) {
      console.log(PREFIX, message, ...data);
    } else {
      console.log(PREFIX, message);
    }
  },

  info: (message: string, ...data: unknown[]) => {
    if (data.length > 0) {
      console.info(PREFIX, message, ...data);
    } else {
      console.info(PREFIX, message);
    }
  },

  warn: (message: string, ...data: unknown[]) => {
    if (data.length > 0) {
      console.warn(PREFIX, message, ...data);
    } else {
      console.warn(PREFIX, message);
    }
  },

  error: (message: string, ...data: unknown[]) => {
    if (data.length > 0) {
      console.error(PREFIX, message, ...data);
    } else {
      console.error(PREFIX, message);
    }
  },

  debug: (message: string, ...data: unknown[]) => {
    if (data.length > 0) {
      console.debug(PREFIX, message, ...data);
    } else {
      console.debug(PREFIX, message);
    }
  },
};
