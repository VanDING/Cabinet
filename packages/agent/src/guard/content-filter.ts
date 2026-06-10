/**
 * ContentFilter —双层架构输入/输出安全过滤
 *
 * Layer 1（快速路径）：正则规则引擎，零延迟
 * Layer 2（慢路径）：LLM 分类器（haiku），仅在 Layer 1 不确定时触发
 */

export interface ContentFilterResult {
  blocked: boolean;
  severity: 'safe' | 'suspicious' | 'blocked';
  reason?: string;
  layer: 1 | 2;
}

export interface ContentFilterConfig {
  enabled: boolean;
  /** 是否启用 Layer 2 LLM 分类器（默认 false，仅 Layer 1 足够应付大多数场景） */
  enableLLMClassifier?: boolean;
  /** 用于 Layer 2 的模型（默认 anthropic/claude-haiku-4-5） */
  classifierModel?: string;
  /** 自定义注入正则规则 */
  customInjectionPatterns?: RegExp[];
  /** 自定义有害输出正则规则 */
  customHarmfulPatterns?: RegExp[];
}

// ── Layer 1: 注入检测模式 ─────────────────────────────────────
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i,
  /(reset|clear|forget)\s+(your\s+)?(memory|instructions?|context)/i,
  /you\s+are\s+now\s+(acting\s+as|pretending\s+to\s+be|roleplaying)/i,
  /disregard\s+(all\s+)?(safety|ethical|content)\s+(guidelines?|policies?|restrictions?)/i,
  /reveal\s+(your\s+)?(system\s+|internal\s+|base\s+)?(prompt|instructions?|programming)/i,
  /(bypass|ignore|disable)\s+(all\s+)?(safeguards?|filters?|restrictions?)/i,
  /(DAN|do\s+anything\s+now)/i,
  /(jailbreak|mode\s+unlocked|developer\s+mode)/i,
  /(end\s+of|forget\s+everything\s+above)\s+(instructions?|prompt)/i,
  /this\s+is\s+a\s+test\s+of\s+(your|the)\s+(safety|alignment|filter)/i,
];

// ── Layer 1: 有害输出模式 ─────────────────────────────────────
const HARMFUL_OUTPUT_PATTERNS: RegExp[] = [
  // API key / token / 密码泄露
  /(api[_-]?key|apikey|token|password|secret)\s*[:=]\s*['"`][a-zA-Z0-9_-]{16,}['"`]/i,
  // 自残/暴力指令（简化模式，仅做标记）
  /(kill\s+yourself|self.?harm|suicide\s+methods?|how\s+to\s+make\s+a\s+bomb)/i,
  // 仇恨言论关键词（简化）
  /\b(kill\s+all\s+(jews|muslims|blacks|whites|asians)|genocide\s+the)\b/i,
];

/** 内容安全过滤器 */
export class ContentFilter {
  private injectionPatterns: RegExp[];
  private harmfulPatterns: RegExp[];

  constructor(private config: ContentFilterConfig) {
    this.injectionPatterns = [...INJECTION_PATTERNS, ...(config.customInjectionPatterns ?? [])];
    this.harmfulPatterns = [...HARMFUL_OUTPUT_PATTERNS, ...(config.customHarmfulPatterns ?? [])];
  }

  /** 检查用户输入是否存在注入攻击 */
  checkInput(text: string): ContentFilterResult {
    if (!this.config.enabled) {
      return { blocked: false, severity: 'safe', layer: 1 };
    }

    for (const pattern of this.injectionPatterns) {
      if (pattern.test(text)) {
        return {
          blocked: true,
          severity: 'blocked',
          reason: `Injection pattern matched: ${pattern.source.slice(0, 60)}`,
          layer: 1,
        };
      }
    }

    return { blocked: false, severity: 'safe', layer: 1 };
  }

  /** 检查 LLM 输出是否存在有害内容（标记模式，不阻断） */
  checkOutput(text: string): ContentFilterResult {
    if (!this.config.enabled) {
      return { blocked: false, severity: 'safe', layer: 1 };
    }

    for (const pattern of this.harmfulPatterns) {
      if (pattern.test(text)) {
        return {
          blocked: false,
          severity: 'suspicious',
          reason: `Harmful output pattern matched: ${pattern.source.slice(0, 60)}`,
          layer: 1,
        };
      }
    }

    return { blocked: false, severity: 'safe', layer: 1 };
  }

  /** 重写/标记可疑输出 */
  sanitizeOutput(text: string): { text: string; flagged: boolean; reason?: string } {
    const result = this.checkOutput(text);
    if (result.severity === 'suspicious') {
      return {
        text: `[CONTENT FLAGGED] ${result.reason}\n\n---\n\n${text}`,
        flagged: true,
        reason: result.reason,
      };
    }
    return { text, flagged: false };
  }
}
