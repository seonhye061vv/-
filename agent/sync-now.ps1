# 확인 주기와 상관없이 지금 바로 동기화하고 최근 기록을 보여 줍니다.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Remove-Item (Join-Path $here 'last-run.txt') -ErrorAction SilentlyContinue
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'sync.ps1')
Write-Host '--- 최근 기록 (sync.log) ---'
Get-Content (Join-Path $here 'sync.log') -Tail 10 -Encoding UTF8 -ErrorAction SilentlyContinue
