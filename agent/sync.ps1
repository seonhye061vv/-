# 채용현황판 PC 자동 동기화
# 지정한 폴더의 엑셀을 확인 주기마다 현황판 서버로 보냅니다. 작업 스케줄러가 5분마다 실행합니다.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg    = Get-Content (Join-Path $here 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$logF   = Join-Path $here 'sync.log'
$stateF = Join-Path $here 'last-run.txt'

function Write-Log($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $logF -Value $line -Encoding UTF8
  $lines = Get-Content $logF -Encoding UTF8
  if ($lines.Count -gt 500) { $lines | Select-Object -Last 500 | Set-Content $logF -Encoding UTF8 }
}

try {
  # 동기화 키는 이 PC의 이 사용자만 풀 수 있게 암호화되어 있습니다.
  $secure = $cfg.key | ConvertTo-SecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $server = $cfg.server.TrimEnd('/')
  $headers = @{ 'X-Sync-Key' = $key }

  # 관리자 화면에서 정한 확인 주기를 따릅니다.
  $interval = 5
  try { $interval = [int](Invoke-RestMethod -Uri "$server/api/upload" -Headers $headers -Method Get -TimeoutSec 30).intervalM } catch { }
  if (Test-Path $stateF) {
    $last = [datetime]::Parse((Get-Content $stateF -Raw).Trim())
    if (((Get-Date) - $last).TotalMinutes -lt ($interval - 0.5)) { exit 0 }
  }

  # 가장 최근에 저장한 엑셀 하나 (열려 있을 때 생기는 ~$ 임시 파일 제외)
  $file = Get-ChildItem -Path $cfg.folder -Filter *.xlsx -File |
          Where-Object { $_.Name -notlike '~$*' } |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { Write-Log "폴더에 엑셀 파일이 없습니다: $($cfg.folder)"; exit 0 }

  # 저장이 막 끝난 파일은 다음 주기에 보냅니다.
  if (((Get-Date) - $file.LastWriteTime).TotalSeconds -lt 15) { Write-Log "저장 중인 것 같아 다음 주기에 다시 확인합니다: $($file.Name)"; exit 0 }

  try {
    $fs = [IO.File]::Open($file.FullName, 'Open', 'Read', 'ReadWrite')
    try { $bytes = New-Object byte[] $fs.Length; [void]$fs.Read($bytes, 0, $bytes.Length) } finally { $fs.Close() }
  } catch { Write-Log "파일을 읽을 수 없어 다음 주기에 다시 시도합니다: $($file.Name)"; exit 0 }

  $headers['X-File-Name']     = [Uri]::EscapeDataString($file.Name)
  $headers['X-File-Modified'] = $file.LastWriteTimeUtc.ToString('o')
  $r = Invoke-RestMethod -Uri "$server/api/upload" -Method Post -Headers $headers -Body $bytes -ContentType 'application/octet-stream' -TimeoutSec 60
  (Get-Date).ToString('o') | Set-Content $stateF
  if ($r.status -ne 'unchanged') { Write-Log "[$($r.status)] $($file.Name): $($r.message)" }
  if ($r.status -eq 'invalid' -and $r.errors) {
    foreach ($e in $r.errors) { Write-Log ("    {0} {1} '{2}': {3}" -f $e.sheet, $e.cell, $e.val, $e.msg) }
  }
} catch {
  Write-Log "오류: $($_.Exception.Message)"
  exit 1
}
