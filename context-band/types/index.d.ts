export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  percent: number | null
  tokens: number | null
  window: number
  limits: Limit[]
  /** US dollars this session has cost, as /cost totals it; null where the host keeps no ledger */
  cost: number | null
}

/** When the main thread's last API response landed (ms), and whether the cooling warning was shown for it. */
export type Cache = { lastAt: number | null; warned: boolean }

export type Phase = 'idle' | 'writing' | 'clearing' | 'reading'
export type Flow = { phase: Phase; path: string | null }

/** What the main thread did with its tools this conversation, the evidence for the kind of work and its strain. */
export type Activity = {
  edits: number
  reads: number
  web: number
  runs: number
  /** reads of a file already read twice */
  rereads: number
  /** failures of a command that had failed before */
  repeatFails: number
  /** the most re-read file and its read count */
  hotFile: { path: string; count: number } | null
  readCounts: Record<string, number>
  failCounts: Record<string, number>
  /** the highest degradation tone already toasted, so each level is announced once */
  alerted: 'info' | 'warn' | 'hot' | null
}

declare module 'claude-code' {
  interface PluginState {
    // handoff: the last handoff this work continued from, which the next one builds on
    'context-band': { usage: Usage | null; flow: Flow; cache: Cache; tick: number; handoff: string | null; activity: Activity }
  }
}
