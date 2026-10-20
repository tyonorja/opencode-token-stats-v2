import type { TokenUsageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"

type Tokens = TokenUsageInfo

type Phase = "waiting" | "streaming" | "tool" | "done"

type Step = {
  messageID: string
  createdAt: number
  completedAt?: number
  firstAt?: number
  textChars: number
  reasonChars: number
  toolChars: number
  phase: Phase
  tokens?: Tokens
  errored?: boolean
}

type SessionData = {
  step?: Step
  parts: Record<string, { messageID: string; type: string; len: number }>
  requests: number
  genCharsPerToken: number
  reasonCharsPerToken: number
  busy: boolean
  sessionTokens?: Tokens
}

type PluginStore = {
  sessions: Record<string, SessionData>
  activeSession?: string
}

const DEFAULT_CHARS_PER_TOKEN = 4
const MIN_CHARS_PER_TOKEN = 1.5
const MAX_CHARS_PER_TOKEN = 12
const CALIBRATION_MIN_TOKENS = 20
const CALIBRATION_ALPHA = 0.5

function toolInputSize(input: unknown): number {
  if (input === undefined) return 0
  try {
    return JSON.stringify(input).length
  } catch {
    return 0
  }
}

function applyPart(session: SessionData, step: Step, type: string, len: number, messageID: string) {
  const owner = step.messageID
  if (type === "text" || type === "reasoning") {
    session.parts[messageID] = { messageID: owner, type, len }
    if (step.phase === "waiting") step.phase = "streaming"
  } else if (type === "tool") {
    session.parts[messageID] = { messageID: owner, type: "tool", len }
    step.phase = "tool"
  } else {
    return
  }

  let textChars = 0
  let reasonChars = 0
  let toolChars = 0
  for (const rec of Object.values(session.parts)) {
    if (rec.messageID !== owner) continue
    if (rec.type === "text") textChars += rec.len
    else if (rec.type === "reasoning") reasonChars += rec.len
    else if (rec.type === "tool") toolChars += rec.len
  }
  step.textChars = textChars
  step.reasonChars = reasonChars
  step.toolChars = toolChars
}

function calibrate(current: number, sample: number) {
  if (!Number.isFinite(sample) || sample <= 0) return current
  const next = current + CALIBRATION_ALPHA * (sample - current)
  return Math.min(MAX_CHARS_PER_TOKEN, Math.max(MIN_CHARS_PER_TOKEN, next))
}

function generatedChars(step: Step) {
  return step.textChars + step.reasonChars + step.toolChars
}

function generatedTokens(tokens: Tokens) {
  return tokens.output + tokens.reasoning
}

function compactNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + "B"
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1) + "M"
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + "k"
  return value.toString()
}

function formatStats(step: Step | undefined, sessionTokens: Tokens | undefined, requests: number): string | undefined {
  if (!step) return undefined
  const elapsedMs = (step.completedAt ?? Date.now()) - step.createdAt
  const elapsed = elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`

  let lines = `Turn stats (${elapsed}):`

  if (step.tokens) {
    const prompt = step.tokens.input + step.tokens.cache.read + step.tokens.cache.write
    const hitRate = prompt > 0 ? Math.round((step.tokens.cache.read / prompt) * 100) : 0
    const out = step.tokens.output + step.tokens.reasoning
    lines += `\n  prompt: ${compactNumber(prompt)} (cache read ${compactNumber(step.tokens.cache.read)}, hit ${hitRate}%)`
    lines += `\n  out: ${compactNumber(out)}`
  } else {
    const estOut = Math.round(generatedChars(step) / step.genCharsPerToken)
    lines += `\n  out: ~${compactNumber(estOut)} (estimated)`
  }

  if (sessionTokens) {
    const sessionOut = sessionTokens.output + sessionTokens.reasoning
    lines += `\n  session: ${compactNumber(sessionOut)} out · ${requests} req`
  }

  lines += `\n  step: ${elapsed}`
  return lines
}

export default Plugin.define({
  id: "token-stats",
  setup: (context: any) => {
    const { event, storage, session } = context

    let store: PluginStore = storage.get("token-stats") ?? { sessions: {}, activeSession: undefined }

    function saveStore() {
      storage.set("token-stats", store)
    }

    function ensureSession(sessionID: string): SessionData {
      let s = store.sessions[sessionID]
      if (!s) {
        s = {
          parts: {},
          requests: 0,
          genCharsPerToken: DEFAULT_CHARS_PER_TOKEN,
          reasonCharsPerToken: DEFAULT_CHARS_PER_TOKEN,
          busy: false,
        }
        store.sessions[sessionID] = s
        store.activeSession = sessionID
        saveStore()
      }
      return s
    }

    const cleanupFns: (() => void)[] = []

    // ---- assistant step lifecycle ------------------------------------------

    cleanupFns.push(
      event.subscribe("session.step.started", (ev: any) => {
        const { sessionID, assistantMessageID, started } = ev.data
        const s = ensureSession(sessionID)
        s.step = {
          messageID: assistantMessageID,
          createdAt: started,
          textChars: 0,
          reasonChars: 0,
          toolChars: 0,
          phase: "waiting",
        }
        s.parts = {}
        saveStore()
      }),
    )

    cleanupFns.push(
      event.subscribe("session.step.ended", (ev: any) => {
        const { sessionID, assistantMessageID, finish, cost, tokens } = ev.data
        const s = ensureSession(sessionID)
        const step = s.step
        if (!step || step.messageID !== assistantMessageID) return

        step.completedAt = Date.now()
        step.phase = "done"
        if (tokens) {
          step.tokens = tokens
          s.sessionTokens = tokens
          s.requests += 1
          const generated = generatedTokens(tokens)
          if (generated >= CALIBRATION_MIN_TOKENS && generatedChars(step) > 0) {
            s.genCharsPerToken = calibrate(s.genCharsPerToken, generatedChars(step) / generated)
          }
          if (tokens.reasoning >= CALIBRATION_MIN_TOKENS && step.reasonChars > 0) {
            s.reasonCharsPerToken = calibrate(s.reasonCharsPerToken, step.reasonChars / tokens.reasoning)
          }
        }
        saveStore()
        // Post stats to chat as a synthetic message
        const msg = formatStats(step, s.sessionTokens, s.requests)
        if (msg) {
          try {
            session.synthetic({ sessionID, text: { text: msg } })
          } catch {
            // best-effort; chat may not be ready
          }
        }
      }),
    )

    cleanupFns.push(
      event.subscribe("session.step.failed", (ev: any) => {
        const { sessionID, assistantMessageID, error, tokens } = ev.data
        const s = ensureSession(sessionID)
        const step = s.step
        if (!step || step.messageID !== assistantMessageID) return
        step.errored = true
        step.phase = "done"
        step.completedAt = Date.now()
        if (tokens) {
          step.tokens = tokens
          s.sessionTokens = tokens
          s.requests += 1
        }
        saveStore()
      }),
    )

    // ---- streaming deltas --------------------------------------------------

    cleanupFns.push(
      event.subscribe("session.text.delta", (ev: any) => {
        const { sessionID, assistantMessageID, delta } = ev.data
        const s = ensureSession(sessionID)
        const step = s.step
        if (!step) return
        const owner = step.messageID
        const existing = s.parts[assistantMessageID]
        const prevLen = existing ? existing.len : 0
        const newLen = prevLen + delta.length
        s.parts[assistantMessageID] = { messageID: owner, type: "text", len: newLen }
        step.firstAt ??= Date.now()
        if (step.phase === "waiting") step.phase = "streaming"

        let textChars = 0
        let reasonChars = 0
        let toolChars = 0
        for (const rec of Object.values(s.parts)) {
          if (rec.messageID !== owner) continue
          if (rec.type === "text") textChars += rec.len
          else if (rec.type === "reasoning") reasonChars += rec.len
          else if (rec.type === "tool") toolChars += rec.len
        }
        step.textChars = textChars
        step.reasonChars = reasonChars
        step.toolChars = toolChars
        saveStore()
      }),
    )

    cleanupFns.push(
      event.subscribe("session.reasoning.delta", (ev: any) => {
        const { sessionID, assistantMessageID, delta } = ev.data
        const s = ensureSession(sessionID)
        const step = s.step
        if (!step) return
        const owner = step.messageID
        const existing = s.parts[assistantMessageID]
        const prevLen = existing ? existing.len : 0
        const newLen = prevLen + delta.length
        s.parts[assistantMessageID] = { messageID: owner, type: "reasoning", len: newLen }
        step.firstAt ??= Date.now()
        if (step.phase === "waiting") step.phase = "streaming"

        let textChars = 0
        let reasonChars = 0
        let toolChars = 0
        for (const rec of Object.values(s.parts)) {
          if (rec.messageID !== owner) continue
          if (rec.type === "text") textChars += rec.len
          else if (rec.type === "reasoning") reasonChars += rec.len
          else if (rec.type === "tool") toolChars += rec.len
        }
        step.textChars = textChars
        step.reasonChars = reasonChars
        step.toolChars = toolChars
        saveStore()
      }),
    )

    cleanupFns.push(
      event.subscribe("session.tool.input.delta", (ev: any) => {
        const { sessionID, assistantMessageID, delta } = ev.data
        const s = ensureSession(sessionID)
        const step = s.step
        if (!step) return
        const owner = step.messageID
        const existing = s.parts[assistantMessageID]
        const prevLen = existing ? existing.len : 0
        const newLen = prevLen + delta.length
        s.parts[assistantMessageID] = { messageID: owner, type: "tool", len: newLen }
        step.firstAt ??= Date.now()
        step.phase = "tool"

        let textChars = 0
        let reasonChars = 0
        let toolChars = 0
        for (const rec of Object.values(s.parts)) {
          if (rec.messageID !== owner) continue
          if (rec.type === "text") textChars += rec.len
          else if (rec.type === "reasoning") reasonChars += rec.len
          else if (rec.type === "tool") toolChars += rec.len
        }
        step.textChars = textChars
        step.reasonChars = reasonChars
        step.toolChars = toolChars
        saveStore()
      }),
    )

    // ---- session status -----------------------------------------------------

    cleanupFns.push(
      event.subscribe("session.status", (ev: any) => {
        const { sessionID, status } = ev.data
        const s = ensureSession(sessionID)
        s.busy = status.type === "busy"
        const step = s.step
        if (status.type !== "busy" && step && !step.tokens && step.completedAt === undefined && step.phase !== "done") {
          step.errored = true
          step.phase = "done"
          step.completedAt = Date.now()
        }
        saveStore()
      }),
    )

    // ---- session usage (cumulative totals from core) ------------------------

    cleanupFns.push(
      event.subscribe("session.usage.updated", (ev: any) => {
        const { sessionID, tokens } = ev.data
        const s = ensureSession(sessionID)
        if (tokens) s.sessionTokens = tokens
        saveStore()
      }),
    )

    // Note: OpenCode v2.0.32 does not expose context.ui.slot() or context.theme.
    // Sidebar rendering is not supported by this runtime version. The plugin
    // collects token stats into persistent storage but cannot display them.

    return () => {
      cleanupFns.forEach((fn) => fn())
    }
  },
})
