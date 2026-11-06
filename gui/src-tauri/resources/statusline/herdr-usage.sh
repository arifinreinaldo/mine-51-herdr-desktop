#!/bin/sh
# herdr-usage.sh -- macOS/Linux counterpart of herdr-usage.ps1: the herdr GUI's
# Claude Code statusLine tap. Claude Code runs it as `sh "<path>"`.
#
# Reads the statusLine hook's JSON on stdin, writes
# ~/.claude/herdr-usage.json as {"captured_at":<epoch s>,"rate_limits":{...}}
# (plus one ~/.claude/herdr-usage/<session_id>.json per Claude Code session),
# then runs the chained statusLine command (if any) with the same stdin and
# lets its stdout through unmodified. Needs jq or python3; with neither, it
# writes an empty rate_limits object. Always exits 0 so a broken tap can never
# break Claude Code's UI.

# Git Bash on Windows sets HOME; USERPROFILE is the fallback.
claude_dir="${HOME:-$USERPROFILE}/.claude"
tmp=$(mktemp "${TMPDIR:-/tmp}/herdr-usage.XXXXXX") || exit 0
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"
mkdir -p "$claude_dir" 2>/dev/null

json=""
if command -v jq >/dev/null 2>&1; then
    json=$(jq -c --argjson t "$(date +%s)" '{captured_at: $t, rate_limits: (.rate_limits // {})}' "$tmp" 2>/dev/null)
elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    py=python3; command -v python3 >/dev/null 2>&1 || py=python
    json=$("$py" -c 'import json,sys,time
d=json.load(open(sys.argv[1]))
print(json.dumps({"captured_at":int(time.time()),"rate_limits":d.get("rate_limits") or {}},separators=(",",":")))' "$tmp" 2>/dev/null)
fi
# Invalid JSON or no parser: an empty object, so the usage bar shows no window
# data instead of going stale.
[ -n "$json" ] || json="{\"captured_at\":$(date +%s),\"rate_limits\":{}}"

# One file per Claude Code session, ~/.claude/herdr-usage/<session_id>.json:
# {"captured_at":<epoch s>,"pane_id":<HERDR_PANE_ID or null>,"session":<raw stdin>}.
# Written before the legacy file: the GUI rereads the sessions when that file
# changes. Skipped on a bad id, a non-object root, or no parser.
pane="$HERDR_PANE_ID"
case "$pane" in
    ''|*[!A-Za-z0-9:_-]*) pane="" ;;
esac
[ "${#pane}" -le 128 ] || pane=""
sid=""; sjson=""
if command -v jq >/dev/null 2>&1; then
    sid=$(jq -j '.session_id // empty' "$tmp" 2>/dev/null)
    [ -n "$sid" ] && sjson=$(jq -c --argjson t "$(date +%s)" --arg p "$pane" '{captured_at: $t, pane_id: (if $p == "" then null else $p end), session: .}' "$tmp" 2>/dev/null)
elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    py=python3; command -v python3 >/dev/null 2>&1 || py=python
    tab=$(printf '\t')
    sline=$("$py" -c 'import json,sys,time
d=json.load(open(sys.argv[1],encoding="utf-8"))
sid=d.get("session_id") if isinstance(d,dict) else None
if isinstance(sid,str):
    sys.stdout.write(sid+"\t"+json.dumps({"captured_at":int(time.time()),"pane_id":sys.argv[2] or None,"session":d},separators=(",",":")))' "$tmp" "$pane" 2>/dev/null)
    sid=${sline%%"$tab"*}; sjson=${sline#*"$tab"}
fi
case "$sid" in
    ''|*[!A-Za-z0-9_-]*) sid="" ;;
esac
if [ -n "$sid" ] && [ "${#sid}" -le 128 ] && [ -n "$sjson" ]; then
    sdir="$claude_dir/herdr-usage"
    mkdir -p "$sdir" 2>/dev/null
    printf '%s' "$sjson" > "$sdir/$sid.json.tmp-$$" 2>/dev/null && mv -f "$sdir/$sid.json.tmp-$$" "$sdir/$sid.json" 2>/dev/null
fi

out="$claude_dir/herdr-usage.json"
printf '%s' "$json" > "$out.tmp-$$" 2>/dev/null && mv -f "$out.tmp-$$" "$out" 2>/dev/null

chain="$claude_dir/statusline/herdr-usage.chain.txt"
if [ -f "$chain" ]; then
    line=$(cat "$chain")
    [ -n "$line" ] && sh -c "$line" < "$tmp"
fi
exit 0
