import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'
import { config as loadDotenv } from 'dotenv'
import type { ReasoningEffort } from '../shared/types'

export type { ReasoningEffort }

export type LlmProviderName = 'openai' | 'anthropic'

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-4-5'
}

const REASONING_LEVELS: readonly ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

export interface HearthConfig {
  smartspectraKey: string
  assemblyKey: string
  llmProvider: LlmProviderName
  llmModel: string
  reasoningEffort: ReasoningEffort | null
  openaiKey: string
  anthropicKey: string
  /**
   * A Composio Platform project key (ak_...). Composio handles Google sign-in and runs the Gmail,
   * Calendar and Drive tools. The For You consumer key (ck_...) does not work with the SDK.
   */
  composioKey: string
  ttsVoice: string
  projectRoot: string
  dataDir: string
  mcpConfigPath: string | null
}

/**
 * Where .env may be, nearest first. A development run looks in the project and the folder around
 * it. An installed build reads only its user data folder: the folder it was started from, or one
 * next to the app, is not a safe place to take keys or MCP servers from.
 */
function candidateRoots(): string[] {
  if (app.isPackaged) return [app.getPath('userData')]
  const appPath = app.getAppPath()
  return [appPath, resolve(appPath, '..'), process.cwd(), resolve(process.cwd(), '..')]
}

let cached: HearthConfig | null = null

export function loadConfig(): HearthConfig {
  if (cached) return cached

  const roots = candidateRoots()
  for (const root of roots) {
    const envPath = join(root, '.env')
    if (existsSync(envPath)) loadDotenv({ path: envPath, quiet: true })
  }

  const env = process.env
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase()
  const llmProvider: LlmProviderName = provider === 'anthropic' ? 'anthropic' : 'openai'
  // The folder with .env, else the one with .env.example (where .env belongs), else the first
  // candidate: the app in development, the user data folder in an installed build.
  const projectRoot =
    roots.find((r) => existsSync(join(r, '.env'))) ??
    roots.find((r) => existsSync(join(r, '.env.example'))) ??
    roots[0]
  // HEARTH_MCP_CONFIG is the user's own choice of path, so an installed build honours it too.
  const mcpConfigPath =
    [
      env.HEARTH_MCP_CONFIG,
      join(projectRoot, 'mcp.json'),
      app.isPackaged ? null : join(app.getAppPath(), 'mcp.json')
    ]
      .filter((p): p is string => Boolean(p))
      .find((p) => existsSync(p)) ?? null

  cached = {
    smartspectraKey: env.SMARTSPECTRA_API_KEY ?? env.PRESAGE_API_KEY ?? '',
    assemblyKey: env.ASSEMBLYAI_API_KEY ?? '',
    llmProvider,
    llmModel:
      env.HEARTH_LLM_MODEL ||
      (llmProvider === 'openai' ? env.OPENAI_MODEL : env.ANTHROPIC_MODEL) ||
      DEFAULT_MODELS[llmProvider],
    reasoningEffort: parseEffort(env.OPENAI_MODEL_REASONING ?? env.LLM_REASONING),
    openaiKey: env.OPENAI_API_KEY ?? '',
    anthropicKey: env.ANTHROPIC_API_KEY ?? '',
    composioKey: env.COMPOSIO_API_KEY || env.COMPOSIO_PLATFORM_KEY || '',
    ttsVoice: env.HEARTH_TTS_VOICE || 'aai-kyla',
    projectRoot,
    dataDir: join(
      app.getPath('userData'),
      env.HEARTH_DEMO === '1' ? 'hearth-demo-data' : 'hearth-data'
    ),
    mcpConfigPath
  }
  return cached
}

function parseEffort(raw: string | undefined): ReasoningEffort | null {
  const value = raw?.trim().toLowerCase()
  return REASONING_LEVELS.find((level) => level === value) ?? null
}

export function llmKeyPresent(cfg: HearthConfig): boolean {
  return cfg.llmProvider === 'openai' ? Boolean(cfg.openaiKey) : Boolean(cfg.anthropicKey)
}
