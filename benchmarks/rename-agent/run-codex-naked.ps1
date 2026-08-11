param(
    [int]$Runs = 3,
    [string]$Model = '',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'results\local-codex')
)

$ErrorActionPreference = 'Stop'
if ($Runs -lt 1) { throw 'Runs must be positive' }

$fixture = Join-Path $PSScriptRoot 'fixture'
$grader = Join-Path $PSScriptRoot 'verify.mjs'
$codexCommand = Get-Command codex -ErrorAction Stop
$resources = Split-Path $codexCommand.Source -Parent
$cliDirectory = Join-Path ([System.IO.Path]::GetTempPath()) 'weavatrix-refbench-codex-cli'
New-Item -ItemType Directory -Path $cliDirectory -Force | Out-Null
foreach ($name in 'codex.exe', 'codex-code-mode-host.exe', 'codex-command-runner.exe') {
    $source = Join-Path $resources $name
    if (!(Test-Path -LiteralPath $source)) { throw "missing bundled Codex component: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $cliDirectory $name) -Force
}
$cli = Join-Path $cliDirectory 'codex.exe'
$cliVersion = (& $cli --version) -join ''

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "weavatrix-refbench-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

$prompt = 'Rename the exported function resolveTarget declared in src/core.ts to locateTarget. Update every reference and import that refers to that exported symbol across the repository. Preserve unrelated same-named symbols, longer identifiers, comments, and string literals. Make the edits, run the TypeScript build check, and report the result concisely.'
$results = @()
for ($index = 1; $index -le $Runs; $index += 1) {
    $runRoot = Join-Path $temporaryRoot "run-$index"
    New-Item -ItemType Directory -Path $runRoot | Out-Null
    Get-ChildItem -LiteralPath $fixture -Force | Copy-Item -Destination $runRoot -Recurse
    git -C $runRoot init --quiet
    git -C $runRoot add -A
    git -C $runRoot -c user.name=refbench -c user.email=refbench@example.invalid commit --quiet -m fixture
    npm.cmd install --ignore-scripts --no-audit --no-fund --silent --prefix $runRoot

    $arguments = @(
        'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
        '--dangerously-bypass-approvals-and-sandbox', '-C', $runRoot
    )
    if ($Model) { $arguments += @('-m', $Model) }
    $arguments += $prompt

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $events = & $cli @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $timer.Stop()
    $eventPath = Join-Path $OutputDirectory "codex-naked-run$index.jsonl"
    $events | Set-Content -LiteralPath $eventPath -Encoding UTF8

    $usage = $null
    foreach ($line in $events) {
        try {
            $event = ([string]$line) | ConvertFrom-Json -ErrorAction Stop
            if ($event.type -eq 'turn.completed') { $usage = $event.usage }
        } catch {
            # PowerShell may interleave native stderr; only JSON events are benchmark data.
        }
    }
    if ($exitCode -ne 0 -or $null -eq $usage) {
        throw "Codex run $index failed (exit $exitCode or no usage event); inspect $eventPath"
    }
    $grade = & node $grader $runRoot
    if ($LASTEXITCODE -ne 0) { throw "Codex run $index failed the fixture grader" }
    $score = ($grade | Select-String -Pattern '^score: ').Line.Replace('score: ', '')
    $results += [pscustomobject]@{
        events = (Resolve-Path -LiteralPath $eventPath).Path
        wallMs = $timer.ElapsedMilliseconds
        score = $score
        inputTokens = $usage.input_tokens
        cachedInputTokens = $usage.cached_input_tokens
        outputTokens = $usage.output_tokens
        reasoningOutputTokens = $usage.reasoning_output_tokens
    }
}

$report = [ordered]@{
    cliVersion = $cliVersion
    model = $(if ($Model) { $Model } else { 'CLI default with --ignore-user-config' })
    prompt = $prompt
    temporaryRoot = $temporaryRoot
    runs = $results
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'codex-naked-runs.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 8
