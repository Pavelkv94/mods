import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { SessionRow } from '../types'

const PANE = 'session-branches'
const TITLE = 'Session branches'
const LIMIT = '60'

const sessions = atom({ plugin: 'session-branches', key: 'sessions' } as const, [])
const current = atom({ plugin: 'session-branches', key: 'current' } as const, '')
const branchCommand = atom({ plugin: 'session-branches', key: 'branchCommand' } as const, null)
const confirming = atom({ plugin: 'session-branches', key: 'confirming' } as const, null)
const error = atom({ plugin: 'session-branches', key: 'error' } as const, null)

// Turns scan.sh output into rows: "S\t<id>", "M\t<mtime>", "P\t<parent>",
// then the session's last title and prompt rows as JSON lines.
export const parseScan = (text: string): SessionRow[] => {
  const rows: SessionRow[] = []
  let row: (SessionRow & { custom?: string; ai?: string; prompt?: string }) | undefined
  const flush = () => {
    if (!row) return
    const { custom, ai, prompt, ...rest } = row
    const title = custom || ai || prompt || rest.id.slice(0, 8)
    rows.push({ ...rest, title: title.replace(/\s+/g, ' ').trim() })
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('S\t')) {
      flush()
      row = { id: line.slice(2), parent: null, title: '', mtimeMs: 0 }
    } else if (!row) {
      continue
    } else if (line.startsWith('M\t')) {
      row.mtimeMs = Number(line.slice(2)) * 1000 || 0
    } else if (line.startsWith('P\t')) {
      row.parent = line.slice(2) || null
    } else if (line.startsWith('{')) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'custom-title') row.custom = entry.customTitle
        if (entry.type === 'ai-title') row.ai = entry.aiTitle
        if (entry.type === 'last-prompt') row.prompt = entry.lastPrompt
      } catch {}
    }
  }
  flush()

  return rows
}

// Depth-first order, newest first on each level; a parent outside the scanned
// window makes its child a root.
export const toTree = (rows: SessionRow[]) => {
  const ids = new Set(rows.map(r => r.id))
  const children = new Map<string | null, SessionRow[]>()
  for (const r of rows) {
    const key = r.parent && ids.has(r.parent) ? r.parent : null
    children.set(key, [...(children.get(key) ?? []), r])
  }
  const out: { row: SessionRow; depth: number; isOrphan: boolean }[] = []
  const walk = (key: string | null, depth: number) => {
    const list = [...(children.get(key) ?? [])].sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const row of list) {
      out.push({ row, depth, isOrphan: depth === 0 && row.parent !== null })
      walk(row.id, depth + 1)
    }
  }
  walk(null, 0)

  return out
}

// Every session below `id` in the tree, nearest first.
export const descendants = (rows: SessionRow[], id: string) => {
  const out: string[] = []
  const walk = (parent: string) => {
    for (const r of rows) {
      if (r.parent === parent && !out.includes(r.id)) {
        out.push(r.id)
        walk(r.id)
      }
    }
  }
  walk(id)

  return out
}

const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 60) return `${m}m`
  if (m < 60 * 24) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 60 / 24)}d`
}

type Dollar = Parameters<Hook<'session.start'>>[0]

// Re-reads the session id and the project's session files.
async function refresh($: Dollar) {
  const id = await $.session.id()
  await update($, current, () => id)
  try {
    const cwd = await $.session.root()
    const scan = await $.process.run(['/bin/sh', `${$.plugin.root}/bin/scan.sh`, cwd, LIMIT])
    if (scan.exitCode !== 0) throw new Error(scan.stderr.trim() || `scan exited ${scan.exitCode}`)
    await update($, sessions, () => parseScan(scan.stdout))
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => String(err))
  }
}

// Moves sessions to the Trash (bin/trash.sh), never the one this window runs.
async function trash($: Dollar, ids: string[]) {
  await update($, confirming, () => null)
  const here = await read($, current)
  const cwd = await $.session.root()
  let moved = 0
  for (const id of ids.filter(one => one !== here)) {
    const done = await $.process.run(['/bin/sh', `${$.plugin.root}/bin/trash.sh`, cwd, id])
    if (done.exitCode !== 0) {
      $.ui.toast(`Could not delete ${id.slice(0, 8)}: ${done.stderr.trim() || done.exitCode}`)
      break
    }
    moved += 1
  }
  if (moved > 0) $.ui.toast(moved === 1 ? 'Session moved to Trash' : `${moved} sessions moved to Trash`)
  await refresh($)
}

// Opens the session in a new tab of the terminal claude runs in; where the
// terminal is not one open-tab.sh knows, the command goes to the clipboard.
async function openTab($: Dollar, id: string) {
  const cwd = await $.session.root()
  const command = `claude --resume ${id}`
  try {
    const opened = await $.process.run(['/bin/sh', `${$.plugin.root}/bin/open-tab.sh`, cwd, id])
    if (opened.exitCode === 0) {
      const how = opened.stdout.trim()
      $.ui.toast(how === 'terminal-window' ? 'Session opened in a new Terminal window' : 'Session opened in a new tab')
      return
    }
    if (opened.exitCode !== 2) throw new Error(opened.stderr.trim() || `open-tab exited ${opened.exitCode}`)
  } catch (err) {
    $.ui.toast(`Could not open a tab: ${String(err)}`)
  }
  const copied = await $.ui.copy({ text: command, surface: 'terminal' })
  $.ui.toast(copied.isCopied ? `Copied: ${command}` : `Open a tab and run: ${command}`)
}

export const register: Register = on => {
  // Terminal only. The pane opens with the session and stays: a docked
  // column in the fullscreen layout, inline on the main screen.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.surface !== 'terminal') return started

    await $.command.register({
      name: 'branches',
      description: 'Open the tree of session branches (forks) of this project',
    })
    const names = (await $.command.list()).map(c => c.name)
    const fork = ['branch', 'fork'].find(n => names.includes(n)) ?? null
    await update($, branchCommand, () => fork)
    await refresh($)
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('command.run', { command: 'branches' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: opened.isPlaced ? 'Session branches pane opened.' : `The pane did not open: ${opened.reason}` }
  })

  // The list changes when a turn writes the session file or a fork appears.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) void refresh($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, sessions)
    const rows = toTree(all)
    const asking = await read($, confirming)
    const here = await read($, current)
    const fork = await read($, branchCommand)
    const failure = await read($, error)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns)
    const room = Math.max(1, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24) - 3)
    const at = Math.max(0, rows.findIndex(r => r.row.id === here))
    const start = Math.max(0, Math.min(at - Math.floor(room / 2), rows.length - room))

    const run = async (command: string, args?: string) => {
      try {
        await $.command.run({ command, args })
      } catch (err) {
        $.ui.toast(`/${command}: ${String(err)}`)
      }
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" hotkey="r" onPress={() => void refresh($)}>Refresh</Button>
          {fork && (
            <Button key="fork" hotkey="b" variant="primary" onPress={() => void run(fork)}>
              Fork current
            </Button>
          )}
        </Box>
        {failure && <Text color="red">{failure}</Text>}
        {rows.length === 0 && !failure && <Text dimColor>No sessions in this project yet.</Text>}
        {rows.slice(start, start + room).map(({ row, depth, isOrphan }) => {
          const isHere = row.id === here
          const lead = `${'  '.repeat(depth)}${depth > 0 ? '└ ' : isOrphan ? '↳ ' : ''}${isHere ? '● ' : ''}`
          const when = ago(row.mtimeMs, now)
          const max = Math.max(4, width - lead.length - when.length - 7)
          const title = row.title.length > max ? `${row.title.slice(0, max - 1)}…` : row.title
          const below = asking === row.id ? descendants(all, row.id).filter(id => id !== here) : []
          return [
            <Box key={`row:${row.id}`} flexDirection="row">
              <Button
                key={row.id}
                plain
                onPress={() => (isHere ? $.ui.toast('You are already in this session') : void openTab($, row.id))}
              >
                {lead}
                <Text bold={isHere}>{title}</Text> <Text dimColor>{when}</Text>
              </Button>
              {!isHere && (
                <Button key={`here:${row.id}`} plain dimColor onPress={() => void run('resume', row.id)}>
                  {' ⇄'}
                </Button>
              )}
              {!isHere && (
                <Button
                  key={`del:${row.id}`}
                  plain
                  dimColor
                  onPress={() => void update($, confirming, was => (was === row.id ? null : row.id))}
                >
                  {' ✕'}
                </Button>
              )}
            </Box>,
            asking === row.id && (
              <Box key={`ask:${row.id}`} flexDirection="row" gap={1}>
                <Text color="red">{`${'  '.repeat(depth + 1)}Move to Trash?`}</Text>
                <Button key={`yes:${row.id}`} onPress={() => void trash($, [row.id])}>
                  This one
                </Button>
                {below.length > 0 && (
                  <Button key={`all:${row.id}`} onPress={() => void trash($, [row.id, ...below])}>
                    {`With branches (${below.length + 1})`}
                  </Button>
                )}
                <Button key={`no:${row.id}`} onPress={() => void update($, confirming, () => null)}>
                  Cancel
                </Button>
              </Box>
            ),
          ]
        })}
      </Box>
    )
  })
}
