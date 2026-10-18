export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  percent: number | null
  tokens: number | null
  window: number
  limits: Limit[]
}
export type Phase = 'idle' | 'writing' | 'compacting' | 'reading'
export type Flow = { phase: Phase; path: string | null }

declare module 'claude-code' {
  interface PluginState {
    'smart-compact': { usage: Usage | null; flow: Flow }
  }
}
