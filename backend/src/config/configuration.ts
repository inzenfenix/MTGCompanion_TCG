// Single typed read of process.env, consumed via ConfigService<AppConfig>.
// Keeps every module's env-var name in one place instead of scattered
// process.env[...] reads.

export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
  };
  storage: {
    endpoint?: string;
    forcePathStyle: boolean;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  email: {
    provider: 'smtp' | 'ses';
    from: string;
    smtp: {
      host: string;
      port: number;
    };
    ses: {
      region: string;
    };
  };
  auth: {
    jwtSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  payments: {
    mercadopago: {
      accessToken?: string;
      webhookSecret?: string;
    };
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket: process.env.STORAGE_BUCKET ?? 'mtg-card-photos',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
  },
  email: {
    provider: (process.env.EMAIL_PROVIDER as 'smtp' | 'ses') ?? 'smtp',
    from: process.env.EMAIL_FROM ?? 'MTG Companion <no-reply@mtgcompanion.app>',
    smtp: {
      host: process.env.SMTP_HOST ?? 'localhost',
      port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    },
    ses: {
      region: process.env.AWS_REGION ?? 'us-east-1',
    },
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'change-me-dev-only',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  payments: {
    mercadopago: {
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || undefined,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || undefined,
    },
  },
});
