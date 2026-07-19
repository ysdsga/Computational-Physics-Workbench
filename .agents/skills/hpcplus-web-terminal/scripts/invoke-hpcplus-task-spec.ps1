[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$TaskSpecId,

  [string]$WorkbenchUrl = 'http://127.0.0.1:3001',
  [string]$WindowTitle = '',
  [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WindowTitle)) {
  $WindowTitle = 'HPCPlus' + [char]0x5E73 + [char]0x53F0
}
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
  if ($null -ne $Body) {
    $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress
  }
  Invoke-RestMethod @parameters
}

function Get-LatestRun($Spec) {
  if ($null -eq $Spec.runs) { return $null }
  @($Spec.runs) | Sort-Object attempt_no | Select-Object -Last 1
}

$spec = Invoke-WorkbenchApi -Method GET -Path "/api/task-specs/$([Uri]::EscapeDataString($TaskSpecId))"
if ($spec.status -ne 'ready') {
  throw "Task Spec '$TaskSpecId' is '$($spec.status)', not 'ready'. Check dependencies and complete any required approval in the workbench first."
}
if ([string]::IsNullOrWhiteSpace([string]$spec.command_hash)) {
  throw "Task Spec '$TaskSpecId' has no checked content hash."
}

$effectiveCommand = New-HpcPlusScopedCommand -Command ([string]$spec.command) -ApprovedWorkingDirectory ([string]$spec.remote_workdir)
$summary = [pscustomobject]@{
  TaskSpecId = $spec.id
  Status = $spec.status
  Risk = $spec.risk_class
  Hash = $spec.command_hash
  RemoteWorkdir = $spec.remote_workdir
  Command = $spec.command
  ExecutionPayload = $spec.execution_payload
  EffectiveCommand = $effectiveCommand
  TimeoutSeconds = $spec.timeout_seconds
}

if ($PrepareOnly) {
  $summary | ConvertTo-Json -Depth 5
  exit 0
}

$startedSpec = Invoke-WorkbenchApi -Method POST -Path "/api/task-specs/$([Uri]::EscapeDataString($TaskSpecId))/runs" -Body @{}
$run = Get-LatestRun $startedSpec
if ($null -eq $run -or [string]::IsNullOrWhiteSpace([string]$run.id)) {
  throw "Workbench started Task Spec '$TaskSpecId' but returned no command-run id."
}

$bridge = Join-Path $PSScriptRoot 'invoke-hpcplus-web-terminal.ps1'
$bridgeArgs = @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $bridge,
  '-RemoteCommand', [string]$spec.command,
  '-ApprovedWorkingDirectory', [string]$spec.remote_workdir,
  '-WindowTitle', $WindowTitle,
  '-TimeoutSeconds', [string]$spec.timeout_seconds,
  '-StructuredResult'
)
if ($spec.risk_class -in @('submit', 'submit+mutating')) { $bridgeArgs += '-AllowSubmit' }
if ($spec.risk_class -in @('mutating', 'submit+mutating')) { $bridgeArgs += '-AllowMutating' }

try {
  $bridgeOutput = @(& powershell @bridgeArgs 2>&1)
  $bridgeExitCode = $LASTEXITCODE
  if ($bridgeExitCode -ne 0) {
    $message = ($bridgeOutput | ForEach-Object { [string]$_ }) -join "`n"
    $finalSpec = Invoke-WorkbenchApi -Method PUT -Path "/api/task-specs/runs/$([Uri]::EscapeDataString([string]$run.id))" -Body @{
      status = 'failed'
      error_message = "The bridge failed before it could confirm command delivery. $message"
    }
    $finalSpec | ConvertTo-Json -Depth 8
    exit 1
  }

  $bridgeResult = (($bridgeOutput | ForEach-Object { [string]$_ }) -join "`n") | ConvertFrom-Json
  $outputSummary = (@($bridgeResult.Output) | ForEach-Object { [string]$_ }) -join "`n"
  $reportedStatus = [string]$bridgeResult.Status
  $reportedError = [string]$bridgeResult.Error
  $schedulerJob = $null
  if ($spec.risk_class -in @('submit', 'submit+mutating') -and $reportedStatus -eq 'completed') {
    $jobId = Get-HpcPlusLsfSubmissionJobId -Output $outputSummary
    if ($null -ne $jobId) {
      $schedulerJob = @{ scheduler = 'lsf'; job_id = [string]$jobId }
    } else {
      $reportedStatus = 'unknown'
      $reportedError = 'The submission command exited successfully, but no LSF job id was found. The job may have been submitted; no automatic resubmission was attempted.'
    }
  }
  $finishBody = @{
    status = $reportedStatus
    output_summary = $outputSummary
    error_message = $reportedError
    evidence = @(@{
      kind = 'terminal-output'
      summary = if (-not $outputSummary) {
        "Remote command returned exit code $($bridgeResult.RemoteExitCode) with no terminal output."
      } elseif ($outputSummary.Length -gt 1000) {
        $outputSummary.Substring(0, 1000)
      } else {
        $outputSummary
      }
      source = 'HPCPlus Edge PWA accessibility tree'
    })
  }
  if ($null -ne $bridgeResult.RemoteExitCode) {
    $finishBody.exit_code = [int]$bridgeResult.RemoteExitCode
  }
  if ($null -ne $schedulerJob) {
    $finishBody.scheduler_job = $schedulerJob
  }
  $finalSpec = Invoke-WorkbenchApi -Method PUT -Path "/api/task-specs/runs/$([Uri]::EscapeDataString([string]$run.id))" -Body $finishBody
  $finalSpec | ConvertTo-Json -Depth 8
  if ($reportedStatus -eq 'failed') { exit 1 }
  if ($reportedStatus -eq 'unknown') { exit 2 }
  exit 0
} catch {
  try {
    Invoke-WorkbenchApi -Method PUT -Path "/api/task-specs/runs/$([Uri]::EscapeDataString([string]$run.id))" -Body @{
      status = 'unknown'
      error_message = "The Task Spec runner failed after opening the audit run. Remote state may be unknown and no retry was attempted. $($_.Exception.Message)"
    } | Out-Null
  } catch {
    [Console]::Error.WriteLine("Could not finalize command run '$($run.id)' after runner failure: $($_.Exception.Message)")
  }
  throw
}
