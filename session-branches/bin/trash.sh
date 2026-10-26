#!/bin/sh
# Moves one session of a project to the Trash: its transcript, its folder of
# subagent and tool output, and its file history. Finder's "Put Back" restores it.
# usage: trash.sh <cwd> <id>
cwd=$1
id=$2
case "$id" in
  *[!0-9a-fA-F-]* | "") echo "not a session id: $id" >&2; exit 2 ;;
esac
dir="$HOME/.claude/projects/$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')"
[ -f "$dir/$id.jsonl" ] || { echo "no session $id in $dir" >&2; exit 3; }

set -- "$dir/$id.jsonl"
[ -d "$dir/$id" ] && set -- "$@" "$dir/$id"
[ -d "$HOME/.claude/file-history/$id" ] && set -- "$@" "$HOME/.claude/file-history/$id"

osascript - "$@" >/dev/null <<'OSA' && exit 0
on run argv
  set targets to {}
  repeat with p in argv
    set end of targets to (POSIX file (contents of p))
  end repeat
  tell application "Finder" to delete targets
end run
OSA
# No Finder (or no permission to script it): the same move by hand.
stamp=$(date +%s)
mkdir -p "$HOME/.Trash" && for p in "$@"; do
  case "$p" in
    "$HOME/.claude/file-history/"*) name="claude-file-history-$id" ;;
    *) name="claude-session-$(basename "$p")" ;;
  esac
  mv -- "$p" "$HOME/.Trash/$name.$stamp" || exit 1
done
