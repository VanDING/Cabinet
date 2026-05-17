import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DAILY_BUDGET_USD, WEEKLY_BUDGET_USD, MONTHLY_BUDGET_USD } from '@cabinet/types';

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

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  masterPassword: (() => {
    const pw = process.env.CABINET_MASTER_PASSWORD;
    if (!pw) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('CABINET_MASTER_PASSWORD is required in production');
      }
      return 'dev-master-password';
    }
    return pw;
  })(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  qwenApiKey: process.env.QWEN_API_KEY,
  moonshotApiKey: process.env.MOONSHOT_API_KEY,
  zhipuApiKey: process.env.ZHIPU_API_KEY,
  baichuanApiKey: process.env.BAICHUAN_API_KEY,
  dailyBudget: parseFloat(process.env.CABINET_DAILY_BUDGET ?? String(DAILY_BUDGET_USD)),
  weeklyBudget: parseFloat(process.env.CABINET_WEEKLY_BUDGET ?? String(WEEKLY_BUDGET_USD)),
  monthlyBudget: parseFloat(process.env.CABINET_MONTHLY_BUDGET ?? String(MONTHLY_BUDGET_USD)),
};
