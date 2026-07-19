[CmdletBinding(DefaultParameterSetName = 'Execute')]
param(
  [Parameter(Mandatory = $true, Position = 0, ParameterSetName = 'Execute')]
  [string]$RemoteCommand,

  [Parameter(Mandatory = $true, Position = 0, ParameterSetName = 'DryRun')]
  [string]$DryRunCommand,

  [Parameter(Mandatory = $true, ParameterSetName = 'Inspect')]
  [switch]$InspectOnly,

  [Parameter(Mandatory = $true, ParameterSetName = 'DryRun')]
  [switch]$DryRun,

  [string]$WindowTitle = '',
  [Parameter(Mandatory = $true, ParameterSetName = 'Execute')]
  [Parameter(Mandatory = $true, ParameterSetName = 'DryRun')]
  [string]$ApprovedWorkingDirectory,
  [int]$TimeoutSeconds = 30,
  [ValidateRange(250, 5000)]
  [int]$PollMilliseconds = 750,
  [ValidateRange(20, 1000)]
  [int]$LastLines = 160,
  [ValidateRange(1024, 262144)]
  [int]$MaxOutputCharacters = 65536,
  [switch]$AllowSubmit,
  [switch]$AllowMutating,
  [switch]$StructuredResult
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WindowTitle)) {
  # Keep the source ASCII-safe for Windows PowerShell 5.1, which otherwise
  # decodes UTF-8-without-BOM string literals through the active code page.
  $WindowTitle = 'HPCPlus' + [char]0x5E73 + [char]0x53F0
}
$modulePath = Join-Path $PSScriptRoot 'HpcPlusBridge.Core.psm1'
Import-Module $modulePath -Force

$commandToCheck = if ($PSCmdlet.ParameterSetName -eq 'DryRun') { $DryRunCommand } else { $RemoteCommand }
if ($PSCmdlet.ParameterSetName -ne 'Inspect') {
  $risk = Assert-HpcPlusCommandPolicy -Command $commandToCheck -AllowSubmit:$AllowSubmit -AllowMutating:$AllowMutating
  $scopedCommand = if ([string]::IsNullOrWhiteSpace($ApprovedWorkingDirectory)) {
    $commandToCheck
  } else {
    New-HpcPlusScopedCommand -Command $commandToCheck -ApprovedWorkingDirectory $ApprovedWorkingDirectory
  }
  $envelope = New-HpcPlusCommandEnvelope -Command $scopedCommand
}

if ($PSCmdlet.ParameterSetName -eq 'DryRun') {
  [pscustomobject]@{
    Risk = $risk.Category
    RequiresSubmitApproval = $risk.RequiresSubmitApproval
    RequiresMutationApproval = $risk.RequiresMutationApproval
    ApprovedWorkingDirectory = $ApprovedWorkingDirectory
    EnvelopeId = $envelope.Id
    WrappedLength = $envelope.WrappedCommand.Length
  } | ConvertTo-Json
  exit 0
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$nativeCode = @'
using System;
using System.Runtime.InteropServices;
public static class HpcPlusBridgeNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
'@
Add-Type -TypeDefinition $nativeCode -ErrorAction SilentlyContinue

function Get-TerminalLines {
  param([System.Windows.Automation.AutomationElement]$Terminal)

  $textCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $textElements = $Terminal.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
  $lines = New-Object System.Collections.Generic.List[string]
  for ($index = 0; $index -lt $textElements.Count; $index++) {
    $name = $textElements.Item($index).Current.Name
    if ($null -ne $name -and $name.Trim().Length -gt 0) {
      foreach ($logicalLine in ($name -split "`r?`n")) {
        if ($logicalLine.Trim().Length -gt 0) {
          $lines.Add($logicalLine)
        }
      }
    }
  }
  @($lines)
}

function Get-WindowTextLines {
  param([System.Windows.Automation.AutomationElement]$Window)

  $textCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $textElements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
  $lines = New-Object System.Collections.Generic.List[string]
  if ($Window.Current.Name) { $lines.Add([string]$Window.Current.Name) }
  for ($index = 0; $index -lt $textElements.Count; $index++) {
    $name = $textElements.Item($index).Current.Name
    if ($null -ne $name -and $name.Trim().Length -gt 0) {
      foreach ($logicalLine in ($name -split "`r?`n")) {
        if ($logicalLine.Trim().Length -gt 0) { $lines.Add($logicalLine) }
      }
    }
  }
  @($lines)
}

function Write-UnknownBridgeResult {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Output,
    [int]$ExitCode = 125
  )

  $boundedOutput = @(Select-HpcPlusBoundedLines -Lines $Output -MaxLines $LastLines -MaxCharacters $MaxOutputCharacters)
  if ($StructuredResult) {
    [pscustomobject]@{
      Status = 'unknown'
      RemoteExitCode = $null
      Output = $boundedOutput
      Error = $Message
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
  }
  $boundedOutput
  [Console]::Error.WriteLine($Message)
  exit $ExitCode
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\DFTDMFT-HPCPlus-WebTerminal')
$lockTaken = $false
$commandSent = $false
$latestLines = @()
try {
  $lockTaken = $mutex.WaitOne(0)
  if (-not $lockTaken) {
    throw 'Another HPCPlus web-terminal command is already in progress.'
  }

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  $matches = New-Object System.Collections.Generic.List[System.Windows.Automation.AutomationElement]
  $relatedNames = New-Object System.Collections.Generic.List[string]
  for ($index = 0; $index -lt $windows.Count; $index++) {
    $candidate = $windows.Item($index)
    if ($candidate.Current.Name -eq $WindowTitle) {
      $matches.Add($candidate)
    } elseif ($candidate.Current.Name -like '*HPCPlus*') {
      $relatedNames.Add($candidate.Current.Name)
    }
  }
  if ($matches.Count -ne 1) {
    $detail = if ($relatedNames.Count) { " Related windows: $($relatedNames -join '; ')" } else { '' }
    throw "Expected exactly one window titled '$WindowTitle', found $($matches.Count).$detail"
  }
  $window = $matches[0]

  $groupCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Group
  )
  $groups = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $groupCondition)
  $terminal = $null
  $largestArea = 0
  for ($index = 0; $index -lt $groups.Count; $index++) {
    $candidate = $groups.Item($index)
    $rect = $candidate.Current.BoundingRectangle
    $area = $rect.Width * $rect.Height
    if ($candidate.Current.ClassName -eq 'terminal' -and $area -gt $largestArea -and -not $candidate.Current.IsOffscreen) {
      $terminal = $candidate
      $largestArea = $area
    }
  }
  if ($null -eq $terminal -or $largestArea -le 0) {
    throw "Visible HPCPlus terminal region (ClassName=terminal) was not found in '$WindowTitle'."
  }

  $baselineWindowLines = @(Get-WindowTextLines -Window $window)
  $existingFailure = Get-HpcPlusTerminalSessionFailure -Lines $baselineWindowLines
  if ($existingFailure.Detected) {
    throw "HPCPlus is not ready before command submission: $($existingFailure.Message)"
  }

  if ($PSCmdlet.ParameterSetName -eq 'Inspect') {
    Get-TerminalLines -Terminal $terminal | Select-Object -Last $LastLines
    exit 0
  }

  $editCondition = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )),
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      'dummy'
    ))
  )
  $inputs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
  if ($inputs.Count -ne 1) {
    throw "Expected exactly one xterm input (AutomationId=dummy), found $($inputs.Count)."
  }

  $handle = [IntPtr]$window.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) {
    throw 'HPCPlus window has no native window handle.'
  }

  [void][HpcPlusBridgeNative]::ShowWindow($handle, 9)
  Start-Sleep -Milliseconds 150
  if (-not [HpcPlusBridgeNative]::SetForegroundWindow($handle)) {
    throw 'Could not bring the HPCPlus window to the foreground.'
  }
  Start-Sleep -Milliseconds 200

  $terminalRect = $terminal.Current.BoundingRectangle
  $clickX = [int]($terminalRect.X + ($terminalRect.Width / 2))
  $clickY = [int]($terminalRect.Y + ($terminalRect.Height / 2))
  $cursor = New-Object HpcPlusBridgeNative+POINT
  $haveCursor = [HpcPlusBridgeNative]::GetCursorPos([ref]$cursor)
  [void][HpcPlusBridgeNative]::SetCursorPos($clickX, $clickY)
  [HpcPlusBridgeNative]::mouse_event([HpcPlusBridgeNative]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  [HpcPlusBridgeNative]::mouse_event([HpcPlusBridgeNative]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150

  $previousClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
  try {
    [System.Windows.Forms.Clipboard]::SetText($envelope.WrappedCommand)
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    $commandSent = $true
  } finally {
    Start-Sleep -Milliseconds 100
    if ($null -ne $previousClipboard) {
      [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true)
    }
    if ($haveCursor) {
      [void][HpcPlusBridgeNative]::SetCursorPos($cursor.X, $cursor.Y)
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds $PollMilliseconds
    $currentWindowLines = @(Get-WindowTextLines -Window $window)
    $appendedWindowLines = @(Get-HpcPlusAppendedLines -PreviousLines $baselineWindowLines -CurrentLines $currentWindowLines)
    $sessionFailure = Get-HpcPlusTerminalSessionFailure -Lines $appendedWindowLines
    if ($sessionFailure.Detected) {
      Write-UnknownBridgeResult -Message $sessionFailure.Message -Output $latestLines
    }
    $latestLines = @(Get-TerminalLines -Terminal $terminal)
    $result = Get-HpcPlusEnvelopeResult -Lines $latestLines -StartMarker $envelope.StartMarker -EndMarker $envelope.EndMarker
    if ($result.FoundStart -and $result.FoundEnd) {
      $boundedOutput = @(Select-HpcPlusBoundedLines -Lines @($result.Body) -MaxLines $LastLines -MaxCharacters $MaxOutputCharacters)
      if ($StructuredResult) {
        [pscustomobject]@{
          Status = if ($result.ExitCode -eq 0) { 'completed' } else { 'failed' }
          RemoteExitCode = $result.ExitCode
          Output = $boundedOutput
          Error = ''
        } | ConvertTo-Json -Depth 4 -Compress
        exit 0
      }
      $boundedOutput
      exit $result.ExitCode
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  $markerState = "Start marker found: $($result.FoundStart); completion marker found: $($result.FoundEnd)."
  Write-UnknownBridgeResult -Message "Timed out after $TimeoutSeconds seconds without a complete HPCPlus marker pair. $markerState The command was not retried." -Output $latestLines -ExitCode 124
} catch {
  if ($StructuredResult -and $commandSent) {
    [pscustomobject]@{
      Status = 'unknown'
      RemoteExitCode = $null
      Output = @(Select-HpcPlusBoundedLines -Lines $latestLines -MaxLines $LastLines -MaxCharacters $MaxOutputCharacters)
      Error = "The bridge failed after sending the command; remote state is unknown and the command was not retried. $($_.Exception.Message)"
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
  }
  throw
} finally {
  if ($lockTaken) {
    [void]$mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
