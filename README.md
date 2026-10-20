# opencode-token-stats (v2)

OpenCode V2 TUI sidebar plugin that reports token and throughput statistics
for the current turn, plus cumulative session totals.

## Installation

```bash
opencode plugin add ./path/to/opencode-token-stats-v2
```

Or install from a git URL:

```bash
opencode plugin add git+https://github.com/tyonorja/opencode-token-stats-v2.git
```

Then restart opencode (plugins load only at startup) and look for the **Tokens**
block under Context in the sidebar.

## What it displays

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

See [`DESIGN.md`](DESIGN.md) for field semantics and design rationale.

## V1 → V2 migration

This is a rewrite for OpenCode V2. The V1 version (which targeted OpenCode
1.18.x) has been frozen in the [`opencode-token-stats-v1-archive`](../opencode-token-stats-v1-archive)
directory alongside this repo.

Key differences from V1:

| Concern | V1 (opencode 1.x) | V2 (opencode 2.x) |
|---|---|---|
| Plugin module | `{ id, tui(api, options) }` | `{ id, setup(context) }` |
| Package entry | `.tsx` loaded directly | `tui` field in `package.json` |
| Events | `message.updated`, `message.part.updated`, `session.status` | `session.step.*`, `session.*.delta`, `session.status`, `session.usage.*` |
| Slot | `sidebar_content` | `sidebar.content` |
| State | File-based snapshot in `~/.local/state/opencode/token-stats/` | `context.storage.store()` (reactive Solid store, persisted to disk) |
| Session tokens | `api.state.session.get(id)?.tokens` (runtime-only, untyped) | `SessionInfo.tokens` (typed via `@opencode/client`) |
| Theme | `api.theme.current` | `context.theme` |
| Imports | `@opencode-ai/plugin/tui` | `@opencode/plugin/tui` |

V2 streaming is driven by delta events (`session.text.delta`,
`session.reasoning.delta`, `session.tool.input.delta`) rather than the V1
`message.part.updated` bus. Token counts arrive via `session.step.ended` and
`session.usage.updated` events.

## Development

```bash
cd opencode-token-stats-v2
# Type-check (requires @opencode/plugin, @opentui/solid, solid-js installed)
npx tsc --noEmit
```

Install the plugin for testing:

```bash
opencode plugin add .
```

Then restart opencode and send a prompt.

## License

MIT
