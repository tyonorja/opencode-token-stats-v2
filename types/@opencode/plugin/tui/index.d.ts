// Ambient type declarations for OpenCode V2 host-provided modules.
// These are provided by the OpenCode runtime at plugin load time, not via npm.

declare module "@opencode/plugin/tui" {
  import type { JSX } from "@opentui/solid"

  // ---- Context -------------------------------------------------------------

  export interface Context {
    readonly options: Readonly<Record<string, any>>
    readonly location: { directory: string; workspaceID?: string } | undefined
    readonly app: { version: string; channel: string }
    readonly renderer: any
    readonly client: any
    readonly data: {
      on: <T extends string>(type: T, handler: (event: any) => void) => () => void
      session: {
        list(): any[]
        get(sessionID: string): { tokens?: any; id: string; title?: string } | undefined
        message: {
          list(sessionID: string): any[]
        }
      }
    }
    readonly theme: {
      text: string
      textMuted: string
      success: string
      warning: string
      error: string
      border: string
      [key: string]: any
    }
    readonly ui: {
      slot: (claim: { replace: string; render: (input: any) => JSX.Element }) => () => void
    }
    readonly storage: {
      store: <Value extends object>(
        key: string,
        options: { readonly initial: Value },
      ) => readonly [Value, (mutation: (draft: Value) => void) => Promise<void>]
    }
    readonly keymap: any
    readonly attention: any
  }

  // ---- Plugin module -------------------------------------------------------

  export type Cleanup = () => Promise<void> | void

  export interface Definition {
    readonly id: string
    readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
  }

  export const Plugin: {
    define: (plugin: Definition) => Definition
  }
}
