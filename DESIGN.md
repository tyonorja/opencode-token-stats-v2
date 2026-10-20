# Design: opencode token-stats TUI plugin (v2)

A sidebar widget for OpenCode V2 that reports token and throughput statistics
for the current turn, plus cumulative session totals.

This document records what the implementation does and **why** — several design
decisions look wrong in isolation and are only justified by constraints
discovered empirically against a running OpenCode V2.

---

## 1. What it displays

(Same layout as v1 — see v1 `DESIGN.md` for the full field table.)

```
Tokens                      streaming
prompt        342k  read     342k
write            -  hit    100.0%
out         ~1,170
reason        ~550  █████░░░░░░░░░░
────────────────────────────────
ttft         36.0s
prefill          -
decode  44.8 tok/s
step         62.0s
────────────────────────────────
session 227 req
* dimmed = previous turn
```

**Two axes:** `prompt`/`read`/`write`/`hit`/`out`/`reason`/`ttft`/`prefill`/
`decode`/`step` describe the last completed turn. `session … req` is cumulative.
While a new turn is in flight the turn rows show the previous turn's values,
dimmed, with a `* dimmed = previous turn` footnote.

---

## 2. Architecture

```
 opencode core V2
      │
      │  bus delivers session.* events to plugins via context.data.on()
      ▼
┌─────────────────────────────────────────────────┐
│  setup()         event handlers                 │
│                  · mutate context.storage.store()│
│                  · reactive Solid store          │──┐
└─────────────────────────────────────────────────┘   │
                                                      │ single channel
┌─────────────────────────────────────────────────┐   │
│  View()          sidebar.content slot           │◀──┘
│                  · reads store reactively        │
│                  · formats rows                  │
└─────────────────────────────────────────────────┘
                      │
                      ▼
              OpenCode plugin storage (disk)
```

**Handlers and view share state through `context.storage.store()`.** This is a
reactive Solid store persisted to disk by OpenCode. Handlers mutate it via
`setStore`; the view reads it via `createMemo` and direct property access in
JSX. Solid's reactivity ensures the view re-renders when the store changes.

This replaces the v1 file-based snapshot system (`~/.local/state/opencode/
token-stats/<sessionID>.json`) which was necessary because v1's in-memory
propagation silently failed. In v2, `storage.store()` is the canonical shared
state channel.

---

## 3. Platform constraints

Everything here was established from the OpenCode V2 source code
(`packages/plugin/src/tui/`, `packages/tui/src/plugin/`,
`packages/client/src/promise/generated/types.ts`).

### 3.1 Plugin module shape

```ts
export default Plugin.define({
  id: "token-stats",
  setup: (context: Context) => { ... return () => cleanup; },
})
```

The package.json `tui` field points to the entrypoint (`./src/token-stats.tsx`).
The default export must have an `id` (non-empty string) and a `setup` function.

### 3.2 Events via `context.data.on()`

Relevant event types and their `data` payloads:

| Event | Payload fields | Used for |
|---|---|---|
| `session.step.started` | `sessionID`, `assistantMessageID`, `started` | New step begins |
| `session.step.ended` | `sessionID`, `assistantMessageID`, `finish`, `cost`, `tokens` | Step complete, token counts |
| `session.step.failed` | `sessionID`, `assistantMessageID`, `error`, `tokens?` | Step failed |
| `session.text.delta` | `sessionID`, `assistantMessageID`, `ordinal`, `delta` | Streaming text |
| `session.reasoning.delta` | `sessionID`, `assistantMessageID`, `ordinal`, `delta` | Streaming reasoning |
| `session.tool.input.delta` | `sessionID`, `assistantMessageID`, `id`, `delta` | Streaming tool input |
| `session.status` | `sessionID`, `status: { type: "idle" \| "busy" \| ... }` | Busy/idle |
| `session.usage.updated` | `sessionID`, `cost`, `tokens` | Cumulative session totals |

The handler receives the full event object; access the payload via `event.data`.

### 3.3 `TokenUsageInfo`

```ts
type TokenUsageInfo = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}
```

Same shape as v1's `Tokens`. Arrives in `session.step.ended.data.tokens` and
`session.usage.*.data.tokens`.

### 3.4 `SessionInfo.tokens`

`context.data.session.get(sessionID)?.tokens` returns cumulative session
tokens (`TokenUsageInfo`). This is typed, unlike v1's `api.state.session.get()`
which required an unsafe cast.

### 3.5 Slot `sidebar.content`

Claimed via `ui.slot({ replace: "sidebar.content", render: (input) => JSX })`
where `input` is `{ sessionID: string }`. The render function runs once per
mount; all dynamism must be thunks.

### 3.6 Storage

`context.storage.store(key, { initial })` returns `[Store, setStore]`.
- Durable JSON state: persisted to disk, survives hot reloads and TUI restarts
- Live-synced across running TUI instances
- Mutations are synchronous in Solid; persistence is async

Use it for all state — no `node:fs`, `node:os`, `node:path`.

### 3.7 Theme

`context.theme` returns a `ResolvedTheme` with `text`, `textMuted`,
`success`, `warning`, `error`, `border`, etc.

---

## 4. Event flow

1. `session.step.started` — a new assistant step begins. Create a `Step`
   record with `createdAt`, `messageID`, zeroed character counters.
2. `session.text.delta` / `session.reasoning.delta` / `session.tool.input.delta`
   — streaming content arrives. Accumulate `delta.length` into the part's
   high-water mark; recompute step totals from all parts.
3. `session.step.ended` — the step completed. Record `tokens: TokenUsageInfo`,
   update calibration ratios, increment `requests`.
4. `session.status` — session went busy/idle. If idle with no tokens and the
   step isn't done, mark it errored.
5. `session.usage.updated` — cumulative session token totals from core.
   Update `sessionTokens`.

The view reads the store reactively via `createMemo`. All formatting happens
in the view; handlers only mutate store state.

---

## 5. Estimating output tokens before completion

Same approach as v1: extrapolate from generated characters using a calibrated
chars-per-token ratio (EMA, α=0.5, clamped to [1.5, 12]). Generated characters
= text + reasoning + tool input. Calibration applied when a step reports ≥20
generated tokens.

The ratio persists in the store, so calibration survives restarts.

---

## 6. Layout

Same as v1: sidebar allows ~37 usable columns; widest row is 35.

```
LEFT_LABEL_WIDTH  = 8    LEFT_VALUE_WIDTH  = 10
RIGHT_LABEL_WIDTH = 6    RIGHT_VALUE_WIDTH = 7
BAR_WIDTH         = 15   RULE_WIDTH        = 32
```

---

## 7. Known differences from v1

| Aspect | V1 | V2 |
|---|---|---|
| State channel | File snapshot + in-memory map | `context.storage.store()` (reactive Solid store) |
| Events | `message.updated`, `message.part.updated` | `session.step.*`, `session.*.delta` |
| Streaming | `part.text` cumulative per part id | `delta` strings accumulated per message |
| Session tokens | `api.state.session.get()` (untyped cast) | `SessionInfo.tokens` (typed) |
| Slot | `sidebar_content` | `sidebar.content` |
| Theme | `api.theme.current` | `context.theme` |
| File I/O | `node:fs` for snapshots | None — storage.store() handles persistence |
| Plugin module | `{ id, tui(api, options) }` | `{ id, setup(context) }` |
