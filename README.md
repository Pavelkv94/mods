# mods

Claude Code mods.

| Mod | What it does |
| --- | --- |
| [agent-crabs](./agent-crabs) | Side pane with a card per subagent and background process: animated crab, model, context fill, idle warning, API-equivalent cost, and expandable operations, files and tokens |
| [context-band](./context-band) | Band above the prompt: context fill, rate limits, session cost and a Handoff button that writes a handoff doc, clears the context and reads it back |
| [next-steps](./next-steps) | Только в desktop-приложении: после каждого ответа Haiku предлагает над полем ввода три разных варианта следующей команды столбиком с полным текстом; клик или цифра 1–3 вставляет её в поле ввода, Enter отправляет как твою команду. |
| [done-sound](./done-sound) | Проигрывает звук Glass, когда Claude завершает задачу ответом (только основной цикл, без сабагентов). |
| [session-branches](./session-branches) | Terminal-only pane with the tree of this project's sessions and their forks; press a row to switch to it |

## Install

At the prompt of a Claude Code terminal session (replace `<mod>` with a name from the table):

```
/plugin install <mod> --marketplace Pavelkv94/mods
```

Answer `y` to add the marketplace, then pick a scope (user is the default).

From a shell:

```
claude plugin install <mod> --marketplace Pavelkv94/mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Pavelkv94/mods`, then Add plugin.

## Update

```
claude plugin update <mod>@pavelkv94-mods
```

`smart-compact` was renamed to `context-band`: uninstall the old one and install `context-band`.
