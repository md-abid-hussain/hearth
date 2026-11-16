import { isStepCount, streamText, tool, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'
import { hub } from './hub'
import { insights } from './insights'
import { getModel, providerOptions } from './llm'
import { mcp } from './mcp'
import { memory } from './memory'
import { reminders } from './reminders'
import { vitals } from './vitals'

const MAX_STEPS = 6

const PERSONA = `You are Wisp, a calm companion on the user's desk. Every reply is spoken aloud.

Style: one to three short spoken sentences. No markdown, lists, emoji or links. Warm, light, never preachy; drop advice the user brushed off.

Tools:
- get_vitals: live camera wellness signals (pulse, breathing, HRV, blinks, talking, time since a break).
- ask_presage_insight: Presage's own read on their physiology, for "how am I doing" questions.
- set_reminder when asked to be reminded; remember when they share a lasting fact or preference.
- Tools named "app__tool" read the apps listed under Linked apps. They are read-only; if asked to send, edit or delete, say you can't and offer what you can read.

Rules:
- Signals are wellness estimates, not medical readings. Never diagnose or suggest treatment; point medical worries to a professional.
- Describe signals in plain words; say numbers only when asked.
- If sensing is off or a value is missing, say you can't see it right now.
- Answer directly; only call a tool when the answer needs it.`

function contextBlock(): string {
  const pins = hub.memory.pins.map((p, i) => `${i + 1}. ${p}`).join('\n') || '(none)'
  const due = hub.reminders
    .map(
      (r) =>
        `- "${r.text}" in ${Math.max(0, Math.round((r.dueAt - Date.now()) / 60_000))} min (id ${r.id})`
    )
    .join('\n')
  const recentInsight = insights.recent(1)[0]
  const linked = hub.mcp.filter((s) => s.connected).map((s) => s.name)
  return [
    `Now: ${new Date().toLocaleString()}`,
    `Linked apps: ${linked.join(', ') || 'none'}`,
    `Signals: ${JSON.stringify(vitals.describe())}`,
    recentInsight
      ? `Latest Presage insight (${Math.round((Date.now() - recentInsight.at) / 60_000)} min ago): ${recentInsight.text}`
      : 'Latest Presage insight: none yet',
    `Memory summary:\n${hub.memory.summary || '(empty)'}`,
    `Pinned facts:\n${pins}`,
    `Pending reminders:\n${due || '(none)'}`
  ].join('\n\n')
}

function builtinTools(): ToolSet {
  return {
    get_vitals: tool({
      description: 'Current wellness signals, 5-minute averages and session baselines.',
      inputSchema: z.object({}),
      execute: async () => vitals.describe()
    }),
    ask_presage_insight: tool({
      description:
        "Ask Presage's vitals LLM a question about the user's current physiology. Takes up to 30 seconds.",
      inputSchema: z.object({
        question: z.string().describe('A short question about the measured vitals')
      }),
      execute: async ({ question }) => {
        const answer = await insights.request(question)
        return answer
          ? { answer: answer.text }
          : { answer: null, note: 'No insight available (sensing off or timed out).' }
      }
    }),
    recent_insights: tool({
      description: 'The latest automatic Presage vitals insights, newest last.',
      inputSchema: z.object({ count: z.number().int().min(1).max(5).default(3) }),
      execute: async ({ count }) =>
        insights
          .recent(count)
          .map((i) => ({ minutesAgo: Math.round((Date.now() - i.at) / 60_000), text: i.text }))
    }),
    set_reminder: tool({
      description: 'Schedule a spoken reminder for the user.',
      inputSchema: z.object({
        text: z.string().describe('What to remind the user about, phrased as a short task'),
        inMinutes: z
          .number()
          .min(1)
          .max(24 * 60)
      }),
      execute: async ({ text, inMinutes }) => {
        const r = reminders.add(text, inMinutes)
        return { id: r.id, dueAt: new Date(r.dueAt).toLocaleTimeString() }
      }
    }),
    cancel_reminder: tool({
      description: 'Cancel a pending reminder by id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => ({ cancelled: reminders.cancel(id) })
    }),
    remember: tool({
      description: 'Pin a durable fact or preference about the user to long-term memory.',
      inputSchema: z.object({ fact: z.string() }),
      execute: async ({ fact }) => ({ pins: memory.pin(fact).length })
    }),
    quiet_mode: tool({
      description: 'Turn quiet mode on or off. In quiet mode Wisp never speaks unprompted.',
      inputSchema: z.object({ on: z.boolean() }),
      execute: async ({ on }) => ({ quietMode: hub.updateSettings({ quietMode: on }).quietMode })
    })
  }
}

const ACTIVITY: Record<string, string> = {
  get_vitals: 'checking your signals',
  ask_presage_insight: 'asking Presage',
  recent_insights: 'reading recent insights',
  set_reminder: 'setting a reminder',
  cancel_reminder: 'cancelling a reminder',
  remember: 'remembering that',
  quiet_mode: 'changing quiet mode'
}

function activityFor(toolName: string): string {
  if (ACTIVITY[toolName]) return ACTIVITY[toolName]
  const server = toolName.split('__')[0]
  return `reading ${server}`
}

const LOST_THOUGHT = 'Sorry, I lost my thought there. Could you say that again?'

export interface Reply {
  text: string
  tools: string[]
  /** Milliseconds until the first reply text arrived. */
  firstTextMs: number | null
  reasoningTokens: number | null
}

/**
 * Runs one user turn through the tool loop, streaming reply text to `onText` as the
 * model writes it so speech can start before the reply is complete.
 */
export async function respond(userText: string, onText: (delta: string) => void): Promise<Reply> {
  const history: ModelMessage[] = memory
    .recentTurns()
    .map((t) => ({ role: t.role, content: t.text }))
  memory.add('user', userText)
  const tools: string[] = []
  const started = Date.now()
  let firstTextMs: number | null = null
  let text = ''

  const result = streamText({
    model: getModel(),
    system: `${PERSONA}\n\n--- Context ---\n${contextBlock()}`,
    messages: [...history, { role: 'user', content: userText }],
    tools: { ...builtinTools(), ...mcp.toolset() },
    stopWhen: isStepCount(MAX_STEPS),
    maxRetries: 1,
    providerOptions: providerOptions(),
    onToolExecutionStart: ({ toolCall }) => {
      tools.push(toolCall.toolName)
      hub.setActivity(activityFor(toolCall.toolName))
      hub.record('tool', `Used ${toolCall.toolName}`)
    }
  })

  let newStep = false
  for await (const part of result.fullStream) {
    if (part.type === 'error')
      throw part.error instanceof Error ? part.error : new Error(String(part.error))
    if (part.type === 'finish-step') newStep = true
    if (part.type !== 'text-delta' || !part.text) continue
    // Text written either side of a tool call must stay separate words when spoken.
    const delta = newStep && /\S$/.test(text) && /^\S/.test(part.text) ? ` ${part.text}` : part.text
    newStep = false
    firstTextMs ??= Date.now() - started
    text += delta
    onText(delta)
  }

  const usage = await result.totalUsage
  const reply = text.trim()
  if (!reply) onText(LOST_THOUGHT)
  memory.add('assistant', reply || LOST_THOUGHT)
  void memory.compactIfNeeded()
  return {
    text: reply || LOST_THOUGHT,
    tools,
    firstTextMs,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? null
  }
}
