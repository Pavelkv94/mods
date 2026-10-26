import type { ActivityKind, AgentCard, BgProcess, FileOp, ProcessKind } from '../../types'

// green and red are kept for finished and failed agents
export const CRAB_COLORS = ['#D97757', '#58A6FF', '#BC8CFF', '#F2CC60', '#39C5CF', '#FF7EB6', '#E3A15B']
export const OK = '#3FB950'
export const ERR = '#F85149'
export const WARN = '#D29922'
export const MUTED = '#8B949E'

export const MODEL_COLORS: Record<string, string> = {
  opus: '#BC8CFF',
  sonnet: '#58A6FF',
  haiku: '#39C5CF',
  fable: '#D97757',
  mythos: '#D97757',
}

export const KIND_STYLE: Record<ActivityKind, { color: string; verb: string }> = {
  read: { color: '#58A6FF', verb: 'reading' },
  edit: { color: '#E3A15B', verb: 'editing' },
  run: { color: '#BC8CFF', verb: 'running' },
  web: { color: '#39C5CF', verb: 'browsing' },
  agent: { color: '#FF7EB6', verb: 'delegating' },
  other: { color: MUTED, verb: 'calling' },
}

export const FILE_OP: Record<FileOp, { color: string; title: string }> = {
  R: { color: '#58A6FF', title: 'read' },
  E: { color: '#E3A15B', title: 'edited' },
  W: { color: OK, title: 'written' },
}

export const PROCESS_STYLE: Record<ProcessKind, { color: string; label: string; glyph: string }> = {
  shell: { color: '#BC8CFF', label: 'shell', glyph: '❯' },
  monitor: { color: '#39C5CF', label: 'monitor', glyph: '◉' },
}

export const PROCESS_END: Record<Exclude<BgProcess['status'], 'running'>, { color: string; text: string }> = {
  done: { color: OK, text: '✓ finished' },
  error: { color: ERR, text: '✕ failed' },
  killed: { color: MUTED, text: '■ stopped' },
  stale: { color: WARN, text: '? no word, probably finished' },
}

export const AGENT_STATUS: Record<AgentCard['status'], { text: string }> = {
  running: { text: '● running' },
  done: { text: '✓ done' },
  error: { text: '✕ failed' },
  killed: { text: '■ stopped' },
}
