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
  // AES-256-GCM keys for field-level encryption (ROADMAP.md O1) — see
  // common/crypto/field-encryption.service.ts. Base64 32-byte values, by
  // key id. Empty `keys` means FIELD_ENCRYPTION_KEY is unset: CryptoModule
  // refuses to start in that case, in every environment.
  fieldEncryption: {
    currentKeyId: string;
    keys: Record<string, string>;
  };
  payments: {
    mercadopago: {
      accessToken?: string;
      webhookSecret?: string;
      // Base URL MercadoPago's servers can reach to deliver the
      // notification_url webhook (e.g. https://<ngrok-id>.ngrok.io in local
      // dev — plain localhost is not reachable from MercadoPago's side).
      // Preference is created without notification_url when unset.
      notificationUrl?: string;
    };
  };
}

// Secrets the backend must never run without in production (ROADMAP.md
// O4). A dev-only fallback for JWT_SECRET is tolerated outside production
// so `npm run start:dev` works out of the box; in production a missing one
// stops the boot instead of silently signing tokens with a public value.
const REQUIRED_IN_PRODUCTION = ['JWT_SECRET', 'FIELD_ENCRYPTION_KEY'] as const;

export function assertProductionSecrets(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !env[name]);
  if (missing.length > 0) {
    // Names only — never values.
    throw new Error(
      `Refusing to start in production: missing required secret(s) ${missing.join(', ')}. ` +
        'They are loaded from AWS Secrets Manager by infra/terraform/scripts/deploy-backend.sh.',
    );
  }
}

// FIELD_ENCRYPTION_KEY (+ FIELD_ENCRYPTION_KEY_ID, default v1) is the key
// every new value is encrypted with. During a rotation, the previous key(s)
// stay readable via FIELD_ENCRYPTION_RETIRED_KEYS="v1=<base64>,v2=<base64>"
// until src/scripts/encrypt-existing-fields.ts --rotate has rewritten every row.
function fieldEncryptionKeyring(env: NodeJS.ProcessEnv): AppConfig['fieldEncryption'] {
  const currentKeyId = env.FIELD_ENCRYPTION_KEY_ID || 'v1';
  const keys: Record<string, string> = {};
  for (const entry of (env.FIELD_ENCRYPTION_RETIRED_KEYS ?? '').split(',')) {
    const sep = entry.indexOf('=');
    if (sep > 0) keys[entry.slice(0, sep).trim()] = entry.slice(sep + 1).trim();
  }
  if (env.FIELD_ENCRYPTION_KEY) keys[currentKeyId] = env.FIELD_ENCRYPTION_KEY;
  return { currentKeyId, keys };
}

export default (): AppConfig => {
  assertProductionSecrets(process.env);
  return buildConfig();
};

const buildConfig = (): AppConfig => ({
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
    // Dev-only fallback; assertProductionSecrets() blocks it in production.
    jwtSecret: process.env.JWT_SECRET ?? 'change-me-dev-only',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  fieldEncryption: fieldEncryptionKeyring(process.env),
  payments: {
    mercadopago: {
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || undefined,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || undefined,
      notificationUrl: process.env.PUBLIC_API_URL || undefined,
    },
  },
});
