import type { Register } from 'claude-code'

// Системный звук macOS: в моде его копии нет, читаем файл с диска.
const GLASS = '/System/Library/Sounds/Glass.aiff'

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Только ответ основного цикла: без сабагентов, прерываний и ошибок.
    if (e.agentId !== undefined || e.isAborted || e.reason !== 'answer') return result
    // Звук не должен задерживать или ломать конец хода.
    void $.fs
      .read(GLASS, { as: 'bytes' })
      .then(({ base64 }) => $.audio.play({ base64, mime: 'audio/aiff' }))
      .catch(() => undefined)
    return result
  })
}
