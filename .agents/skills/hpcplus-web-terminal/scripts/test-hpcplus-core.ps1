$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'HpcPlusBridge.Core.psm1') -Force

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "Assertion failed: $Message" }
}

$readOnly = Get-HpcPlusCommandRisk -Command 'pwd; hostname; tail -n 80 job.out'
Assert-True ($readOnly.Category -eq 'read-only') 'bounded inspection should be read-only'

$submit = Get-HpcPlusCommandRisk -Command 'bsub < scf.lsf'
Assert-True $submit.RequiresSubmitApproval 'bsub should require submit approval'
Assert-True (-not $submit.RequiresMutationApproval) 'input redirection should not count as mutation'

$mutating = Get-HpcPlusCommandRisk -Command 'bash check_env.sh > check_env.out 2>&1'
Assert-True $mutating.RequiresMutationApproval 'output redirection should require mutation approval'

$blocked = Get-HpcPlusCommandRisk -Command 'curl https://example.com/file'
Assert-True $blocked.IsBlocked 'curl should be blocked'

$prefixedMutation = Get-HpcPlusCommandRisk -Command 'sudo rm -f stale.out'
Assert-True $prefixedMutation.RequiresMutationApproval 'prefixed mutation should still require approval'

$directoryEscape = Get-HpcPlusCommandRisk -Command 'cd ../other-task; pwd'
Assert-True ($directoryEscape.IsBlocked -and $directoryEscape.BlockedReasons -contains 'directory change or parent traversal') 'directory escape should be blocked'

$absolutePath = Get-HpcPlusCommandRisk -Command 'cat /etc/passwd'
Assert-True ($absolutePath.IsBlocked -and $absolutePath.BlockedReasons -contains 'absolute or home-relative path') 'absolute paths should be blocked'
$homePath = Get-HpcPlusCommandRisk -Command 'tail -n 20 $HOME/job.out'
Assert-True ($homePath.IsBlocked -and $homePath.BlockedReasons -contains 'absolute or home-relative path') 'home-relative paths should be blocked'
$relativePath = Get-HpcPlusCommandRisk -Command 'tail -n 20 ./job.out'
Assert-True (-not $relativePath.IsBlocked) 'relative paths inside the approved working directory should remain supported'

$broadScan = Get-HpcPlusCommandRisk -Command 'find . -type f'
Assert-True ($broadScan.IsBlocked -and $broadScan.BlockedReasons -contains 'broad filesystem scan') 'broad scan should be blocked'

$indirect = Get-HpcPlusCommandRisk -Command 'bash -lc "rm -rf ."'
Assert-True ($indirect.IsBlocked -and $indirect.BlockedReasons -contains 'indirect command evaluation') 'indirect shell command should be blocked'

$background = Get-HpcPlusCommandRisk -Command 'pw.x < scf.in > scf.out &'
Assert-True ($background.IsBlocked -and $background.BlockedReasons -contains 'detached or background execution') 'background command should be blocked'

$scoped = New-HpcPlusScopedCommand -Command 'pwd; hostname' -ApprovedWorkingDirectory "/home/user/DFT DMFT/任务"
Assert-True ($scoped -match '^cd -- ') 'scoped command should set the approved directory'
Assert-True ($scoped -match '\$PWD') 'scoped command should verify the resulting directory'
Assert-True ($scoped -match '\( pwd; hostname \)$') 'scoped command should group the complete reviewed command behind the directory guard'
$guardPosition = $scoped.IndexOf('&& (')
$separatorPosition = $scoped.IndexOf(';')
Assert-True ($guardPosition -ge 0 -and $separatorPosition -gt $guardPosition) 'command separators must remain inside the guarded group'
$invalidScopeFailed = $false
try { New-HpcPlusScopedCommand -Command 'pwd' -ApprovedWorkingDirectory '/home/user/../other' | Out-Null } catch { $invalidScopeFailed = $true }
Assert-True $invalidScopeFailed 'scoped command should reject a non-normalized directory'

$policyFailed = $false
try { Assert-HpcPlusCommandPolicy -Command 'qdel 123' | Out-Null } catch { $policyFailed = $true }
Assert-True $policyFailed 'scheduler cancellation should fail without mutation approval'

$envelope = New-HpcPlusCommandEnvelope -Command "printf 'hello'" -Id 'test1234'
Assert-True ($envelope.WrappedCommand -notmatch "printf 'hello'") 'raw command should not appear in the envelope'

$parsed = Get-HpcPlusEnvelopeResult -Lines @(
  'old prompt',
  $envelope.StartMarker,
  'hello',
  "$($envelope.EndMarker):0",
  'new prompt'
) -StartMarker $envelope.StartMarker -EndMarker $envelope.EndMarker
Assert-True ($parsed.FoundStart -and $parsed.FoundEnd) 'markers should be found'
Assert-True ($parsed.ExitCode -eq 0) 'exit code should be parsed'
Assert-True (($parsed.Body -join "`n") -eq 'hello') 'body should be extracted'

$endWithoutStart = Get-HpcPlusEnvelopeResult -Lines @(
  "$($envelope.EndMarker):0"
) -StartMarker $envelope.StartMarker -EndMarker $envelope.EndMarker
Assert-True (-not $endWithoutStart.FoundEnd) 'an end marker without the matching start marker must not complete a command'

$endBeforeStart = Get-HpcPlusEnvelopeResult -Lines @(
  "$($envelope.EndMarker):0",
  $envelope.StartMarker,
  'partial output'
) -StartMarker $envelope.StartMarker -EndMarker $envelope.EndMarker
Assert-True ($endBeforeStart.FoundStart -and -not $endBeforeStart.FoundEnd) 'a stale end marker before the start marker must be ignored'

$combined = Get-HpcPlusEnvelopeResult -Lines @(
  "$($envelope.StartMarker)`nline one`nline two`n$($envelope.EndMarker):7" -split "`n"
) -StartMarker $envelope.StartMarker -EndMarker $envelope.EndMarker
Assert-True ($combined.ExitCode -eq 7) 'non-zero exit code should be preserved'
Assert-True (($combined.Body -join ',') -eq 'line one,line two') 'multiple logical lines should be extracted'

$bounded = @(Select-HpcPlusBoundedLines -Lines @('old', ('x' * 2000)) -MaxLines 2 -MaxCharacters 1024)
Assert-True (($bounded -join "`n").Length -le 1024) 'bridge output should obey the character limit'
Assert-True (($bounded -join "`n") -match 'truncated') 'bridge output truncation should be explicit'

$appended = @(Get-HpcPlusAppendedLines -PreviousLines @('old one', 'old two') -CurrentLines @('old two', 'new one', 'new two'))
Assert-True (($appended -join ',') -eq 'new one,new two') 'terminal virtualization should preserve only newly appended lines'
Assert-True (@(Get-HpcPlusAppendedLines -PreviousLines @('same') -CurrentLines @('same')).Count -eq 0) 'an unchanged terminal should have no appended lines'

$forbidden = Get-HpcPlusTerminalSessionFailure -Lines @('403 Forbidden')
Assert-True ($forbidden.Detected -and $forbidden.Kind -eq 'forbidden') '403 Forbidden should stop the bridge'
$disconnected = Get-HpcPlusTerminalSessionFailure -Lines @('#SSCT#: Node is disconnected')
Assert-True ($disconnected.Detected -and $disconnected.Kind -eq 'disconnected') 'terminal disconnection should stop the bridge'
$reconnected = Get-HpcPlusTerminalSessionFailure -Lines @('#SSCT#: Node is disconnected', '#SSCT#: Node is connected')
Assert-True (-not $reconnected.Detected) 'a later connection marker should clear an older disconnect marker'
$ordinary403 = Get-HpcPlusTerminalSessionFailure -Lines @('application returned HTTP status 403')
Assert-True (-not $ordinary403.Detected) 'ordinary command output mentioning 403 should not look like the portal error page'

$jobId = Get-HpcPlusLsfSubmissionJobId -Output 'Job <12345> is submitted to queue <normal>.'
Assert-True ($jobId -eq '12345') 'LSF submission job id should be parsed'
Assert-True ($null -eq (Get-HpcPlusLsfSubmissionJobId -Output 'submission result was truncated')) 'missing job id should remain unknown'

$lsfState = Get-HpcPlusLsfState -Output "  RUN  `n"
Assert-True ($lsfState -eq 'RUN') 'bounded LSF state should be parsed'
Assert-True ($null -eq (Get-HpcPlusLsfState -Output 'job status unavailable')) 'unrecognized LSF state should remain unknown'

Write-Output 'HPCPlus bridge core tests passed.'
