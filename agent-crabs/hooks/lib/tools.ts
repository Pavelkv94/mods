import type { ActivityKind, FileOp, FileTouch, Plan } from '../../types'
import { firstLine, lineCount } from './format'

const KEEP_FILES = 30

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const RUN_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor'])
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
const AGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage'])

export function kindOf(tool: string): ActivityKind {
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (RUN_TOOLS.has(tool)) return 'run'
  if (WEB_TOOLS.has(tool)) return 'web'
  if (AGENT_TOOLS.has(tool)) return 'agent'
  return 'other'
}

export type Touch = { path: string; op: FileOp; added: number; removed: number }

// What one call does to the files: which it touched, how, and the lines it changed.
export function fileTouchOf(tool: string, args: Record<string, unknown>): Touch | undefined {
  const path = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : undefined
  if (path === undefined) return undefined
  if (tool === 'Read' || tool === 'NotebookRead') return { path, op: 'R', added: 0, removed: 0 }
  if (tool === 'Write') return { path, op: 'W', added: lineCount(args.content), removed: 0 }
  if (tool === 'Edit') return { path, op: 'E', added: lineCount(args.new_string), removed: lineCount(args.old_string) }
  if (tool === 'MultiEdit' && Array.isArray(args.edits)) {
    const edits = args.edits as { old_string?: unknown; new_string?: unknown }[]
    return {
      path,
      op: 'E',
      added: edits.reduce((n, edit) => n + lineCount(edit.new_string), 0),
      removed: edits.reduce((n, edit) => n + lineCount(edit.old_string), 0),
    }
  }
  if (tool === 'NotebookEdit') return { path, op: 'E', added: 0, removed: 0 }
  return undefined
}

export function addFile(files: readonly FileTouch[], touch: Touch): FileTouch[] {
  const found = files.find(file => file.path === touch.path)
  if (found) {
    return files.map(file =>
      file === found
        ? {
            ...file,
            ops: file.ops.includes(touch.op) ? file.ops : [...file.ops, touch.op],
            added: file.added + touch.added,
            removed: file.removed + touch.removed,
          }
        : file,
    )
  }
  const next = [...files, { path: touch.path, ops: [touch.op], added: touch.added, removed: touch.removed }]
  return next.length > KEEP_FILES ? next.slice(-KEEP_FILES) : next
}

export function planOf(args: Record<string, unknown>): Plan | undefined {
  if (!Array.isArray(args.todos)) return undefined
  const todos = args.todos as { status?: unknown; content?: unknown; activeForm?: unknown }[]
  if (todos.length === 0) return undefined
  const current = todos.find(todo => todo.status === 'in_progress')
  const label = current && (typeof current.activeForm === 'string' ? current.activeForm : current.content)
  return {
    done: todos.filter(todo => todo.status === 'completed').length,
    total: todos.length,
    ...(typeof label === 'string' && label !== '' ? { current: firstLine(label, 80) } : {}),
  }
}
