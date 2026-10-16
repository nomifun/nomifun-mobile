/**
 * Curated mobile platform presets.
 *
 * `preset` is the stable manifest lookup value. `platform` is the canonical
 * runtime family written to the provider row. They are deliberately separate:
 * regional/plan presets can share a runtime family while using different
 * protocol manifests and base URLs.
 */

export interface PlatformPreset {
  preset: string;
  platform: string;
  label: string;
  baseUrl: string;
  defaultAuthScheme?: string;
  requiresName?: boolean;
  /** Bedrock needs a non-URL credential form; keep it visible but specialized. */
  bedrock?: boolean;
}

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  { preset: 'OpenAI', platform: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { preset: 'Anthropic', platform: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', defaultAuthScheme: 'header_key:x-api-key' },
  { preset: 'gemini', platform: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', defaultAuthScheme: 'header_key:x-goog-api-key' },
  { preset: 'DeepSeek', platform: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { preset: 'Deepgram', platform: 'deepgram', label: 'Deepgram', baseUrl: 'https://api.deepgram.com', defaultAuthScheme: 'token' },
  { preset: 'MiMo', platform: 'mimo', label: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { preset: 'MiMo-Token-Plan-CN', platform: 'mimo-token-plan-cn', label: 'Xiaomi MiMo Token Plan (CN)', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
  { preset: 'MiMo-Token-Plan-SGP', platform: 'mimo-token-plan-sgp', label: 'Xiaomi MiMo Token Plan (SGP)', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1' },
  { preset: 'MiMo-Token-Plan-AMS', platform: 'mimo-token-plan-ams', label: 'Xiaomi MiMo Token Plan (AMS)', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1' },
  { preset: 'MiniMax', platform: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1' },
  { preset: 'MiniMax-Code', platform: 'minimax-code', label: 'MiniMax (International)', baseUrl: 'https://api.minimax.io/v1' },
  { preset: 'MiniMax-Coding-Plan', platform: 'minimax-coding-plan', label: 'MiniMax Coding Plan', baseUrl: 'https://api.minimaxi.com/v1' },
  { preset: 'Novita', platform: 'novita', label: 'Novita', baseUrl: 'https://api.novita.ai/openai/v1' },
  { preset: 'OpenRouter', platform: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { preset: 'Dashscope', platform: 'dashscope', label: 'Dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { preset: 'Dashscope-Coding', platform: 'dashscope-coding', label: 'Dashscope Coding Plan', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1' },
  { preset: 'SiliconFlow-CN', platform: 'siliconflow', label: 'SiliconFlow (CN)', baseUrl: 'https://api.siliconflow.cn/v1' },
  { preset: 'SiliconFlow', platform: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.com/v1' },
  { preset: 'Zhipu', platform: 'zhipu', label: 'Zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { preset: 'GLM-Coding-Plan', platform: 'glm-coding-plan', label: 'GLM Coding Plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' },
  { preset: 'Moonshot', platform: 'moonshot-cn', label: 'Moonshot (China)', baseUrl: 'https://api.moonshot.cn/v1' },
  { preset: 'Moonshot-Global', platform: 'moonshot-global', label: 'Moonshot (Global)', baseUrl: 'https://api.moonshot.ai/v1' },
  { preset: 'xAI', platform: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { preset: 'Ark', platform: 'ark', label: 'Doubao / Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { preset: 'Ark-Coding-Plan', platform: 'ark-coding-plan', label: 'Doubao / Ark Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3' },
  { preset: 'Ark-Agent-Plan', platform: 'ark-agent-plan', label: 'Doubao / Ark Agent Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3' },
  { preset: 'Qianfan', platform: 'qianfan', label: 'Qianfan', baseUrl: 'https://qianfan.baidubce.com/v2' },
  { preset: 'Qianfan-Coding-Plan', platform: 'qianfan-coding-plan', label: 'Qianfan Coding Plan', baseUrl: 'https://qianfan.baidubce.com/v2/coding' },
  { preset: 'Hunyuan', platform: 'hunyuan', label: 'Tencent TokenHub (China)', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
  { preset: 'Hunyuan-Global', platform: 'hunyuan-global', label: 'Tencent TokenHub (Global)', baseUrl: 'https://tokenhub-intl.tencentmaas.com/v1' },
  { preset: 'Lingyi', platform: 'lingyi', label: 'Lingyi', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  { preset: 'Poe', platform: 'poe', label: 'Poe', baseUrl: 'https://api.poe.com/v1' },
  { preset: 'PPIO', platform: 'ppio', label: 'PPIO', baseUrl: 'https://api.ppio.com/openai/v1' },
  { preset: 'ModelScope', platform: 'modelscope', label: 'ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1' },
  { preset: 'InfiniAI', platform: 'infiniai', label: 'InfiniAI', baseUrl: 'https://cloud.infini-ai.com/maas/v1' },
  { preset: 'Ctyun', platform: 'ctyun', label: 'Ctyun', baseUrl: 'https://ai.ctaigw.cn/v1' },
  { preset: 'StepFun', platform: 'stepfun', label: 'StepFun', baseUrl: 'https://api.stepfun.com/v1' },
  { preset: 'StepFun-Plan', platform: 'stepfun-plan', label: 'StepFun Step Plan', baseUrl: 'https://api.stepfun.com/step_plan/v1' },
  { preset: 'custom', platform: 'custom', label: 'Custom', baseUrl: '', defaultAuthScheme: 'bearer', requiresName: true },
  { preset: 'new-api', platform: 'new-api', label: 'New API', baseUrl: '', defaultAuthScheme: 'bearer', requiresName: true },
  { preset: 'AWS-Bedrock', platform: 'bedrock', label: 'AWS Bedrock', baseUrl: '', defaultAuthScheme: 'bedrock', requiresName: true, bedrock: true },
];

export const MANAGED_FREE_PLATFORM = 'nomifun-free-model';

export function isManagedProvider(platform: string): boolean {
  return platform === MANAGED_FREE_PLATFORM;
}

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
  return NO_MODELS_ENDPOINT.has(platform);
}

export function platformSkipsPreSaveKeyProbe(platform: string): boolean {
  return platformHasNoModelsEndpoint(platform) || platform === 'stepfun';
}

/**
 * Resolve the manifest preset for a stored provider row.
 *
 * The API stores the runtime family in `platform`, while the protocol registry
 * also has distinct presets for regional endpoints (for example the two
 * SiliconFlow regions). A detail/editor screen must therefore use the base
 * URL to disambiguate the preset whenever possible.
 */
export function manifestPresetForProvider({
  platform,
  base_url,
}: {
  platform: string;
  base_url?: string;
}): string {
  const normalizedPlatform = platform.trim();
  const normalizedBaseUrl = normalizePresetBaseUrl(base_url);

  if (normalizedBaseUrl) {
    const exact = PLATFORM_PRESETS.find(
      (preset) =>
        preset.platform === normalizedPlatform &&
        normalizePresetBaseUrl(preset.baseUrl) === normalizedBaseUrl,
    );
    if (exact) return exact.preset;
  }

  return (
    PLATFORM_PRESETS.find((preset) => preset.platform === normalizedPlatform)?.preset ??
    normalizedPlatform
  );
}

function normalizePresetBaseUrl(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) || !parsed.host) {
      return undefined;
    }
    parsed.search = '';
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = path || '/';
    return parsed.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/+$/, '').toLowerCase() || undefined;
  }
}

export function splitApiKeys(apiKey: string): string[] {
  return apiKey
    .split(/[,\n]/)
    .map((key) => key.trim())
    .filter(Boolean);
}

export function apiKeyCount(apiKey: string): number {
  return splitApiKeys(apiKey).length;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
