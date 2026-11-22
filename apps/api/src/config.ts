import { isDimension, isSeverity, type Budget } from '@fns/core';
import { z } from 'zod';

const csv = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const budgetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'id em kebab-case'),
    name: z.string().min(1).max(120),
    amount: z.number().positive(),
    scope: z
      .object({
        dimension: z.string().refine(isDimension, 'dimensão inválida'),
        key: z.string().min(1),
      })
      .optional(),
    thresholds: z.array(z.number().gt(0).lte(2)).max(5).optional(),
  })
  .strict();

const SOURCES = ['demo', 'files', 'aws', 'azure'] as const;
type SourceName = (typeof SOURCES)[number];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    API_KEY: z.string().min(32, 'API_KEY precisa de 32+ caracteres').optional(),
    CORS_ORIGIN: z.string().optional(),
    SOURCES: z
      .string()
      .default('demo')
      .transform(csv)
      .refine((items) => items.every((s) => (SOURCES as readonly string[]).includes(s)), {
        message: `SOURCES aceita: ${SOURCES.join(', ')}`,
      })
      .transform((items) => items as SourceName[]),
    DATA_DIR: z.string().default('./data'),
    AWS_PAYER_ACCOUNT_ID: z
      .string()
      .regex(/^\d{12}$/)
      .optional(),
    AZURE_SCOPE: z.string().optional(),
    SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(360),
    SYNC_DAYS: z.coerce.number().int().min(1).max(365).default(35),
    BUDGETS: z
      .string()
      .default('[]')
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'BUDGETS não é JSON válido' });
          return z.NEVER;
        }
      })
      .pipe(z.array(budgetSchema).max(100)),
    REQUIRED_TAGS: z.string().default('team,env').transform(csv),
    ALERT_SLACK_WEBHOOK_URL: z.url().optional(),
    ALERT_WEBHOOK_URL: z.url().optional(),
    ALERT_WEBHOOK_SECRET: z.string().min(16).optional(),
    ALERT_MIN_SEVERITY: z.string().default('medium').refine(isSeverity, 'severidade inválida'),
    ALERT_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(500).default(50),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['API_KEY'], message: 'obrigatória em produção' });
    }
    if (env.SOURCES.includes('aws') && !env.AWS_PAYER_ACCOUNT_ID) {
      ctx.addIssue({ code: 'custom', path: ['AWS_PAYER_ACCOUNT_ID'], message: 'obrigatório com SOURCES=aws' });
    }
    if (env.SOURCES.includes('azure') && !env.AZURE_SCOPE) {
      ctx.addIssue({ code: 'custom', path: ['AZURE_SCOPE'], message: 'obrigatório com SOURCES=azure' });
    }
  });

export type AppConfig = z.infer<typeof envSchema> & { BUDGETS: Budget[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('; ');
    throw new Error(`configuração inválida: ${details}`);
  }
  return parsed.data as AppConfig;
}
