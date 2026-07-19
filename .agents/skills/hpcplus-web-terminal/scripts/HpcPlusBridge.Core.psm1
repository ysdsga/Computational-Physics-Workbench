Set-StrictMode -Version Latest

function Get-HpcPlusCommandRisk {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  $trimmed = $Command.Trim()
  if ($trimmed.Length -eq 0) {
    throw 'Remote command is empty.'
  }
  if ($trimmed.Length -gt 8192) {
    throw 'Remote command exceeds the 8192-character bridge limit.'
  }

  $blockedPatterns = [ordered]@{
    'interactive program' = '(?im)\b(vi|vim|nano|emacs|top|htop|less|more|watch)\b'
    'software installation' = '(?im)\b(conda|mamba|pip|pip3)\s+install\b'
    'network or file-transfer command' = '(?im)\b(ssh|scp|sftp|rsync|curl|wget|nc|ncat|telnet)\b'
    'terminal session control' = '(?im)\b(exit|logout|exec)\b'
    'directory change or parent traversal' = '(?im)(^|[;&|]\s*)(cd|pushd|popd)\b|(^|[\s"''=])\.\.(?:/|$)'
    'absolute or home-relative path' = '(?im)(?<![\w.#!:])/[^\s"'';&|<>()]*|(?<![\w#])~(?:[A-Za-z0-9_.-]+)?(?:/|(?=\s|$))|\$(?:HOME|TMPDIR|SCRATCH)(?:/|\b)|\$\{(?:HOME|TMPDIR|SCRATCH)\}(?:/|\b)'
    'broad filesystem scan' = '(?im)(^|[;&|]\s*)(find|locate|tree)\b|\bls\s+[^\r\n;&|]*-[a-z]*R[a-z]*\b'
    'indirect command evaluation' = '(?im)\beval\b|(^|[;&|]\s*)(bash|sh|zsh|fish)\s+-[a-z]*c\b|(^|[;&|]\s*)(python|python3|perl|ruby|node)\s+-(c|e)\b'
    'detached or background execution' = '(?m)\bnohup\b|(?<![>&])&(?![>&])'
  }

  $blockedReasons = New-Object System.Collections.Generic.List[string]
  foreach ($entry in $blockedPatterns.GetEnumerator()) {
    if ($trimmed -match $entry.Value) {
      $blockedReasons.Add($entry.Key)
    }
  }

  $requiresSubmit = $trimmed -match '(?im)\b(bsub|sbatch|qsub)\b'
  $requiresMutation = $trimmed -match '(?im)\b(rm|rmdir|unlink|shred|truncate|dd|mkfs(?:\.[a-z0-9]+)?|mv|chmod|chown|kill|pkill|bkill|qdel|scancel|bmod)\b' -or
    $trimmed -match '(?im)\bsed\s+[^\r\n;&|]*-[a-z]*i[a-z]*\b' -or
    $trimmed -match '(?m)(^|[^<])>{1,2}(?![>&])'

  [pscustomobject]@{
    Command = $trimmed
    IsBlocked = $blockedReasons.Count -gt 0
    BlockedReasons = @($blockedReasons)
    RequiresSubmitApproval = [bool]$requiresSubmit
    RequiresMutationApproval = [bool]$requiresMutation
    Category = if ($blockedReasons.Count -gt 0) {
      'blocked'
    } elseif ($requiresSubmit -and $requiresMutation) {
      'submit+mutating'
    } elseif ($requiresSubmit) {
      'submit'
    } elseif ($requiresMutation) {
      'mutating'
    } else {
      'read-only'
    }
  }
}

function Select-HpcPlusBoundedLines {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines,
    [ValidateRange(1, 1000)][int]$MaxLines = 160,
    [ValidateRange(1024, 262144)][int]$MaxCharacters = 65536
  )

  $tail = @($Lines | Select-Object -Last $MaxLines)
  $joined = $tail -join "`n"
  if ($joined.Length -le $MaxCharacters) { return $tail }

  $marker = '[...HPCPlus bridge output truncated...]'
  $keep = [Math]::Max(0, $MaxCharacters - $marker.Length)
  @($marker + $joined.Substring($joined.Length - $keep))
}

function Assert-HpcPlusCommandPolicy {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [switch]$AllowSubmit,
    [switch]$AllowMutating
  )

  $risk = Get-HpcPlusCommandRisk -Command $Command
  if ($risk.IsBlocked) {
    throw "Command is not supported by the web-terminal bridge: $($risk.BlockedReasons -join ', ')."
  }
  if ($risk.RequiresSubmitApproval -and -not $AllowSubmit) {
    throw 'Job submission requires explicit confirmation and -AllowSubmit.'
  }
  if ($risk.RequiresMutationApproval -and -not $AllowMutating) {
    throw 'The command may change files or scheduler state; explicit confirmation and -AllowMutating are required.'
  }
  $risk
}

function New-HpcPlusCommandEnvelope {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string]$Id = ([Guid]::NewGuid().ToString('N').Substring(0, 12))
  )

  if ($Id -notmatch '^[a-zA-Z0-9_-]{4,64}$') {
    throw 'Envelope id contains unsupported characters.'
  }

  $startMarker = "__HPCPLUS_START_${Id}__"
  $endMarker = "__HPCPLUS_END_${Id}__"
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Command))
  $wrapped = "printf '%s\n' '$startMarker'; __hpcplus_payload=`$(printf '%s' '$payload' | base64 -d); eval `"`$__hpcplus_payload`"; __hpcplus_status=`$?; printf '\n%s:%s\n' '$endMarker' `"`$__hpcplus_status`""

  [pscustomobject]@{
    Id = $Id
    StartMarker = $startMarker
    EndMarker = $endMarker
    WrappedCommand = $wrapped
  }
}

function New-HpcPlusScopedCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string]$ApprovedWorkingDirectory
  )

  $workdir = $ApprovedWorkingDirectory.Trim()
  $hasControlCharacter = $false
  foreach ($character in $workdir.ToCharArray()) {
    if ([int]$character -lt 0x20 -or [int]$character -eq 0x7f) {
      $hasControlCharacter = $true
      break
    }
  }
  $segments = @($workdir.Split('/'))
  if ($hasControlCharacter -or $workdir -eq '/' -or -not $workdir.StartsWith('/') -or
      $workdir.Contains('\') -or $workdir.EndsWith('/') -or
      @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0 -or
      @($segments | Select-Object -Skip 1 | Where-Object { $_ -eq '' }).Count -gt 0) {
    throw 'Approved working directory must be a normalized, non-root absolute POSIX path.'
  }

  $quoted = "'" + $workdir.Replace("'", "'`"'`"'") + "'"
  "cd -- $quoted && [ `"`$PWD`" = $quoted ] && $Command"
}

function Get-HpcPlusEnvelopeResult {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Lines,
    [Parameter(Mandatory = $true)]
    [string]$StartMarker,
    [Parameter(Mandatory = $true)]
    [string]$EndMarker
  )

  $body = New-Object System.Collections.Generic.List[string]
  $inBody = $false
  $foundStart = $false
  $exitCode = $null
  $endPattern = '^' + [Regex]::Escape($EndMarker) + ':(-?\d+)$'

  foreach ($lineValue in $Lines) {
    $line = [string]$lineValue
    $trimmed = $line.Trim()
    if ($trimmed -eq $StartMarker) {
      $foundStart = $true
      $inBody = $true
      continue
    }
    if ($inBody -and $trimmed -match $endPattern) {
      $exitCode = [int]$Matches[1]
      $inBody = $false
      continue
    }
    if ($inBody) {
      $body.Add($line)
    }
  }

  [pscustomobject]@{
    FoundStart = $foundStart
    FoundEnd = $null -ne $exitCode
    ExitCode = $exitCode
    Body = @($body)
  }
}

function Get-HpcPlusAppendedLines {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$PreviousLines,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$CurrentLines
  )

  if ($PreviousLines.Count -eq 0) { return @($CurrentLines) }
  if ($CurrentLines.Count -eq 0) { return @() }

  $maximumOverlap = [Math]::Min($PreviousLines.Count, $CurrentLines.Count)
  for ($overlap = $maximumOverlap; $overlap -gt 0; $overlap--) {
    $matches = $true
    $previousOffset = $PreviousLines.Count - $overlap
    for ($index = 0; $index -lt $overlap; $index++) {
      if ([string]$PreviousLines[$previousOffset + $index] -cne [string]$CurrentLines[$index]) {
        $matches = $false
        break
      }
    }
    if ($matches) {
      if ($overlap -eq $CurrentLines.Count) { return @() }
      return @($CurrentLines[$overlap..($CurrentLines.Count - 1)])
    }
  }

  # The terminal can replace or virtualize its accessible text tree. In that case
  # the current snapshot is the only safe evidence available to the caller.
  @($CurrentLines)
}

function Get-HpcPlusTerminalSessionFailure {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines
  )

  $lastFailure = $null
  foreach ($lineValue in @($Lines | Select-Object -Last 80)) {
    $line = ([string]$lineValue).Trim()
    if (-not $line) { continue }

    if ($line -match '(?i)^(#SSCT#:\s*)?(node|terminal|connection)\s+(is\s+)?connected\.?$' -or
        $line -match '(?i)^connection\s+(re-?established|restored)\.?$') {
      $lastFailure = $null
      continue
    }

    if ($line -match '(?i)^403\s+Forbidden\.?$') {
      $lastFailure = [pscustomobject]@{
        Detected = $true
        Kind = 'forbidden'
        Message = 'HPCPlus displayed 403 Forbidden. The command state is unknown and the command was not retried.'
      }
      continue
    }

    if ($line -match '(?i)^(#SSCT#:\s*)?(node|terminal|connection)\s+(is\s+)?(disconnected|closed|lost)\.?$' -or
        $line -match '(?i)^websocket\b.*\b(closed|disconnected|failed)\b') {
      $lastFailure = [pscustomobject]@{
        Detected = $true
        Kind = 'disconnected'
        Message = 'The HPCPlus terminal reported a disconnected session. The command state is unknown and the command was not retried.'
      }
      continue
    }

    if ($line -match '(?i)^(session\s+(has\s+)?expired|please\s+(sign|log)\s+in\s+again)\.?$') {
      $lastFailure = [pscustomobject]@{
        Detected = $true
        Kind = 'session-expired'
        Message = 'The HPCPlus session expired. The command state is unknown and the command was not retried.'
      }
    }
  }

  if ($null -ne $lastFailure) { return $lastFailure }
  [pscustomobject]@{ Detected = $false; Kind = ''; Message = '' }
}

function Get-HpcPlusLsfSubmissionJobId {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Output)

  $match = [Regex]::Match(
    $Output,
    'Job\s*<(?<id>\d+)>\s*is\s+submitted',
    [Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if ($match.Success) { return $match.Groups['id'].Value }
  $null
}

function Get-HpcPlusLsfState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Output)

  $match = [Regex]::Match(
    $Output,
    '(?im)^\s*(PEND|RUN|DONE|EXIT|PSUSP|USUSP|SSUSP|WAIT|UNKWN|ZOMBI)\s*$'
  )
  if ($match.Success) { return $match.Groups[1].Value.ToUpperInvariant() }
  $null
}

Export-ModuleMember -Function Get-HpcPlusCommandRisk, Assert-HpcPlusCommandPolicy, New-HpcPlusCommandEnvelope, New-HpcPlusScopedCommand, Get-HpcPlusEnvelopeResult, Get-HpcPlusAppendedLines, Get-HpcPlusTerminalSessionFailure, Get-HpcPlusLsfSubmissionJobId, Get-HpcPlusLsfState, Select-HpcPlusBoundedLines
