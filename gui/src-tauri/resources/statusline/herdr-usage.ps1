# herdr-usage.ps1 -- the herdr GUI's self-contained Claude Code statusLine
# tap (Phase 1.6 spec §4.3). Needs no Python. Must run under Windows
# PowerShell 5.1 (Claude Code invokes it with
# `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <path>`).
#
# Reads the statusLine hook's JSON on stdin, writes
# `~/.claude/herdr-usage.json` with the shape
# `{"captured_at":<epoch s>,"rate_limits":{...}}` (the same shape
# `gui/src-tauri/src/usage.rs` already parses), then -- if a previous
# statusLine command was chained -- runs it with the same raw stdin and
# forwards its stdout byte-for-byte, unmodified.
#
# Never throws: the whole body is one try/catch, and the script always
# exits 0 so a broken statusLine can never break Claude Code's UI.
#
# herdr-usage-tap v2: also writes `~/.claude/herdr-usage/<session_id>.json`
# with a whitelist of numbers and the model name (never prompts, cwd or
# transcript). Bump the version above when this script changes; the GUI
# offers an update.

try {
    # Read stdin as raw bytes. Never `$input` or `[Console]::In`: under
    # Windows PowerShell 5.1 both decode using the console code page, which
    # mangles non-ASCII UTF-8 input before we ever see it.
    $stdinStream = [Console]::OpenStandardInput()
    $memoryStream = [IO.MemoryStream]::new()
    $stdinStream.CopyTo($memoryStream)
    $bytes = $memoryStream.ToArray()

    # UTF-8 without a BOM: used to decode the bytes for JSON parsing, and to
    # re-encode our own output. The chain path below never uses this --
    # chained bytes are copied straight through, untouched.
    $utf8NoBom = [Text.UTF8Encoding]::new($false)
    $inputText = $utf8NoBom.GetString($bytes)

    $rateLimits = @{}
    $sessionId = ""
    $sessionRecord = $null
    try {
        $parsed = $inputText | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $parsed.rate_limits) {
            $rateLimits = $parsed.rate_limits
        }
        # Whitelisted per-session facts; every field is optional.
        function Get-Num($v) {
            if (($v -is [double] -or $v -is [int] -or $v -is [long] -or $v -is [decimal]) -and
                -not ([double]::IsNaN([double]$v) -or [double]::IsInfinity([double]$v))) { return $v }
            return $null
        }
        $sid = $parsed.session_id
        if ($sid -is [string] -and $sid -cmatch '\A[A-Za-z0-9_-]{1,128}\z') { $sessionId = $sid }
        $modelName = $null
        if ($parsed.model -and $parsed.model.display_name -is [string]) {
            $modelName = $parsed.model.display_name
            if ($modelName.Length -gt 60) { $modelName = $modelName.Substring(0, 60) }
        }
        $sessionRecord = [ordered]@{
            captured_at   = [long][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            model         = $modelName
            cost_usd      = Get-Num $parsed.cost.total_cost_usd
            lines_added   = Get-Num $parsed.cost.total_lines_added
            lines_removed = Get-Num $parsed.cost.total_lines_removed
            context_pct   = Get-Num $parsed.context_window.used_percentage
        }
    } catch {
        # Not valid JSON, or no rate_limits field: fall back to an empty
        # object rather than aborting -- the usage bar then just shows no
        # window data instead of going stale.
    }

    $capturedAt = [long][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $outputObject = [ordered]@{
        captured_at = $capturedAt
        rate_limits = $rateLimits
    }
    $json = $outputObject | ConvertTo-Json -Depth 10 -Compress

    $homeDir = $env:USERPROFILE
    if ([string]::IsNullOrEmpty($homeDir)) { $homeDir = $env:HOME }
    $claudeDir = Join-Path $homeDir ".claude"
    if (-not (Test-Path -LiteralPath $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }
    # Per-session file first, so the GUI sees it when it reacts to the main file.
    if ($sessionId -and $null -ne $sessionRecord) { try {
        $sessionDir = Join-Path $claudeDir "herdr-usage"
        if (-not (Test-Path -LiteralPath $sessionDir)) {
            New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
        }
        $sessionPath = Join-Path $sessionDir "$sessionId.json"
        $sessionTmp = "$sessionPath.tmp-$PID"
        [IO.File]::WriteAllBytes($sessionTmp, $utf8NoBom.GetBytes(($sessionRecord | ConvertTo-Json -Compress)))
        if (Test-Path -LiteralPath $sessionPath) {
            [IO.File]::Replace($sessionTmp, $sessionPath, $null)
        } else {
            [IO.File]::Move($sessionTmp, $sessionPath)
        }
    } catch { } }  # a failed session write must never block the main usage file
    $outPath = Join-Path $claudeDir "herdr-usage.json"
    $tmpPath = "$outPath.tmp-$PID"

    [IO.File]::WriteAllBytes($tmpPath, $utf8NoBom.GetBytes($json))
    if (Test-Path -LiteralPath $outPath) {
        [IO.File]::Replace($tmpPath, $outPath, $null)
    } else {
        [IO.File]::Move($tmpPath, $outPath)
    }

    # Chain: if a previous statusLine command was displaced when herdr's tap
    # was installed, its single line is saved here. Run it with the exact
    # same raw stdin bytes, and copy its raw stdout bytes back out --
    # nothing here is decoded or re-encoded, so this leg is byte-exact
    # regardless of what the chained tool prints.
    $chainPath = Join-Path $claudeDir "statusline\herdr-usage.chain.txt"
    if (Test-Path -LiteralPath $chainPath) {
        $chainLine = (Get-Content -LiteralPath $chainPath -Raw)
        if ($null -ne $chainLine) { $chainLine = $chainLine.Trim() }
        if ($chainLine) {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "$env:SystemRoot\System32\cmd.exe"
            $psi.Arguments = "/d /s /c `"$chainLine`""
            $psi.RedirectStandardInput = $true
            $psi.RedirectStandardOutput = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true

            $chainProcess = [System.Diagnostics.Process]::Start($psi)
            $chainProcess.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
            $chainProcess.StandardInput.BaseStream.Close()
            $chainProcess.StandardOutput.BaseStream.CopyTo([Console]::OpenStandardOutput())
            $chainProcess.WaitForExit()
        }
    }
} catch {
    # Never throw: a broken tap must not break the user's statusLine.
}

exit 0
