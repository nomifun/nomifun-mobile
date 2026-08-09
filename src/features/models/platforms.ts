/**
 * Platform presets + credential helpers for 模型管理.
 *
 * A curated subset of the desktop's `MODEL_PLATFORMS` (~45 entries): the
 * presets a phone user plausibly types a key into, with the same
 * `platform` / `base_url` pairs so a provider created here is
 * indistinguishable from one created on the desktop. Wizard-only platforms
 * (Bedrock, Gemini Vertex AI) are deliberately absent — they need extra
 * credential shapes and are handled on the desktop.
 */

export interface PlatformPreset {
  /** The `platform` value written to the wire. */
  platform: string;
  /** Display label (not translated — these are vendor names). */
  label: string;
  /** Preset endpoint; empty means the user must type one. */
  baseUrl: string;
  /** Force the user to name it (aggregator gateways host many vendors). */
  requiresName?: boolean;
}

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  { platform: 'custom', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { platform: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
  {
    platform: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
  { platform: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  {
    platform: 'dashscope',
    label: 'Dashscope 百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  { platform: 'zhipu', label: 'Zhipu 智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  {
    platform: 'glm-coding-plan',
    label: 'GLM Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
  { platform: 'moonshot-cn', label: 'Moonshot 月之暗面', baseUrl: 'https://api.moonshot.cn/v1' },
  { platform: 'moonshot-global', label: 'Moonshot (Global)', baseUrl: 'https://api.moonshot.ai/v1' },
  {
    platform: 'ark',
    label: 'Doubao / Ark 豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    platform: 'ark-coding-plan',
    label: 'Doubao / Ark Coding Plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  },
  { platform: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1' },
  { platform: 'siliconflow', label: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  { platform: 'qianfan', label: 'Qianfan 千帆', baseUrl: 'https://qianfan.baidubce.com/v2' },
  { platform: 'mimo', label: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { platform: 'stepfun', label: 'StepFun 阶跃星辰', baseUrl: 'https://api.stepfun.com/v1' },
  { platform: 'hunyuan', label: 'Hunyuan 混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { platform: 'custom', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { platform: 'custom', label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { platform: 'custom', label: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1' },
  { platform: 'new-api', label: 'New API', baseUrl: '', requiresName: true },
  { platform: 'custom', label: 'Custom', baseUrl: '', requiresName: true },
];

/** The auto-created provider for the NomiFun-managed free models. */
export const MANAGED_FREE_PLATFORM = 'nomifun-free-model';

export function isManagedProvider(platform: string): boolean {
  return platform === MANAGED_FREE_PLATFORM;
}

/**
 * Subscription-plan gateways whose base URL exposes no `/models` catalog.
 * `detect-protocol` is an OpenAI-style `/models` probe, so it 404s there and
 * would wrongly reject a valid key — the per-model heartbeat is the only
 * correct validation for these. Mirrors `platformSkipsPreSaveKeyProbe()`.
 */
const NO_MODELS_ENDPOINT = new Set([
  'ark-coding-plan',
  'ark-agent-plan',
  'minimax-coding-plan',
  'stepfun-plan',
  'dashscope-coding',
  'glm-coding-plan',
  'qianfan-coding-plan',
]);

export function platformHasNoModelsEndpoint(platform: string): boolean {
  return NO_MODELS_ENDPOINT.has(platform) || platform === 'stepfun';
}

/** Multi-key strings are comma/newline separated. */
export function splitApiKeys(apiKey: string): string[] {
  return apiKey
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function apiKeyCount(apiKey: string): number {
  return splitApiKeys(apiKey).length;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
