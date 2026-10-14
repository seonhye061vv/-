# 채용현황판 PC 자동 동기화 제거
Unregister-ScheduledTask -TaskName 'RecruitBoardSync' -Confirm:$false -ErrorAction SilentlyContinue
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Remove-Item (Join-Path $here 'config.json'), (Join-Path $here 'last-run.txt') -ErrorAction SilentlyContinue
Write-Host '자동 동기화를 제거했습니다.'
