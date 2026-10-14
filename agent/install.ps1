# 채용현황판 PC 자동 동기화 설치
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Windows.Forms

Write-Host ''
Write-Host '=== 채용현황판 PC 자동 동기화 설치 ===' -ForegroundColor Green
Write-Host ''
Write-Host '1) 채용현황 엑셀을 저장하는 폴더를 고르세요.'
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '채용현황 엑셀을 저장하는 폴더'
if ($dlg.ShowDialog() -ne 'OK') { Write-Host '취소했습니다.'; exit 1 }
$folder = $dlg.SelectedPath
Write-Host "   폴더: $folder"

$server = Read-Host '2) 현황판 주소 (예: https://recruit-board.vercel.app)'
$server = $server.Trim().TrimEnd('/')
if ($server -notmatch '^https://') { Write-Host '주소는 https:// 로 시작해야 합니다.' -ForegroundColor Red; exit 1 }
$keySecure = Read-Host '3) 동기화 키 (Vercel에 넣은 SYNC_KEY 값)' -AsSecureString

# 연결 확인
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure))
try { $null = Invoke-RestMethod -Uri "$server/api/upload" -Headers @{ 'X-Sync-Key' = $plain } -Method Get -TimeoutSec 30 }
catch { Write-Host "서버 연결 또는 동기화 키 확인에 실패했습니다: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }
Write-Host '   서버 연결 확인됨' -ForegroundColor Green

# 키는 이 PC의 현재 사용자만 풀 수 있게 암호화해 저장
@{ folder = $folder; server = $server; key = ($keySecure | ConvertFrom-SecureString) } |
  ConvertTo-Json | Set-Content (Join-Path $here 'config.json') -Encoding UTF8

# 작업 스케줄러: 로그인 시 + 5분마다, 창 없이 실행
$vbs = Join-Path $here 'run-hidden.vbs'
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$every5  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'RecruitBoardSync' -Description '채용현황판 엑셀 자동 동기화' -Action $action -Trigger @($every5, $atLogon) -Settings $set -Force | Out-Null

Write-Host ''
Write-Host '설치를 마쳤습니다. 지금 한 번 동기화합니다...' -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'sync.ps1')
Write-Host "결과는 $here\sync.log 에서 볼 수 있습니다."
