// Ambient type declarations for @opencode/client (host-provided).

export type TokenUsageInfo = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}
