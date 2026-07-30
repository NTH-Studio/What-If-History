import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

try {
  loadEnvFile(path.join(projectRoot, '.env'));
} catch {
  // Local .env is optional; production may inject environment variables directly.
}

const configSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_PATH: z.string().default('data/runtime/what-if-history.sqlite'),
  APP_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(180_000).default(120_000),
  GLOBAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  LLM_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = configSchema.parse(process.env);

export const config = {
  host: parsed.HOST,
  port: parsed.PORT,
  databasePath: path.resolve(projectRoot, parsed.DATABASE_PATH),
  dataDirectory: path.join(projectRoot, 'data'),
  webDirectory: path.join(projectRoot, 'apps/web/dist'),
  appOrigins: parsed.APP_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logLevel: parsed.LOG_LEVEL,
  llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
  globalRateLimitPerMinute: parsed.GLOBAL_RATE_LIMIT_PER_MINUTE,
  llmRateLimitPerMinute: parsed.LLM_RATE_LIMIT_PER_MINUTE,
  environment: parsed.NODE_ENV,
};
