# agent-crabs

A side pane for Claude Code that shows every subagent and background process of the session, each subagent with a pixel crab that types while it works.

## What it shows

- **A card per running subagent**: role, model, what it is doing right now and for how long, its context fill against the session's window (amber past 70%, red past 90%), todo progress when it keeps a list, tokens and API-equivalent cost. A subagent with no step or tool call of its own for 90 seconds, and no child at work, is flagged `⚠ quiet`.
- **Nesting**: a subagent spawned by another sits right under it, indented.
- **Ended subagents** keep their card, crab and all, with the outcome: done, failed or stopped. `▸` opens its result, operations, files touched (with `+/−` lines) and a token and cost breakdown.
- **Background shells and monitors**, ended by notification, `TaskStop`, the engine's task list or a Monitor's deadline. A running one has **■ Stop**, which asks once more before it calls `TaskStop`. An ended one folds its command behind `▸`.

`Clear finished` (`c`) drops what has ended.

## Cost

Costs are API list prices, so under a subscription they read as what the same work would cost on the API. Subagent figures are computed from each response's usage: long Haiku 5.5 prompts are billed at the long-prompt rate, cache writes count as five-minute ones until the Agent tool's record says how many were kept an hour, and fast mode doubles the price.

## Use

The pane opens with the session and again on your next prompt if it was not placed. `/crabs` reopens it after you close it by hand.
