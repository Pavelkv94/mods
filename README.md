# mods

Claude Code mods.

| Mod | What it does |
| --- | --- |
| [smart-compact](./smart-compact) | Context fill and rate limits above the prompt, plus a Smart compact button that writes a handoff doc, compacts and re-reads it |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install smart-compact --marketplace Pavelkv94/mods
```

Answer `y` to add the marketplace, then pick a scope (user is the default).

From a shell:

```
claude plugin install smart-compact --marketplace Pavelkv94/mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Pavelkv94/mods`, then Add plugin.

## Update

```
claude plugin update smart-compact@pavelkv94-mods
```
