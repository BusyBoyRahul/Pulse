import dotenv from 'dotenv';

dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) {
    return fallback;
  }
  return v === 'true' || v === '1';
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map(s => s.trim()),

  jwtSecret: req('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  otpDevMode: bool('OTP_DEV_MODE', true),

  // Server's Curve25519 secret key (base64) used to open sealed SOS payloads.
  // Its matching public key lives in the app's config.serverPublicKey.
  sealSecret: process.env.SERVER_SEAL_SECRET ?? '',

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'pulse',
    password: process.env.DB_PASSWORD ?? 'pulse',
    database: process.env.DB_NAME ?? 'pulse',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? '',
    messagingFrom: process.env.TWILIO_MESSAGING_FROM ?? '',
  },

  push: {
    fcmServerKey: process.env.FCM_SERVER_KEY ?? '',
    oneSignalAppId: process.env.ONESIGNAL_APP_ID ?? '',
    oneSignalApiKey: process.env.ONESIGNAL_API_KEY ?? '',
  },

  get isProd() {
    return this.nodeEnv === 'production';
  },
};

export default env;
