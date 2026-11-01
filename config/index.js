import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  frontendOrigin: env.FRONTEND_ORIGIN || `http://localhost:${env.PORT || 3000}`,
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'light_assistant',
  },
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: env.GOOGLE_CALLBACK_URL || `http://localhost:${env.PORT || 3000}/auth/google/callback`,
  },
  integrationCallbackUrl:
    env.GOOGLE_INTEGRATION_CALLBACK_URL ||
    (env.GOOGLE_CALLBACK_URL || `http://localhost:${env.PORT || 3000}/auth/google/callback`).replace('/auth/google/callback', '/auth/integrations/callback'),
  sessionSecret: env.SESSION_SECRET || '',
  encryptionKey: env.ENCRYPTION_KEY || '',
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  ai: {
    provider: env.AI_PROVIDER || 'rules',
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    ollamaModel: env.OLLAMA_MODEL || 'llama3.2',
    cloudUrl: env.CLOUD_AI_URL || '',
    cloudKey: env.CLOUD_AI_KEY || '',
    cloudModel: env.CLOUD_AI_MODEL || '',
  },
};

export function assertConfig() {
  const problems = [];
  if (!config.sessionSecret || config.sessionSecret.length < 16) problems.push('SESSION_SECRET must be set (16+ chars)');
  if (isProd && !config.frontendOrigin.startsWith('https://')) problems.push('FRONTEND_ORIGIN must be https in production');
  if (problems.length) throw new Error('Invalid configuration: ' + problems.join('; '));
  if (!config.google.clientId || !config.google.clientSecret) {
    console.warn('[config] Google OAuth is not configured: sign-in will be unavailable until GOOGLE_CLIENT_ID/SECRET are set.');
  }
}
