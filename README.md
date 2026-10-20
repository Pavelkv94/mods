# mods

Claude Code mods.

| Mod | What it does |
| --- | --- |
| [agent-crabs](./agent-crabs) | Side pane with a card per subagent: animated crab, model, progress bar, API-equivalent cost, and expandable details of its operations, files and tokens |
| [context-band](./context-band) | Band above the prompt: context fill, rate limits, session cost and a Handoff button that writes a handoff doc, clears the context and reads it back |
| [next-steps](./next-steps) | После каждого ответа Haiku предлагает над полем ввода три разных варианта следующей команды столбиком с полным текстом; клик или цифра 1–3 отправляет её в чат. |

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
