import { spawnCrossPlatform } from '../utils/spawn.js';
import type { AgentRoleRegistry } from '../agent-roles.js';
import type { AgentRoleRepository } from '@cabinet/storage';
import type { ScannerRecipe, ScanResult, ExtractedConfig } from '@cabinet/types';
import { RECIPES } from './scanner-recipe.js';
import { extractConfig } from './config-extractor.js';
import { buildCliExternalConfig, buildA2AExternalConfig } from '../daemon/build-external-config.js';

export interface DiscoveryResult {
  agentId: string;
  name: string;
  protocol: 'cli' | 'a2a';
  command?: string;
  baseUrl?: string;
  detected: boolean;
  error?: string;
}

export class Scanner {
  private lastResults: DiscoveryResult[] = [];

  constructor(
    private registry: AgentRoleRegistry,
    private agentRoleRepo?: AgentRoleRepository,
  ) {}

  getLastResults(): DiscoveryResult[] {
    return this.lastResults;
  }

  async discover(): Promise<DiscoveryResult[]> {
    const results = await this.scanAll();
    this.lastResults = results.map((r) => ({
      agentId: `external_cli:${r.recipe.command}`,
      name: r.recipe.name,
      protocol: 'cli' as const,
      command: r.recipe.command,
      detected: r.installed,
      error: r.error ?? (r.installed ? undefined : 'Not found on PATH'),
    }));
    return this.lastResults;
  }

  async scanAll(): Promise<ScanResult[]> {
    const settled = await Promise.allSettled(RECIPES.map((r) => this.scanOne(r)));
    const results = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return { recipe: RECIPES[i]!, installed: false, error: `Scan error: ${s.reason}` };
    });
    this.lastResults = results.map((r) => ({
      agentId: `external_cli:${r.recipe.command}`,
      name: r.recipe.name,
      protocol: 'cli' as const,
      command: r.recipe.command,
      detected: r.installed,
      error: r.error ?? (r.installed ? undefined : 'Not found on PATH'),
    }));
    return results;
  }

  async scanOne(recipe: ScannerRecipe): Promise<ScanResult> {
    const detected = await this.detect(recipe.command, recipe.detectArgs);
    if (!detected) return { recipe, installed: false, error: 'Not found on PATH' };
    const version = await this.version(recipe);
    const extracted = await this.extractConfig(recipe);
    await this.upsertAgent(recipe, version, extracted);
    return { recipe, installed: true, version, extracted };
  }

  private detect(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawnCrossPlatform(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private async version(recipe: ScannerRecipe): Promise<string | undefined> {
    try {
      const proc = spawnCrossPlatform(recipe.command, recipe.detectArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });
      let stdout = '';
      proc.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${code}`))));
        proc.on('error', reject);
      });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async extractConfig(recipe: ScannerRecipe): Promise<ExtractedConfig | undefined> {
    try {
      return await extractConfig(recipe);
    } catch {
      return undefined;
    }
  }

  private async upsertAgent(
    recipe: ScannerRecipe,
    _version: string | undefined,
    _extracted: ExtractedConfig | undefined,
  ): Promise<void> {
    const agentId = `external_cli:${recipe.command}`;
    const external = buildCliExternalConfig(recipe.command, {
      dispatchProtocol: recipe.dispatch.protocol,
      nativeConfigPaths: recipe.nativeConfigPaths,
      sdkPackage: recipe.dispatch.sdkPackage,
    });

    this.registry.registerExternalAgent({
      protocol: 'cli',
      name: agentId,
      description: `${recipe.name} CLI agent (auto-discovered)`,
      identity: `You are ${recipe.name}, running as a CLI agent dispatched by Cabinet.`,
      command: recipe.command,
      args: recipe.dispatch.headlessArgs ?? ['--print'],
      dispatchProtocol: recipe.dispatch.protocol,
      nativeConfigPaths: recipe.nativeConfigPaths,
      sdkPackage: recipe.dispatch.sdkPackage,
    });

    if (this.agentRoleRepo) {
      this.agentRoleRepo.upsert({
        type: 'external_cli',
        name: agentId,
        description: `${recipe.name} CLI agent (auto-discovered)`,
        system_prompt: `You are ${recipe.name}, running as a CLI agent dispatched by Cabinet.`,
        model: 'default',
        model_tier: 'default',
        temperature: 0.7,
        max_response_tokens: 4096,
        allowed_tools: '[]',
        context_budget: 0.3,
        is_builtin: 0,
        created_at: new Date().toISOString(),
        external_config: JSON.stringify(external),
      });
    }
  }
}
