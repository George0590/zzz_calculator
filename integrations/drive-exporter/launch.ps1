param([Parameter(Mandatory)][string]$TaskDirectory,
      [Parameter(Mandatory)][string]$TaskId,
      [Parameter(Mandatory)][string]$ExporterPath)
$ErrorActionPreference = 'Stop'
function Write-LaunchState($taskValue) {
    $taskFile = Join-Path $TaskDirectory 'launch.json'
    [IO.File]::WriteAllText($taskFile + '.tmp', ($taskValue | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath ($taskFile + '.tmp') -Destination $taskFile -Force
}
try {
    $taskArguments = @('--machine-task-dir', ('"' + $TaskDirectory + '"'), '--task-id', $TaskId)
    $taskChild = Start-Process -FilePath $ExporterPath -ArgumentList $taskArguments -Verb RunAs -WindowStyle Hidden -PassThru
    Write-LaunchState @{ pid = $taskChild.Id }
    $taskChild.WaitForExit()
    Write-LaunchState @{ pid = $taskChild.Id; exitCode = $taskChild.ExitCode }
    exit $taskChild.ExitCode
} catch {
    $taskException = $_.Exception
    while ($taskException.InnerException) { $taskException = $taskException.InnerException }
    $taskCode = if ($taskException.NativeErrorCode -eq 1223) { 'UAC_REJECTED' } else { 'START_FAILED' }
    Write-LaunchState @{ errorCode = $taskCode; error = $taskException.Message }
    exit 1
}
