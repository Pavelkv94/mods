export type SessionRow = {
  id: string
  parent: string | null
  title: string
  mtimeMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-branches': {
      sessions: SessionRow[]
      current: string
      branchCommand: string | null
      error: string | null
      confirming: string | null
    }
  }
}
