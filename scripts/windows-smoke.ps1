param([string]$Executable = "target/release/orbit.exe")
$ErrorActionPreference = "Stop"
$exe = (Resolve-Path $Executable).Path
$root = Join-Path $PWD ".runtime-smoke"
if (Test-Path $root) { Remove-Item $root -Recurse -Force }
node scripts/seed-smoke.mjs $root $exe
if ($LASTEXITCODE -ne 0) { throw "Smoke fixture generation failed" }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class OrbitHotkeyFixture {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
'@
function Run-Orbit([string]$report) {
  $process = Start-Process -FilePath $exe -ArgumentList @("--smoke-test", "`"$root`"") -PassThru
  if (-not $process.WaitForExit(180000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Orbit runtime smoke timed out. Inspect .runtime-smoke/runtime.json and logs."
  }
  $path = Join-Path $root $report
  if (-not (Test-Path $path)) { throw "Orbit did not write $report. Exit code: $($process.ExitCode)" }
  $result = Get-Content $path -Raw | ConvertFrom-Json
  Get-Content $path -Raw | Write-Output
  if ($process.ExitCode -ne 0 -or -not $result.ok) { throw "Orbit runtime smoke failed: $($result.error)" }
}
$held = [OrbitHotkeyFixture]::RegisterHotKey([IntPtr]::Zero, 8201, 1, 32)
if (-not $held) { throw "Could not establish Alt+Space conflict fixture" }
try {
  Run-Orbit "smoke-result.json"
  $status = (Get-Content (Join-Path $root "runtime.json") -Raw | ConvertFrom-Json).status
  if (-not $status.shortcutError -or $status.registeredShortcut -ne "Alt+Shift+Space") { throw "Shortcut conflict was not reported with usable fallback" }
} finally {
  [void][OrbitHotkeyFixture]::UnregisterHotKey([IntPtr]::Zero, 8201)
}
Run-Orbit "smoke-restart.json"
Set-Content (Join-Path $root "config.json") "{broken" -NoNewline
Run-Orbit "smoke-recovery.json"
Write-Output "Windows runtime smoke passed: conflict/fallback, WebView2, native shortcut/Escape, monitor, editor, execution, restart, corruption."
