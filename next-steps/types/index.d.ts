export type Suggestion = { label: string; prompt: string }

export type SuggestStatus = 'idle' | 'thinking' | 'ready'

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { suggestions: Suggestion[]; status: SuggestStatus }
  }
}
