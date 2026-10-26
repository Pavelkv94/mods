#!/bin/sh
# Opens a new terminal tab running `claude --resume <id>` in <cwd>.
# usage: open-tab.sh <cwd> <id>
# Prints how it opened it: tmux, wezterm, iterm, terminal-tab, terminal-window.
# Exits 2 when the terminal is not one it knows.
cwd=$1
id=$2
q=$(printf "%s" "$cwd" | sed "s/'/'\\\\''/g")
cmd="cd '$q' && claude --resume $id"

if [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
  tmux new-window -c "$cwd" "claude --resume $id" && echo tmux && exit 0
fi

case "$TERM_PROGRAM" in
  WezTerm)
    wezterm cli spawn --cwd "$cwd" -- claude --resume "$id" >/dev/null && echo wezterm && exit 0
    ;;
  iTerm.app)
    osascript - "$cmd" <<'OSA' && echo iterm && exit 0
on run argv
  tell application "iTerm"
    tell current window
      set newTab to (create tab with default profile)
      tell current session of newTab to write text (item 1 of argv)
    end tell
  end tell
end run
OSA
    ;;
  Apple_Terminal)
    # A tab needs cmd+T through System Events (Accessibility permission);
    # without it the session opens in a new window.
    osascript - "$cmd" <<'OSA' 2>/dev/null && echo terminal-tab && exit 0
on run argv
  tell application "Terminal" to activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.4
  tell application "Terminal" to do script (item 1 of argv) in selected tab of front window
end run
OSA
    osascript - "$cmd" <<'OSA' && echo terminal-window && exit 0
on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run
OSA
    ;;
esac
exit 2
