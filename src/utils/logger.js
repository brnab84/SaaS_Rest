import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.nodeEnv === 'production' ? 'info' : 'debug',
  redact: ['req.headers.authorization', '*.tokenRef', '*.accessToken', '*.password'],
});
