#!/bin/sh
# herdr-usage.sh -- macOS/Linux counterpart of herdr-usage.ps1: the herdr GUI's
# Claude Code statusLine tap. Claude Code runs it as `sh "<path>"`.
#
# Reads the statusLine hook's JSON on stdin, writes
# ~/.claude/herdr-usage.json as {"captured_at":<epoch s>,"rate_limits":{...}},
# then runs the chained statusLine command (if any) with the same stdin and
# lets its stdout through unmodified. Needs jq or python3; with neither, it
# writes an empty rate_limits object. Always exits 0 so a broken tap can never
# break Claude Code's UI.

claude_dir="${HOME}/.claude"
tmp=$(mktemp "${TMPDIR:-/tmp}/herdr-usage.XXXXXX") || exit 0
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
mkdir -p "$claude_dir" 2>/dev/null

json=""
if command -v jq >/dev/null 2>&1; then
    json=$(jq -c --argjson t "$(date +%s)" '{captured_at: $t, rate_limits: (.rate_limits // {})}' "$tmp" 2>/dev/null)
elif command -v python3 >/dev/null 2>&1; then
    json=$(python3 -c 'import json,sys,time
d=json.load(open(sys.argv[1]))
print(json.dumps({"captured_at":int(time.time()),"rate_limits":d.get("rate_limits") or {}},separators=(",",":")))' "$tmp" 2>/dev/null)
fi
# Invalid JSON or no parser: an empty object, so the usage bar shows no window
# data instead of going stale.
[ -n "$json" ] || json="{\"captured_at\":$(date +%s),\"rate_limits\":{}}"

out="$claude_dir/herdr-usage.json"
printf '%s' "$json" > "$out.tmp-$$" 2>/dev/null && mv -f "$out.tmp-$$" "$out" 2>/dev/null

chain="$claude_dir/statusline/herdr-usage.chain.txt"
if [ -f "$chain" ]; then
    line=$(cat "$chain")
    [ -n "$line" ] && sh -c "$line" < "$tmp"
fi
exit 0
