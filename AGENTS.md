# AGENTS.md — maintenance guide (v2)

Audience: an agent or contributor modifying this plugin. Human-facing usage is
in `README.md`; architecture and rationale are in `DESIGN.md`.

This is the OpenCode V2 port of the token-stats TUI plugin. The V1 version
(targeting opencode 1.18.x) is frozen in `../opencode-token-stats-v1-archive`.

## Ground rules

1. **`src/token-stats.tsx` is the source of truth.** Edit `src/`, then test
   against a running opencode V2 TUI. Plugins load only at startup — restart
   opencode after any change.
2. **The plugin uses OpenCode's `context.storage.store()` for state.** This is
   a reactive Solid store persisted to disk. Handlers mutate it via `setStore`;
   the view reads it reactively. There is no file I/O — do not add `node:fs`.
3. **Prefer showing `-` over inventing a number.** Several fields are genuinely
   unknowable mid-turn. A visibly absent metric is better than a plausible wrong
   one.
4. **Keep rows within 35 columns.** The sidebar allows ~37; the widest row must
   not exceed 35.
5. **Pass values as thunks, never as pre-computed strings.** `{seg.t}` compiles
   to the reactive form; `{seg.t()}` compiles to a frozen constant. Pass colors
   as thunks too, and call them inside the JSX attribute position:
   `style={{ fg: seg.fg?.(), bold: seg.bold?.() }}`.

## V2 platform constraints

These are established from the opencode V2 source (`packages/plugin/src/tui/`,
`packages/tui/src/plugin/`, `packages/client/src/promise/generated/types.ts`):

1. **Plugin module shape:** `{ id: string, setup(context: Context) => void \| Cleanup }`.
   The package.json `tui` field points to the entrypoint. The default export
   must have an `id` (non-empty string) and a `setup` function.
2. **Events via `context.data.on(type, handler)`:** The handler receives the
   full event object; access the payload via `event.data`. Relevant event types:
   `session.step.started`, `session.step.ended`, `session.step.failed`,
   `session.text.delta`, `session.reasoning.delta`, `session.tool.input.delta`,
   `session.status`, `session.usage.updated`, `session.usage.recorded`.
3. **`TokenUsageInfo`** (`{ input, output, reasoning, cache: { read, write } }`)
   is the token shape — same as v1's `Tokens`. It arrives in
   `session.step.ended.data.tokens` and `session.usage.*.data.tokens`.
4. **`SessionInfo.tokens`** holds cumulative session tokens; available via
   `context.data.session.get(sessionID)?.tokens`.
5. **Slot `sidebar.content`** carries `{ sessionID: string }` input. Claim it
   with `ui.slot({ replace: "sidebar.content", render: (input) => JSX })`.
6. **Theme:** `context.theme` returns a `ResolvedTheme` with `text`,
   `textMuted`, `success`, `warning`, `error`, `border`, etc.
7. **Storage:** `context.storage.store(key, { initial })` returns
   `[Store, setStore]`. Mutations are synchronous in Solid; persistence to disk
   is async. Use it for all state — no `node:fs`.
8. **No `api.state.session.get()`**: session data comes from
   `context.data.session.get(sessionID)` and `context.data.session.message.*`.

## Common tasks

### Add a metric

1. Add the field to the view layout, keeping width ≤ 35.
2. Derive it from a memo reading the store; expose as an accessor.
3. Add a test scenario if you build a harness.

### Debug a "nothing updates" report

1. Check whether `session.step.started` / `session.step.ended` events arrive
   by appending to a log file from the handlers (not via the widget).
2. Confirm the store contains the expected data — `context.storage.store()`
   persists to disk, so you can inspect the file directly.
3. Verify the slot claim is active — `opencode plugin list` shows registered
   plugins.
