#!/bin/sh
# Prints a short summary of the newest sessions of a project.
# usage: scan.sh <cwd> [limit]
# Per session: "S\t<id>", "M\t<mtime>", "P\t<parent id>", then the last
# custom-title, ai-title and last-prompt rows as raw JSON lines.
cwd=$1
limit=${2:-30}
dir="$HOME/.claude/projects/$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')"
[ -d "$dir" ] || exit 0
cd "$dir" || exit 0
ls -t -- *.jsonl 2>/dev/null | head -n "$limit" | while IFS= read -r f; do
  id=${f%.jsonl}
  mtime=$(stat -f %m -- "$f" 2>/dev/null || stat -c %Y -- "$f" 2>/dev/null)
  parent=$(grep -o '"sessionId":"[^"]*"' -- "$f" | uniq | cut -d'"' -f4 | grep -vx -- "$id" | tail -n 1)
  printf 'S\t%s\nM\t%s\nP\t%s\n' "$id" "$mtime" "$parent"
  grep '^{"type":"custom-title"' -- "$f" | tail -n 1
  grep '^{"type":"ai-title"' -- "$f" | tail -n 1
  grep '^{"type":"last-prompt"' -- "$f" | tail -n 1
done
