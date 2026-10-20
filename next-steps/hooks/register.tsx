import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Suggestion, SuggestStatus } from '../types'

const suggestions = atom({ plugin: 'next-steps', key: 'suggestions' } as const, [] as Suggestion[])
const status = atom({ plugin: 'next-steps', key: 'status' } as const, 'idle' as SuggestStatus)

const MODEL = 'haiku'
const RECENT_MESSAGES = 14
const MESSAGE_CHARS = 1500

const SYSTEM = `Ты помогаешь пользователю Claude Code продолжить работу. По фрагменту диалога предложи ровно 3 варианта СЛЕДУЮЩЕГО сообщения, которое пользователь мог бы отправить ассистенту.

Варианты должны быть РАЗНЫМИ по направлению, не перефразировками одного:
1. продолжить или углубить текущую работу (следующий логичный шаг);
2. проверить результат (тест, запуск, ревью, проверка граничных случаев);
3. альтернатива или смежное направление (другой подход, улучшение, сопутствующая задача, вопрос о решении).

Правила:
- Пиши на языке, на котором пишет пользователь, от первого лица пользователя, как команду ассистенту.
- Опирайся на конкретику диалога: файлы, функции, названия, открытые вопросы. Без общих фраз вроде «продолжай».
- Если ассистент задал вопрос, один из вариантов должен на него отвечать.
- label: 2–5 слов для кнопки; prompt: само сообщение, 1–2 предложения.
- Ответ: только JSON-массив из 3 объектов {"label": "...", "prompt": "..."} без пояснений и без markdown.`

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

// Самый длинный заголовок кнопки; длиннее — обрезается, полный текст всё равно виден справа.
const LABEL_MAX = 28

const describe = (m: SessionMessage) => {
  const tools = m.toolUses.map(t => {
    const target = t.input.file_path ?? t.input.command ?? t.input.pattern ?? t.input.description
    return `[${t.tool}${typeof target === 'string' ? `: ${clip(target, 80)}` : ''}]`
  })
  const body = [m.text.trim(), tools.join(' ')].filter(Boolean).join('\n')
  return body ? `${m.role === 'user' ? 'ПОЛЬЗОВАТЕЛЬ' : 'АССИСТЕНТ'}: ${clip(body, MESSAGE_CHARS)}` : ''
}

export const parseSuggestions = (text: string): Suggestion[] => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const raw: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    return raw
      .filter((s): s is Suggestion => typeof s?.label === 'string' && typeof s?.prompt === 'string')
      .map(s => ({ label: s.label.trim(), prompt: s.prompt.trim() }))
      .filter(s => s.label && s.prompt && !seen.has(s.prompt.toLowerCase()) && seen.add(s.prompt.toLowerCase()))
      .slice(0, 3)
  } catch {
    return []
  }
}

// Каждый новый ход или запрос увеличивает номер; ответ Haiku для старого номера выбрасывается.
let generation = 0

async function clear($: EngineInterface) {
  generation += 1
  await update($, suggestions, () => [])
  await update($, status, () => 'idle' as const)
}

async function suggest($: EngineInterface, mine: number) {
  try {
    await update($, status, () => 'thinking' as const)
    const recent = (await $.session.messages()).slice(-RECENT_MESSAGES).map(describe).filter(Boolean)
    if (recent.length === 0) return
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: `Фрагмент диалога (последние сообщения):\n\n${recent.join('\n\n')}\n\nПредложи 3 разных варианта следующего сообщения пользователя.`,
      maxTokens: 700,
      effort: 'low',
      timeoutMs: 25_000,
    })
    if (mine !== generation) return
    const found = reply.isAnswered ? parseSuggestions(reply.text) : []
    await update($, suggestions, () => found)
    await update($, status, () => (found.length ? 'ready' : 'idle') as SuggestStatus)
    // Запись из фоновой задачи не всегда перерисовывает полосу — просим явно.
    $.ui.invalidate('ui.render')
  } catch {
    if (mine === generation) await update($, status, () => 'idle' as const)
  }
}

async function choose($: EngineInterface, s: Suggestion) {
  await clear($)
  // Выбор — жест самого пользователя: отправляем как его слова, без рамки «plugin sent a message».
  await $.prompt.submit({ text: s.prompt, asUser: true })
}

export const register: Register = on => {
  // Перезагрузка мода обрывает подбор, начатый старой копией: статус остаётся «thinking». Перезапускаем.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      if ((await read($, status)) === 'thinking') {
        generation += 1
        void suggest($, generation)
      }
    } catch {
      // Подсказки не должны мешать старту сессии.
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // Ошибка мода не должна мешать отправке запроса.
    if (!e.isMeta) await clear($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.isAborted || e.reason !== 'answer') return result
    generation += 1
    void suggest($, generation)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const state = await read($, status)
    if (state === 'idle') return next(e)

    // Полоса одна на все моды: то, что рисуют моды ниже (индикаторы context-band), оставляем под кнопками.
    // Пока Haiku подбирает варианты, полоса остаётся как есть — показываем только готовые кнопки.
    if (state === 'thinking') return next(e)
    const below = await next(e).catch(() => null)
    const { Box, Button, Text } = $.ui.resolve(e)

    const list = await read($, suggestions)
    // Столбик: слева кнопка с коротким заголовком, справа тусклым — полный текст промпта.
    // Колонка кнопок одной ширины, чтобы тексты начинались ровно; пустая строка между вариантами, чтобы длинные промпты не сливались.
    const labelMax = Math.min(LABEL_MAX, Math.max(...list.map(s => s.label.length)))
    const labelColumn = labelMax + 4

    return (
      <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} rowGap={1}>
          {list.map((s, i) => (
            <Box key={`row${i}`} flexDirection="row" columnGap={1}>
              <Box width={labelColumn} flexShrink={0}>
                <Button
                  key={`s${i}`}
                  label={clip(s.label, labelMax)}
                  hotkey={String(i + 1)}
                  variant={i === 0 ? 'primary' : 'secondary'}
                  onPress={() => void choose($, s)}
                />
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="wrap">{s.prompt}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        <Button key="dismiss" label="✕" role="dismiss" dimColor onPress={() => void clear($)} />
      </Box>
      {below}
      </Box>
    )
  })
}
