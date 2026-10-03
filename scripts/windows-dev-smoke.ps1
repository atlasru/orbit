$ErrorActionPreference = "Stop"
$root = Join-Path $PWD ".runtime-dev-smoke"
if (Test-Path $root) { Remove-Item $root -Recurse -Force }
node scripts/seed-smoke.mjs $root (Join-Path $PWD "target/debug/orbit.exe")
if ($LASTEXITCODE -ne 0) { throw "Dev smoke fixture generation failed" }
Set-Content (Join-Path $root "expect-dev") "dev" -NoNewline
$out = Join-Path $root "tauri.stdout.log"
$err = Join-Path $root "tauri.stderr.log"
$process = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "tauri", "dev", "--", "--no-watch", "--", "--", "--smoke-test", "`"$root`"") -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
if (-not $process.WaitForExit(180000)) {
  taskkill /PID $process.Id /T /F | Out-Null
  throw "npm run tauri dev did not finish the desktop runtime smoke within 180 seconds. Inspect .runtime-dev-smoke."
}
Get-Content $out -ErrorAction SilentlyContinue | Write-Output
Get-Content $err -ErrorAction SilentlyContinue | Write-Output
$report = Join-Path $root "smoke-result.json"
if (-not (Test-Path $report)) { throw "Dev process produced no runtime report. Exit code: $($process.ExitCode)" }
$result = Get-Content $report -Raw | ConvertFrom-Json
Get-Content $report -Raw | Write-Output
if ($process.ExitCode -ne 0 -or -not $result.ok) { throw "Development desktop runtime smoke failed: $($result.error)" }
Write-Output "npm run tauri dev started Vite on port 1420 and the native desktop application."
