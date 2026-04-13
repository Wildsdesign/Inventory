/**
 * Lightweight structured logger.
 */

type LogMeta = Record<string, unknown>;

function fmt(level: string, msg: unknown, meta?: LogMeta): string {
  const timestamp = new Date().toISOString();
  const msgStr = msg instanceof Error ? msg.message : String(msg);
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level.toUpperCase()} ${msgStr}${metaStr}`;
}

export const log = {
  event: (msg: string, meta?: LogMeta) => {
    console.log(fmt('info', msg, meta));
  },

  error: (err: unknown, meta?: LogMeta) => {
    const errMeta =
      err instanceof Error
        ? { ...meta, stack: err.stack, name: err.name }
        : { ...meta, error: String(err) };
    console.error(fmt('error', err, errMeta));
  },

  warn: (msg: string, meta?: LogMeta) => {
    console.warn(fmt('warn', msg, meta));
  },

  debug: (msg: string, meta?: LogMeta) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(fmt('debug', msg, meta));
    }
  },
};

export default log;
