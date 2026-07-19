[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$SchedulerJobRecordId,

  [string]$WorkbenchUrl = 'http://127.0.0.1:3001',
  [string]$WindowTitle = 'HPCPlus平台'
)

$ErrorActionPreference = 'Stop'
$baseUrl = $WorkbenchUrl.TrimEnd('/')
Import-Module (Join-Path $PSScriptRoot 'HpcPlusBridge.Core.psm1') -Force

function Invoke-WorkbenchApi {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PUT')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body
  )
  $parameters = @{
    Method = $Method
    Uri = "$baseUrl$Path"
    ContentType = 'application/json; charset=utf-8'
  }
  if ($null -ne $Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress }
  Invoke-RestMethod @parameters
}

$escapedJobRecordId = [Uri]::EscapeDataString($SchedulerJobRecordId)
$started = Invoke-WorkbenchApi -Method POST -Path "/api/scheduler-jobs/$escapedJobRecordId/polls" -Body @{}
$poll = $started.poll
if ($null -eq $poll -or [string]::IsNullOrWhiteSpace([string]$poll.id)) {
  throw "Workbench opened no scheduler poll for '$SchedulerJobRecordId'."
}
if ([string]::IsNullOrWhiteSpace([string]$poll.remote_workdir)) {
  throw "Workbench returned no approved working directory for scheduler poll '$($poll.id)'."
}

$bridge = Join-Path $PSScriptRoot 'invoke-hpcplus-web-terminal.ps1'
$bridgeArgs = @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $bridge,
  '-RemoteCommand', [string]$poll.command,
  '-ApprovedWorkingDirectory', [string]$poll.remote_workdir,
  '-WindowTitle', $WindowTitle,
  '-TimeoutSeconds', '30',
  '-StructuredResult'
)

try {
  $bridgeOutput = @(& powershell @bridgeArgs 2>&1)
  $bridgeExitCode = $LASTEXITCODE
  $rawBridgeOutput = ($bridgeOutput | ForEach-Object { [string]$_ }) -join "`n"
  if ($bridgeExitCode -ne 0) {
    $final = Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/polls/$([Uri]::EscapeDataString([string]$poll.id))" -Body @{
      bridge_status = 'failed'
      error_message = "The bridge failed before it could confirm the scheduler query. $rawBridgeOutput"
    }
    $final | ConvertTo-Json -Depth 8
    exit 2
  }

  $bridgeResult = $rawBridgeOutput | ConvertFrom-Json
  $summary = (@($bridgeResult.Output) | ForEach-Object { [string]$_ }) -join "`n"
  $bridgeStatus = [string]$bridgeResult.Status
  $schedulerState = $null
  $errorMessage = [string]$bridgeResult.Error
  if ($bridgeStatus -eq 'completed') {
    $parsedState = Get-HpcPlusLsfState -Output $summary
    if ($null -ne $parsedState) {
      $schedulerState = [string]$parsedState
    } else {
      $bridgeStatus = 'unknown'
      $errorMessage = 'The scheduler query returned no recognized LSF state. No automatic retry was attempted.'
    }
  }

  $finishBody = @{
    bridge_status = $bridgeStatus
    raw_summary = $summary
    error_message = $errorMessage
  }
  if ($null -ne $bridgeResult.RemoteExitCode) { $finishBody.remote_exit_code = [int]$bridgeResult.RemoteExitCode }
  if ($null -ne $schedulerState) { $finishBody.scheduler_state = $schedulerState }

  $final = Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/polls/$([Uri]::EscapeDataString([string]$poll.id))" -Body $finishBody
  $final | ConvertTo-Json -Depth 8
  if ($bridgeStatus -ne 'completed' -or $schedulerState -in @('UNKWN', 'EXIT', 'ZOMBI')) { exit 2 }
  exit 0
} catch {
  try {
    Invoke-WorkbenchApi -Method PUT -Path "/api/scheduler-jobs/polls/$([Uri]::EscapeDataString([string]$poll.id))" -Body @{
      bridge_status = 'unknown'
      error_message = "The poll runner failed after reserving the 60-second window. Job state is unknown and no retry was attempted. $($_.Exception.Message)"
    } | Out-Null
  } catch {
    [Console]::Error.WriteLine("Could not finalize scheduler poll '$($poll.id)': $($_.Exception.Message)")
  }
  throw
}
