import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, type LanguageModel } from 'ai'
import { llmKeyPresent, loadConfig, type ReasoningEffort } from './config'
import { hub } from './hub'

let model: LanguageModel | null = null

type ProviderOptions = Parameters<typeof generateText>[0]['providerOptions']

export function getModel(): LanguageModel {
  if (model) return model
  const cfg = loadConfig()
  if (!llmKeyPresent(cfg)) {
    throw new Error(
      cfg.llmProvider === 'openai'
        ? 'OPENAI_API_KEY is not set in .env'
        : 'ANTHROPIC_API_KEY is not set in .env'
    )
  }
  model =
    cfg.llmProvider === 'anthropic'
      ? createAnthropic({ apiKey: cfg.anthropicKey })(cfg.llmModel)
      : createOpenAI({ apiKey: cfg.openaiKey })(cfg.llmModel)
  return model
}

/** Reasoning effort applies to OpenAI reasoning models; other providers ignore it. */
export function providerOptions(effort?: ReasoningEffort): ProviderOptions {
  const cfg = loadConfig()
  const reasoningEffort = effort ?? hub.settings.reasoningEffort ?? cfg.reasoningEffort
  if (cfg.llmProvider !== 'openai' || !reasoningEffort) return undefined
  return { openai: { reasoningEffort } }
}

/**
 * How long a background call may take, retries included. A call that hangs would otherwise keep
 * the observer busy, and every reminder waiting behind it.
 */
export const BACKGROUND_TIMEOUT_MS = 15_000

/**
 * One-shot completion for background jobs (compaction, nudge phrasing), kept cheap and fast.
 * Rejects after `timeoutMs`; callers fall back to a template line or try again later.
 */
export async function complete(
  system: string,
  prompt: string,
  timeoutMs = BACKGROUND_TIMEOUT_MS
): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    system,
    prompt,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(timeoutMs),
    providerOptions: providerOptions('low')
  })
  return text.trim()
}
