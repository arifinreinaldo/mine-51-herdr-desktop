# test-statusline.ps1 -- Pester-free test for herdr-usage.ps1 (Phase 1.6
# spec §9). Run via `npm run test:ps`, not part of `npm run check`.
#
# Every case runs the tap script with `USERPROFILE`/`HOME` pointed at a
# fresh temp directory (a temp HOME): it never touches the real
# `~/.claude`.

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $PSCommandPath
$guiRoot = Split-Path -Parent $here
$tapScript = Join-Path $guiRoot "src-tauri\resources\statusline\herdr-usage.ps1"
if (-not (Test-Path -LiteralPath $tapScript)) {
    throw "tap script not found at $tapScript"
}

$script:failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if ($Condition) {
        Write-Host "  ok - $Message" -ForegroundColor Green
    } else {
        Write-Host "  FAIL - $Message" -ForegroundColor Red
        $script:failures++
    }
}

function New-TempHome {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ("herdr-gui-test-ps-home-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path (Join-Path $dir ".claude") | Out-Null
    return $dir
}

# Runs the tap script with `InputBytes` on stdin and `HomeDir` as its temp
# HOME, returning its exit code and raw stdout/stderr bytes/text.
function Invoke-Tap {
    param(
        [Parameter(Mandatory)] [string]$HomeDir,
        [Parameter(Mandatory)] [byte[]]$InputBytes
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$tapScript`""
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["USERPROFILE"] = $HomeDir
    $psi.EnvironmentVariables["HOME"] = $HomeDir

    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.StandardInput.BaseStream.Write($InputBytes, 0, $InputBytes.Length)
    $proc.StandardInput.BaseStream.Close()
    $stdoutMs = New-Object IO.MemoryStream
    $proc.StandardOutput.BaseStream.CopyTo($stdoutMs)
    $stderrText = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    return [PSCustomObject]@{
        ExitCode    = $proc.ExitCode
        StdoutBytes = $stdoutMs.ToArray()
        Stderr      = $stderrText
    }
}

$utf8NoBom = [Text.UTF8Encoding]::new($false)

# ---------------------------------------------------------------------
# 1. Basic install: sample JSON in, herdr-usage.json out, no chain file.
# ---------------------------------------------------------------------
Write-Host "test 1: writes herdr-usage.json from the statusLine hook's JSON"
$home1 = New-TempHome
try {
    $sampleJson = '{"session_id":"abc","rate_limits":{"five_hour":{"used_percentage":14,"resets_at":1790395200},"seven_day":{"used_percentage":1,"resets_at":1790985600}}}'
    $result = Invoke-Tap -HomeDir $home1 -InputBytes ($utf8NoBom.GetBytes($sampleJson))
    Assert-True ($result.ExitCode -eq 0) "exits 0 (stderr: $($result.Stderr))"
    Assert-True ($result.StdoutBytes.Length -eq 0) "prints nothing to stdout with no chain file"

    $outPath = Join-Path $home1 ".claude\herdr-usage.json"
    Assert-True (Test-Path -LiteralPath $outPath) "writes ~/.claude/herdr-usage.json"

    $written = Get-Content -Raw -LiteralPath $outPath | ConvertFrom-Json
    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Assert-True ([Math]::Abs([int64]$written.captured_at - $nowEpoch) -lt 30) "captured_at is a fresh epoch-seconds timestamp"
    Assert-True ($written.rate_limits.five_hour.used_percentage -eq 14) "five_hour.used_percentage round-trips"
    Assert-True ($written.rate_limits.five_hour.resets_at -eq 1790395200) "five_hour.resets_at round-trips"
    Assert-True ($written.rate_limits.seven_day.used_percentage -eq 1) "seven_day.used_percentage round-trips"
} finally {
    Remove-Item -Recurse -Force $home1 -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------
# 2. No rate_limits field at all / garbage stdin: never throws, still
#    writes a file with an empty rate_limits object.
# ---------------------------------------------------------------------
Write-Host "test 2: garbage stdin never throws, still writes a file"
$home2 = New-TempHome
try {
    $result = Invoke-Tap -HomeDir $home2 -InputBytes ($utf8NoBom.GetBytes("not json at all {{{"))
    Assert-True ($result.ExitCode -eq 0) "exits 0 even on unparseable stdin"
    $outPath = Join-Path $home2 ".claude\herdr-usage.json"
    Assert-True (Test-Path -LiteralPath $outPath) "still writes a file"
    $written = Get-Content -Raw -LiteralPath $outPath | ConvertFrom-Json
    Assert-True ($null -ne $written.captured_at) "captured_at is still set"
} finally {
    Remove-Item -Recurse -Force $home2 -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------
# 3. Chain mode with a chain file containing `more`, and a byte-exact
#    UTF-8 round trip of a non-ASCII payload: `more` (measured directly
#    against cmd.exe on this machine) never alters the bytes it's given --
#    it only ever appends one trailing CRLF -- so the chained bytes plus
#    that one deterministic CRLF is the exact expected output.
# ---------------------------------------------------------------------
Write-Host "test 3: chain mode ('more') round-trips a non-ASCII payload byte-exactly"
$home3 = New-TempHome
try {
    $statuslineDir = Join-Path $home3 ".claude\statusline"
    New-Item -ItemType Directory -Force -Path $statuslineDir | Out-Null
    [IO.File]::WriteAllText((Join-Path $statuslineDir "herdr-usage.chain.txt"), "more", $utf8NoBom)

    $eAcute = [char]0x00E9
    $chineseChars = [string]([char]0x4E2D) + [string]([char]0x6587)
    $nonAsciiPayload = 'caf' + $eAcute + ' ' + $chineseChars + ' {"rate_limits":{}}'
    $inputBytes = $utf8NoBom.GetBytes($nonAsciiPayload)

    $result = Invoke-Tap -HomeDir $home3 -InputBytes $inputBytes
    Assert-True ($result.ExitCode -eq 0) "exits 0 in chain mode (stderr: $($result.Stderr))"

    $expected = New-Object byte[] ($inputBytes.Length + 2)
    [Array]::Copy($inputBytes, $expected, $inputBytes.Length)
    $expected[$inputBytes.Length] = 0x0D
    $expected[$inputBytes.Length + 1] = 0x0A
    $actualHex = [BitConverter]::ToString($result.StdoutBytes)
    $expectedHex = [BitConverter]::ToString($expected)
    Assert-True ($actualHex -eq $expectedHex) "stdout is the exact input bytes plus more's own trailing CRLF"

    # The tap still wrote its own output file in chain mode too.
    Assert-True (Test-Path -LiteralPath (Join-Path $home3 ".claude\herdr-usage.json")) "still writes herdr-usage.json while chaining"
} finally {
    Remove-Item -Recurse -Force $home3 -ErrorAction SilentlyContinue
}

Write-Host ""
if ($script:failures -gt 0) {
    Write-Host "$($script:failures) assertion(s) failed." -ForegroundColor Red
    exit 1
}
Write-Host "All statusline tap assertions passed." -ForegroundColor Green
exit 0
