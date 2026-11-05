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
#
# herdr-usage-tap v2: also writes ~/.claude/herdr-usage/<session_id>.json with a
# whitelist of numbers and the model name (never prompts, cwd or transcript).
# Bump the version above when this script changes; the GUI offers an update.

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

# Per-session facts. Line 1 = session_id (empty unless [A-Za-z0-9_-]{1,128}),
# line 2 = the whitelisted record. Every field is optional.
sess=""
if command -v jq >/dev/null 2>&1; then
    sess=$(jq -r --argjson t "$(date +%s)" 'def g(f): try f catch null;
def s: if type == "string" then .[:60] else null end;
def n: if type == "number" then . else null end;
((.session_id // "") | if type == "string" and test("\\A[A-Za-z0-9_-]{1,128}\\z") then . else "" end),
({captured_at: $t, model: g(.model.display_name | s), cost_usd: g(.cost.total_cost_usd | n),
  lines_added: g(.cost.total_lines_added | n), lines_removed: g(.cost.total_lines_removed | n),
  context_pct: g(.context_window.used_percentage | n)} | tojson)' "$tmp" 2>/dev/null)
elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    py=python3; command -v python3 >/dev/null 2>&1 || py=python
    sess=$("$py" -c 'import json,sys,time,re,math
d=json.load(open(sys.argv[1]))
def g(*k):
    o=d
    for x in k: o=o.get(x) if isinstance(o,dict) else None
    return o
def n(v): return v if isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) else None
def s(v): return v[:60] if isinstance(v,str) else None
sid=g("session_id")
print(sid if isinstance(sid,str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}",sid) else "")
print(json.dumps({"captured_at":int(time.time()),"model":s(g("model","display_name")),"cost_usd":n(g("cost","total_cost_usd")),"lines_added":n(g("cost","total_lines_added")),"lines_removed":n(g("cost","total_lines_removed")),"context_pct":n(g("context_window","used_percentage"))},separators=(",",":")))' "$tmp" 2>/dev/null)
fi
sid=$(printf '%s\n' "$sess" | sed -n 1p)
rec=$(printf '%s\n' "$sess" | sed -n 2p)
case "$sid" in
    ""|*[!A-Za-z0-9_-]*) ;;
    *)
        if [ -n "$rec" ]; then
            sdir="$claude_dir/herdr-usage"
            mkdir -p "$sdir" 2>/dev/null
            printf '%s' "$rec" > "$sdir/$sid.json.tmp-$$" 2>/dev/null && mv -f "$sdir/$sid.json.tmp-$$" "$sdir/$sid.json" 2>/dev/null
        fi
        ;;
esac

out="$claude_dir/herdr-usage.json"
printf '%s' "$json" > "$out.tmp-$$" 2>/dev/null && mv -f "$out.tmp-$$" "$out" 2>/dev/null

chain="$claude_dir/statusline/herdr-usage.chain.txt"
if [ -f "$chain" ]; then
    line=$(cat "$chain")
    [ -n "$line" ] && sh -c "$line" < "$tmp"
fi
exit 0
