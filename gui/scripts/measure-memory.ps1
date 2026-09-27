# measure-memory.ps1 -- herdr GUI memory footprint (Phase 1.6 spec §6.4).
#
# Sums private bytes and working set of herdr-gui.exe plus its
# msedgewebview2.exe descendants. Walks the process tree with
# `Get-CimInstance Win32_Process` (ParentProcessId, PrivatePageCount)
# because `Get-Process` has no parent PID. Reports the herdr **server**
# separately, outside the GUI's own budget.
#
# Run this against the *installed release* GUI (not `cargo run`, not a dev
# build): start herdr-gui.exe first, then run this script and follow its
# prompts.

[CmdletBinding()]
param(
    [int]$IdleWaitSeconds = 10,
    [int]$MinimizedWaitSeconds = 30,
    [int]$OutputBurstRepeats = 3,
    [string]$GuiProcessName = "herdr-gui.exe",
    [string]$ServerProcessName = "herdr.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Provisional budgets (spec §6.4): report the actual values regardless; a
# miss is a finding, not a failure to hide.
$IdlePrivateBudgetMB = 260
$MinimizedPrivateBudgetMB = 120
$OutputBurstGrowthBudgetPct = 10

function Get-ProcessTreeIds {
    param(
        [string]$RootName,
        [object[]]$AllProcesses
    )
    $ids = @{}
    foreach ($p in $AllProcesses) {
        if ($p.Name -ieq $RootName) { $ids[[int64]$p.ProcessId] = $true }
    }
    # BFS over ParentProcessId to catch descendants (e.g. msedgewebview2.exe
    # helper processes spawned by the GUI's own WebView2 host).
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $AllProcesses) {
            $pid_ = [int64]$p.ProcessId
            $ppid = [int64]$p.ParentProcessId
            if ($ids.ContainsKey($ppid) -and -not $ids.ContainsKey($pid_)) {
                $ids[$pid_] = $true
                $changed = $true
            }
        }
    }
    return $ids.Keys
}

function Get-MemorySampleMB {
    param(
        [string]$RootName,
        [object[]]$AllProcesses
    )
    $ids = Get-ProcessTreeIds -RootName $RootName -AllProcesses $AllProcesses
    $privateBytes = 0L
    $workingSetBytes = 0L
    $count = 0
    foreach ($id in $ids) {
        $count++
        $wmiProc = $AllProcesses | Where-Object { [int64]$_.ProcessId -eq $id } | Select-Object -First 1
        if ($wmiProc -and $wmiProc.PrivatePageCount) {
            $privateBytes += [int64]$wmiProc.PrivatePageCount
        }
        $gp = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($gp) { $workingSetBytes += $gp.WorkingSet64 }
    }
    [PSCustomObject]@{
        ProcessCount    = $count
        PrivateMB       = [math]::Round($privateBytes / 1MB, 1)
        WorkingSetMB    = [math]::Round($workingSetBytes / 1MB, 1)
    }
}

function Get-Sample {
    param([string]$Label)
    $all = Get-CimInstance Win32_Process
    $gui = Get-MemorySampleMB -RootName $GuiProcessName -AllProcesses $all
    # WebView2's own host process tree (msedgewebview2.exe) is parented
    # under the GUI process, so it's already included in $gui via the BFS
    # above -- this second call is only to surface it as its own column.
    $webview = Get-MemorySampleMB -RootName "msedgewebview2.exe" -AllProcesses $all
    $server = Get-MemorySampleMB -RootName $ServerProcessName -AllProcesses $all
    [PSCustomObject]@{
        Sample           = $Label
        "GUI procs"      = $gui.ProcessCount
        "GUI PrivateMB"  = $gui.PrivateMB
        "GUI WSMB"       = $gui.WorkingSetMB
        "WebView2 procs" = $webview.ProcessCount
        "Server PrivateMB (outside budget)" = $server.PrivateMB
    }
}

if (-not (Get-Process -Name ($GuiProcessName -replace '\.exe$', '') -ErrorAction SilentlyContinue)) {
    Write-Warning "$GuiProcessName is not running. Install and launch the release build first, then re-run this script."
    exit 1
}

$results = [System.Collections.Generic.List[object]]::new()

Write-Host "==> Waiting $IdleWaitSeconds s for an idle baseline..."
Start-Sleep -Seconds $IdleWaitSeconds
$results.Add((Get-Sample -Label "idle"))

for ($i = 1; $i -le $OutputBurstRepeats; $i++) {
    Write-Host ""
    Write-Host "==> In a herdr pane, run:"
    Write-Host "    Get-ChildItem -Recurse C:\Windows\System32 | Select-Object -First 3000"
    Write-Host "    Press Enter here once it has finished (repeat $i of $OutputBurstRepeats)..."
    [void][System.Console]::ReadLine()
    $results.Add((Get-Sample -Label "after-output-burst-$i"))
}

Write-Host ""
Write-Host "==> Minimize the herdr GUI window now."
Write-Host "    Waiting $MinimizedWaitSeconds s..."
Start-Sleep -Seconds $MinimizedWaitSeconds
$results.Add((Get-Sample -Label "minimized-${MinimizedWaitSeconds}s"))

Write-Host ""
$results | Format-Table -AutoSize

$idle = $results | Where-Object { $_.Sample -eq "idle" } | Select-Object -First 1
if ($idle."GUI PrivateMB" -gt $IdlePrivateBudgetMB) {
    Write-Warning "idle private $($idle.'GUI PrivateMB') MB exceeds the ${IdlePrivateBudgetMB} MB budget (finding, not a failure to hide)"
} else {
    Write-Host "idle private $($idle.'GUI PrivateMB') MB is within the ${IdlePrivateBudgetMB} MB budget."
}

$minimized = $results | Where-Object { $_.Sample -like "minimized-*" } | Select-Object -First 1
if ($minimized."GUI PrivateMB" -gt $MinimizedPrivateBudgetMB) {
    Write-Warning "minimized private $($minimized.'GUI PrivateMB') MB exceeds the ${MinimizedPrivateBudgetMB} MB budget"
} else {
    Write-Host "minimized private $($minimized.'GUI PrivateMB') MB is within the ${MinimizedPrivateBudgetMB} MB budget."
}

$bursts = $results | Where-Object { $_.Sample -like "after-output-burst-*" }
if ($bursts.Count -ge 2) {
    $first = $bursts[0]."GUI PrivateMB"
    $last = $bursts[$bursts.Count - 1]."GUI PrivateMB"
    if ($first -gt 0) {
        $growthPct = (($last - $first) / $first) * 100
        if ($growthPct -gt $OutputBurstGrowthBudgetPct) {
            Write-Warning "private memory grew $([math]::Round($growthPct, 1))% across $($bursts.Count) output-burst repeats (budget: <= ${OutputBurstGrowthBudgetPct}%)"
        } else {
            Write-Host "private memory grew $([math]::Round($growthPct, 1))% across $($bursts.Count) output-burst repeats (within budget)."
        }
    }
}
