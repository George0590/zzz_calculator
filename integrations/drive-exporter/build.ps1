param(
    [string]$Cargo = 'cargo',
    [string]$Proxy = '',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskRuntime = Join-Path $taskRepo '.local-runtime\drive-exporter'
$taskSource = Join-Path $taskRuntime 'source'
$taskRevision = '8efb171b5e6b33ec464e8b43a28e5fb792fbc160'
$taskCrateHash = '138ba8229225b0334707e461dee957b8bbb0ca61c9be21d773991443e4364a08'
$taskGitOptions = @()
if ($Proxy) { $taskGitOptions = @('-c', "http.proxy=$Proxy") }
function Invoke-CheckedGit([string[]]$taskArguments) {
    & git @taskGitOptions @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "git failed: $taskArguments" }
}
function Apply-LocalPatch([string]$taskDirectory, [string]$taskPatch, [string]$taskPrefix = '') {
    # An already applied patch is accepted; no reset/clean is ever used.
    $taskPatchOptions = @('--ignore-space-change')
    if ($taskPrefix) { $taskPatchOptions += "--directory=$taskPrefix" }
    $taskPreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & git -C $taskDirectory apply --reverse --check @taskPatchOptions $taskPatch 2>$null
        $taskAlreadyApplied = $LASTEXITCODE -eq 0
    } finally { $ErrorActionPreference = $taskPreviousPreference }
    if ($taskAlreadyApplied) { return }
    Invoke-CheckedGit (@('-C', $taskDirectory, 'apply', '--check') + $taskPatchOptions + @($taskPatch))
    Invoke-CheckedGit (@('-C', $taskDirectory, 'apply') + $taskPatchOptions + @($taskPatch))
}
New-Item -ItemType Directory -Force $taskRuntime | Out-Null
if (-not (Test-Path -LiteralPath $taskSource)) {
    Invoke-CheckedGit @('clone', '--no-checkout', 'https://github.com/Treageer/zzz-drive-exporter', $taskSource)
    Invoke-CheckedGit @('-C', $taskSource, 'checkout', '--detach', $taskRevision)
}
$taskHead = & git -C $taskSource rev-parse HEAD
if ($taskHead.Trim() -ne $taskRevision) { throw 'Exporter source revision differs from the pinned revision; preserve it and choose a fresh runtime directory.' }
$taskVendor = Join-Path $taskSource 'vendor\pktmon'
if (-not (Test-Path -LiteralPath $taskVendor)) {
    $taskCrate = Join-Path $taskRuntime 'pktmon-0.6.2.crate'
    $taskWebOptions = @{}
    if ($Proxy) { $taskWebOptions.Proxy = $Proxy }
    Invoke-WebRequest -Uri 'https://static.crates.io/crates/pktmon/pktmon-0.6.2.crate' -OutFile $taskCrate @taskWebOptions
    if ((Get-FileHash -LiteralPath $taskCrate -Algorithm SHA256).Hash.ToLower() -ne $taskCrateHash) { throw 'pktmon crate checksum mismatch' }
    $taskVendorParent = Join-Path $taskSource 'vendor'
    New-Item -ItemType Directory -Force $taskVendorParent | Out-Null
    & tar -xf $taskCrate -C $taskVendorParent
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract pktmon crate' }
    $taskExtracted = [IO.Path]::GetFullPath((Join-Path $taskVendorParent 'pktmon-0.6.2'))
    if (-not $taskExtracted.StartsWith([IO.Path]::GetFullPath($taskVendorParent) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid extraction directory' }
    Move-Item -LiteralPath $taskExtracted -Destination $taskVendor
}
Apply-LocalPatch $taskSource (Join-Path $PSScriptRoot 'pktmon.patch') 'vendor/pktmon'
Apply-LocalPatch $taskSource (Join-Path $PSScriptRoot 'exporter.patch')
$taskMachine = Join-Path $taskSource 'src\machine.rs'
if ((Test-Path -LiteralPath $taskMachine) -and
    (Get-FileHash -LiteralPath $taskMachine).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'machine.rs')).Hash) {
    throw 'Existing machine.rs has local changes; preserve and review it before building.'
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'machine.rs') -Destination $taskMachine
if ($PrepareOnly) { Write-Output 'Pinned source and patches prepared.'; exit 0 }
& $Cargo test --manifest-path (Join-Path $taskSource 'Cargo.toml') --locked
if ($LASTEXITCODE -ne 0) { throw 'Exporter tests failed' }
& $Cargo build --manifest-path (Join-Path $taskSource 'Cargo.toml') --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Exporter build failed' }
$taskTarget = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $taskSource 'target' }
$taskBin = Join-Path $taskRuntime 'bin'
New-Item -ItemType Directory -Force $taskBin | Out-Null
Copy-Item -LiteralPath (Join-Path $taskTarget 'release\zzz-drive-exporter.exe') -Destination $taskBin
Copy-Item -LiteralPath (Join-Path $taskSource 'LICENSE') -Destination $taskBin
Copy-Item -LiteralPath (Join-Path $taskSource 'THIRD_PARTY_NOTICES.md') -Destination $taskBin
$taskHashes = @{}
foreach ($taskName in @('exporter.patch', 'pktmon.patch', 'machine.rs')) {
    $taskHashes[$taskName] = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $taskName) -Algorithm SHA256).Hash.ToLower()
}
$taskInfo = @{ upstream = $taskRevision; protocolVersion = 1; hashes = $taskHashes;
    executableSha256 = (Get-FileHash -LiteralPath (Join-Path $taskBin 'zzz-drive-exporter.exe') -Algorithm SHA256).Hash.ToLower() }
$taskInfo | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $taskRuntime 'build-info.json')
Write-Output 'Local exporter built. No capture, publication, or deployment was started.'
