import 'dotenv/config';

const required = ['MONGODB_URI', 'JWT_SECRET'];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Falta variable de entorno: ${k}`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  mp: { accessToken: process.env.MP_ACCESS_TOKEN, webhookSecret: process.env.MP_WEBHOOK_SECRET },
  wa: { verifyToken: process.env.WA_VERIFY_TOKEN, appSecret: process.env.WA_APP_SECRET },
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  peya: { clientId: process.env.PEYA_CLIENT_ID, clientSecret: process.env.PEYA_CLIENT_SECRET },
  workerPollMs: Number(process.env.WORKER_POLL_MS) || 2000,
  // Rol del proceso: 'api' (solo HTTP), 'worker' (solo cola) o 'all' (ambos en un proceso).
  // Permite un único start command para múltiples servicios en Railway.
  serviceRole: process.env.SERVICE_ROLE || 'api',
  // Parámetro de admin: ¿se aceptan registros de comercios nuevos? (toggle desde Railway)
  registrationOpen: process.env.REGISTRATION_OPEN !== 'false',
  // Email del dueño de la app (único root): solo esa cuenta ve el panel de administración.
  rootEmail: (process.env.ROOT_EMAIL || 'brnab84@gmail.com').toLowerCase(),
  // Clave para cifrar secretos por tenant en DB (tokens de WA/IG/MP). Fallback a JWT_SECRET.
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET,
};
