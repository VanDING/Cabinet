import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadEnvFile(): void {
  try {
    const envPath = join(process.cwd(), '.env');
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
    // .env file is optional
  }
}

loadEnvFile();

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  masterPassword: process.env.CABINET_MASTER_PASSWORD ?? 'dev-master-password',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  qwenApiKey: process.env.QWEN_API_KEY,
  moonshotApiKey: process.env.MOONSHOT_API_KEY,
  zhipuApiKey: process.env.ZHIPU_API_KEY,
  baichuanApiKey: process.env.BAICHUAN_API_KEY,
  dailyBudget: parseFloat(process.env.CABINET_DAILY_BUDGET ?? '5.00'),
  weeklyBudget: parseFloat(process.env.CABINET_WEEKLY_BUDGET ?? '25.00'),
  monthlyBudget: parseFloat(process.env.CABINET_MONTHLY_BUDGET ?? '100.00'),
};
