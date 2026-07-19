[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$WindowTitle = '',
  [Parameter(Mandatory = $true)]
  [string]$ApprovedWorkingDirectory,
  [int]$TimeoutSeconds = 30,
  [int]$LastLines = 160,
  [switch]$AllowSubmit,
  [switch]$AllowMutating,
  [switch]$DryRun,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WindowTitle)) {
  $WindowTitle = 'HPCPlus' + [char]0x5E73 + [char]0x53F0
}
if (-not $Args -or $Args.Count -eq 0) {
  @'
Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\hpcssh.ps1 -ApprovedWorkingDirectory "/confirmed/project/task/stage" "hostname; whoami; pwd"
  powershell -NoProfile -ExecutionPolicy Bypass -File .\hpcssh.ps1 -ApprovedWorkingDirectory "/confirmed/project/task/stage" bnu001@ln06 "hostname"

This is not SSH. It relays one reviewed command through the open HPCPlus Edge
web terminal. File transfer, portal crawling, and interactive programs are not supported.
'@ | Write-Output
  exit 2
}

$remaining = @($Args)
if ($remaining.Count -gt 1 -and $remaining[0] -match '^[^@\s]+@[^@\s]+$') {
  $remaining = @($remaining | Select-Object -Skip 1)
}
$remoteCommand = ($remaining -join ' ').Trim()
if ($remoteCommand.Length -eq 0) {
  throw 'Remote command is empty.'
}

$bridge = Join-Path $PSScriptRoot 'invoke-hpcplus-web-terminal.ps1'
$bridgeArgs = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $bridge)
if ($DryRun) {
  $bridgeArgs += @('-DryRun', '-DryRunCommand', $remoteCommand)
} else {
  $bridgeArgs += @('-RemoteCommand', $remoteCommand)
}
$bridgeArgs += @(
  '-WindowTitle', $WindowTitle,
  '-ApprovedWorkingDirectory', $ApprovedWorkingDirectory,
  '-TimeoutSeconds', $TimeoutSeconds,
  '-LastLines', $LastLines
)
if ($AllowSubmit) { $bridgeArgs += '-AllowSubmit' }
if ($AllowMutating) { $bridgeArgs += '-AllowMutating' }

& powershell @bridgeArgs
exit $LASTEXITCODE
