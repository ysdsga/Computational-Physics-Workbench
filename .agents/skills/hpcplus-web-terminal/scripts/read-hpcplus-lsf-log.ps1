[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$SchedulerJobRecordId,

  [Parameter(Mandatory = $true)]
  [string]$RelativePath,

  [ValidateRange(1, 200)]
  [int]$Lines = 80,
  [string]$WorkbenchUrl = 'http://127.0.0.1:3001',
  [string]$WindowTitle = 'HPCPlus平台'
)

$ErrorActionPreference = 'Stop'
$baseUrl = $WorkbenchUrl.TrimEnd('/')

function Invoke-WorkbenchApi {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('POST', 'PUT')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body
  )
  $parameters = @{
    Method = $Method
    Uri = "$baseUrl$Path"
    ContentType = 'application/json; charset=utf-8'
    Body = $Body | ConvertTo-Json -Depth 8 -Compress
  }
  Invoke-RestMethod @parameters
}

$escapedJobRecordId = [Uri]::EscapeDataString($SchedulerJobRecordId)
$started = Invoke-WorkbenchApi -Method POST -Path "/api/scheduler-jobs/$escapedJobRecordId/log-reads" -Body @{
  relative_path = $RelativePath
  lines = $Lines
}
$logRead = $started.log_read
if ($null -eq $logRead -or [string]::IsNullOrWhiteSpace([string]$logRead.id)) {
  throw "Workbench opened no bounded log read for '$SchedulerJobRecordId'."
}
if ([string]::IsNullOrWhiteSpace([string]$logRead.bridge_command) -or
    [string]::IsNullOrWhiteSpace([string]$logRead.remote_workdir)) {
  throw "Workbench returned no scoped bridge command for bounded log read '$($logRead.id)'."
}

$bridge = Join-Path $PSScriptRoot 'invoke-hpcplus-web-terminal.ps1'
$bridgeArgs = @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $bridge,
  '-RemoteCommand', [string]$logRead.bridge_command,
  '-ApprovedWorkingDirectory', [string]$logRead.remote_workdir,
  '-WindowTitle', $WindowTitle,
  '-TimeoutSeconds', '30',
  '-StructuredResult'
)

try {
  $bridgeOutput = @(& powershell @bridgeArgs 2>&1)
  $bridgeExitCode = $LASTEXITCODE
  $rawBridgeOutput = ($bridgeOutput | ForEach-Object { [string]$_ }) -join "`n"
  if ($bridgeExitCode -ne 0) {
    $final = Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/log-reads/$([Uri]::EscapeDataString([string]$logRead.id))" -Body @{
      bridge_status = 'failed'
      error_message = "The bridge failed before it could confirm the bounded log read. $rawBridgeOutput"
    }
    $final | ConvertTo-Json -Depth 8
    exit 2
  }

  $bridgeResult = $rawBridgeOutput | ConvertFrom-Json
  $summary = (@($bridgeResult.Output) | ForEach-Object { [string]$_ }) -join "`n"
  $finishBody = @{
    bridge_status = [string]$bridgeResult.Status
    output_summary = $summary
    error_message = [string]$bridgeResult.Error
  }
  if ($null -ne $bridgeResult.RemoteExitCode) { $finishBody.remote_exit_code = [int]$bridgeResult.RemoteExitCode }
  $final = Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/log-reads/$([Uri]::EscapeDataString([string]$logRead.id))" -Body $finishBody
  $final | ConvertTo-Json -Depth 8
  if ($bridgeResult.Status -ne 'completed') { exit 2 }
  exit 0
} catch {
  try {
    Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/log-reads/$([Uri]::EscapeDataString([string]$logRead.id))" -Body @{
      bridge_status = 'unknown'
      error_message = "The log reader failed after reserving the 60-second window. Output is unknown and no retry was attempted. $($_.Exception.Message)"
    } | Out-Null
  } catch {
    [Console]::Error.WriteLine("Could not finalize bounded log read '$($logRead.id)': $($_.Exception.Message)")
  }
  throw
}
