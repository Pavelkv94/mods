export type ActivityKind = 'read' | 'edit' | 'run' | 'web' | 'agent' | 'other'

export type Activity = { id: string; tool: string; target: string; kind: ActivityKind }

// one tool call of a subagent, as the Operations list shows it
export type Step = {
  id: string
  tool: string
  target: string
  kind: ActivityKind
  status: 'running' | 'ok' | 'error'
  startedAt: number
  endedAt?: number
  // what came of it: a diff for edits, why it failed
  note?: string
}

// R read, E edited, W written whole
export type FileOp = 'R' | 'E' | 'W'

export type FileTouch = { path: string; ops: FileOp[]; added: number; removed: number }

// the subagent's own todo list, when it keeps one
export type Plan = { done: number; total: number; current?: string }

export type AgentCard = {
  id: string
  role: string
  description: string
  model: string
  effort?: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'error' | 'killed'
  // uncached input only: the cache's two sides are counted apart, each at its own price
  tokensIn: number
  tokensOut: number
  tokensCacheWrite: number
  tokensCacheRead: number
  ctx: number
  steps: number
  tools: number
  activity?: Activity
  history: Step[]
  files: FileTouch[]
  plan?: Plan
  // the first line of what it said last, and of its final answer
  lastText?: string
  result?: string
  crab: number
}

export type ProcessKind = 'shell' | 'monitor'

export type BgProcess = {
  id: string
  kind: ProcessKind
  description: string
  command: string
  owner?: string
  startedAt: number
  endedAt?: number
  // 'stale': no word of it for STALE_MS while the engine gave no task list to check against
  status: 'running' | 'done' | 'error' | 'killed' | 'stale'
  summary?: string
  // last time the engine's list of background tasks named it
  lastSeenAt?: number
  // a Monitor's deadline: past it the watch is over
  deadlineAt?: number
  // the engine ends it with its owner's final response, no notification follows
  endsWithOwner?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crabs': {
      agents: AgentCard[]
      processes: BgProcess[]
      now: number
      closedByHand: boolean
      // ids of the cards opened to their details
      expanded: string[]
    }
  }
}
