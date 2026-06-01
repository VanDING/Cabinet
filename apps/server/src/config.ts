import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DAILY_BUDGET, WEEKLY_BUDGET, MONTHLY_BUDGET } from '@cabinet/types';

function loadEnvFile(): void {
  const paths = [join(homedir(), '.cabinet', '.env'), join(process.cwd(), '.env')];
  for (const envPath of paths) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch {
      // skip unreadable env file
    }
  }
}

loadEnvFile();

const CABINET_DIR = join(homedir(), '.cabinet');
const MASTER_KEY_FILE = join(CABINET_DIR, '.master_key');

function resolveMasterPassword(): string {
  const envPw = process.env.CABINET_MASTER_PASSWORD;
  if (envPw) return envPw;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CABINET_MASTER_PASSWORD is required in production');
  }

  // Development: use persisted random key, or generate one on first run
  if (existsSync(MASTER_KEY_FILE)) {
    try {
      return readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
    } catch {
      // unreadable — fall through to regenerate
    }
  }

  const generated = randomBytes(32).toString('hex');
  try {
    writeFileSync(MASTER_KEY_FILE, generated, { mode: 0o600, encoding: 'utf-8' });
  } catch {
    // can't persist — use in-memory only this session
  }
  return generated;
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  QWEN_API_KEY: z.string().optional(),
  MOONSHOT_API_KEY: z.string().optional(),
  ZHIPU_API_KEY: z.string().optional(),
  BAICHUAN_API_KEY: z.string().optional(),
  CABINET_DAILY_BUDGET: z.coerce.number().default(DAILY_BUDGET),
  CABINET_WEEKLY_BUDGET: z.coerce.number().default(WEEKLY_BUDGET),
  CABINET_MONTHLY_BUDGET: z.coerce.number().default(MONTHLY_BUDGET),
});

const result = envSchema.safeParse(process.env);
const parsedEnv = result.success ? result.data : ({} as z.infer<typeof envSchema>);

export function validateEnv(): { success: boolean; issues?: string[] } {
  if (!result.success) {
    return {
      success: false,
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  return { success: true };
}

export const config = {
  port: parsedEnv.PORT,
  masterPassword: resolveMasterPassword(),
  anthropicApiKey: parsedEnv.ANTHROPIC_API_KEY,
  openaiApiKey: parsedEnv.OPENAI_API_KEY,
  deepseekApiKey: parsedEnv.DEEPSEEK_API_KEY,
  qwenApiKey: parsedEnv.QWEN_API_KEY,
  moonshotApiKey: parsedEnv.MOONSHOT_API_KEY,
  zhipuApiKey: parsedEnv.ZHIPU_API_KEY,
  baichuanApiKey: parsedEnv.BAICHUAN_API_KEY,
  dailyBudget: parsedEnv.CABINET_DAILY_BUDGET,
  weeklyBudget: parsedEnv.CABINET_WEEKLY_BUDGET,
  monthlyBudget: parsedEnv.CABINET_MONTHLY_BUDGET,
};
