/**
 * Single source of truth for built-in model definitions.
 *
 * Add new models HERE — all UI components and server logic
 * consume from this file. No more duplicate hardcoded arrays.
 */

export interface ModelEntry {
  id: string
  label: string
  provider: string      // Display name: 'Anthropic', 'Moonshot', etc.
  providerId: string    // DB provider ID: 'anthropic', 'moonshot', etc.
  aliases?: string[]    // For IM /model fuzzy matching
}

/**
 * Built-in models. These are always available regardless of DB state.
 * Custom provider models are loaded dynamically from the database.
 */
export const BUILTIN_MODELS: ModelEntry[] = [
  // Anthropic (native)
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', providerId: 'anthropic', aliases: ['sonnet', 'claude-sonnet'] },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic', providerId: 'anthropic', aliases: ['opus', 'claude-opus'] },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', providerId: 'anthropic', aliases: ['haiku', 'claude-haiku'] },
  // Moonshot/Kimi (Anthropic-compatible)
  { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'Moonshot', providerId: 'moonshot', aliases: ['kimi'] },
  { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', provider: 'Moonshot', providerId: 'moonshot', aliases: ['kimi-thinking'] },
  // Zhipu/GLM (Anthropic-compatible)
  { id: 'glm-5', label: 'GLM-5', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm', 'glm5'] },
  { id: 'glm-5-turbo', label: 'GLM-5 Turbo', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm5-turbo'] },
  { id: 'glm-4-plus', label: 'GLM-4 Plus', provider: 'Zhipu', providerId: 'zhipu', aliases: ['glm4'] },
  // MiniMax (Anthropic-compatible)
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'MiniMax', providerId: 'minimax', aliases: ['minimax', 'm2.7'] },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed', provider: 'MiniMax', providerId: 'minimax', aliases: ['minimax-fast'] },
  { id: 'MiniMax-M2.5', label: 'MiniMax M2.5', provider: 'MiniMax', providerId: 'minimax', aliases: ['m2.5'] },
  // Qwen/DashScope (Anthropic-compatible)
  { id: 'qwen3.5-plus', label: 'Qwen 3.5 Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen', 'qwen3.5'] },
  { id: 'qwen3.5-flash', label: 'Qwen 3.5 Flash', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-flash'] },
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-coder'] },
  { id: 'qwen-max', label: 'Qwen Max', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-max'] },
  { id: 'qwen-plus', label: 'Qwen Plus', provider: 'Qwen', providerId: 'qwen', aliases: ['qwen-plus'] },
]

/**
 * Build MODEL_TO_PROVIDER mapping from BUILTIN_MODELS.
 * Used by resolveProvider() for fast model → provider lookup.
 */
export const MODEL_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  BUILTIN_MODELS.map(m => [m.id, m.providerId])
)
