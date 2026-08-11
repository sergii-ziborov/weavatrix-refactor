param(
    [ValidateRange(1, 20)]
    [int]$Runs = 3,
    [ValidateRange(1, 20)]
    [int[]]$RunIndexes = @(),
    [ValidateSet('naked', 'weavatrix', 'serena')]
    [string[]]$Arms = @('naked', 'weavatrix', 'serena'),
    [ValidateSet('typescript', 'rust', 'python')]
    [string[]]$Languages = @('typescript', 'rust', 'python'),
    [string]$Model = 'gpt-5.6-sol',
    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$ReasoningEffort = 'medium',
    [string]$WeavatrixExecutable = (Join-Path $env:LOCALAPPDATA 'Temp\weavatrix-refbench-bin\weavatrix-refactor-1.0.5.exe'),
    [ValidateSet('full', 'rename')]
    [string]$WeavatrixProfile = 'full',
    [string]$WeavatrixVersion = '1.0.5',
    [string]$PythonExecutable = 'python3',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'results\2026-08-11-v2\agent')
)

$ErrorActionPreference = 'Stop'
$auditScript = Join-Path $PSScriptRoot 'agent-audit.mjs'
$effectiveRunIndexes = if ($RunIndexes.Count -gt 0) { $RunIndexes } else { 1..$Runs }
if ('weavatrix' -in $Arms -and !(Test-Path -LiteralPath $WeavatrixExecutable)) {
    throw "missing Weavatrix executable: $WeavatrixExecutable"
}

$fixturePaths = @{
    typescript = Join-Path $PSScriptRoot 'fixture'
    rust = Join-Path $PSScriptRoot 'fixtures\rust'
    python = Join-Path $PSScriptRoot 'fixtures\python'
}
$specs = @{
    typescript = [ordered]@{
        oldName = 'resolveTarget'
        newName = 'locateTarget'
        declaringFile = 'src/core.ts'
        build = 'Run the TypeScript build check.'
    }
    rust = [ordered]@{
        oldName = 'resolve_target'
        newName = 'locate_target'
        declaringFile = 'src/core.rs'
        build = 'Run the Rust test or check command.'
    }
    python = [ordered]@{
        oldName = 'resolve_target'
        newName = 'locate_target'
        declaringFile = 'src/core.py'
        build = 'Run the Python unit tests.'
    }
}

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
$grader = Join-Path $PSScriptRoot 'verify.mjs'
$serenaCommit = 'f1d78a88cec2031d6b699c9944839979e9a0175d'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "weavatrix-refbench-agent-$([guid]::NewGuid().ToString('N'))"
$cargoTarget = Join-Path $temporaryRoot 'cargo-target'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$previousPython = $env:REFBENCH_PYTHON
$previousCargoTarget = $env:CARGO_TARGET_DIR
$env:REFBENCH_PYTHON = $PythonExecutable
$env:CARGO_TARGET_DIR = $cargoTarget
$results = @()

try {
    foreach ($language in $Languages) {
        $spec = $specs[$language]
        $baseTask = "Rename the function $($spec.oldName) declared in $($spec.declaringFile) to $($spec.newName). Update every reference and import that refers to that symbol across the repository. Preserve unrelated same-named symbols, longer identifiers, comments, and string literals. $($spec.build) Report the result concisely."

        foreach ($arm in $Arms) {
            $method = switch ($arm) {
                'naked' { 'Use the normal repository inspection and editing tools. No MCP refactoring server is available.' }
                'weavatrix' { 'Use the weavatrix_refactor MCP rename_symbol workflow for source edits; do not manually edit source files. Resolve any ambiguity, preview the exact rename, then apply that same preview with its confirmation token.' }
                'serena' { 'Use the Serena MCP tools for source edits; do not manually edit source files. Follow the available symbol lookup and rename workflow.' }
            }
            $prompt = "$baseTask $method"

            foreach ($index in $effectiveRunIndexes) {
                $runRoot = Join-Path $temporaryRoot "$arm-$language-$index"
                New-Item -ItemType Directory -Path $runRoot | Out-Null
                Get-ChildItem -LiteralPath $fixturePaths[$language] -Force |
                    Where-Object { $_.Name -notin @('node_modules', 'target', '__pycache__', '.serena') } |
                    Copy-Item -Destination $runRoot -Recurse
                if ($language -eq 'typescript') {
                    & npm.cmd ci --ignore-scripts --no-audit --no-fund --silent --prefix $runRoot
                    if ($LASTEXITCODE -ne 0) { throw "npm ci failed for $arm $language run $index" }
                }
                git -C $runRoot init --quiet
                git -C $runRoot add -A
                git -C $runRoot -c user.name=refbench -c user.email=refbench@example.invalid commit --quiet -m fixture

                $arguments = @(
                    'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
                    '--dangerously-bypass-approvals-and-sandbox', '-C', $runRoot,
                    '-m', $Model, '-c', "model_reasoning_effort=`"$ReasoningEffort`""
                )
                if ($arm -eq 'weavatrix') {
                    $command = $WeavatrixExecutable.Replace('\', '/')
                    $weavatrixArgs = if ($WeavatrixProfile -eq 'rename') {
                        "['mcp','.','--profile=rename']"
                    } else {
                        "['mcp','.']"
                    }
                    $arguments += @(
                        '-c', "mcp_servers.weavatrix_refactor.command='$command'",
                        '-c', "mcp_servers.weavatrix_refactor.args=$weavatrixArgs",
                        '-c', "mcp_servers.weavatrix_refactor.env={WEAVATRIX_ALLOW_SOURCE_EDITS='1'}"
                    )
                } elseif ($arm -eq 'serena') {
                    $serenaSource = "git+https://github.com/oraios/serena@$serenaCommit"
                    $arguments += @(
                        '-c', "mcp_servers.serena.command='uvx'",
                        '-c', "mcp_servers.serena.args=['--from','$serenaSource','serena','start-mcp-server','--project','.','--context','ide-assistant','--enable-web-dashboard','false','--enable-gui-log-window','false']",
                        '-c', 'mcp_servers.serena.startup_timeout_sec=600',
                        '-c', 'mcp_servers.serena.tool_timeout_sec=300'
                    )
                }
                $arguments += $prompt

                $timer = [System.Diagnostics.Stopwatch]::StartNew()
                $ErrorActionPreference = 'Continue'
                try {
                    $events = & $cli @arguments 2>&1
                    $exitCode = $LASTEXITCODE
                } finally {
                    $ErrorActionPreference = 'Stop'
                }
                $timer.Stop()

                $stem = "$arm-$language-run$index"
                $eventPath = Join-Path $OutputDirectory "$stem.jsonl"
                $events | Set-Content -LiteralPath $eventPath -Encoding utf8
                $usage = $null
                foreach ($line in $events) {
                    try {
                        $event = ([string]$line) | ConvertFrom-Json -ErrorAction Stop
                        if ($event.type -eq 'turn.completed') { $usage = $event.usage }
                    } catch {
                        # Native stderr may be interleaved; only JSON events are benchmark data.
                    }
                }
                $auditText = (& node $auditScript $eventPath $arm 2>&1) -join "`n"
                $auditExitCode = $LASTEXITCODE
                $toolAudit = $auditText | ConvertFrom-Json

                $gradeText = (& node $grader $language $runRoot --json 2>&1) -join "`n"
                $gradeExitCode = $LASTEXITCODE
                $grade = $gradeText | ConvertFrom-Json
                $patchPath = Join-Path $OutputDirectory "$stem.patch"
                git -C $runRoot diff --binary | Set-Content -LiteralPath $patchPath -Encoding utf8

                $run = [ordered]@{
                    arm = $arm
                    language = $language
                    run = $index
                    model = $Model
                    reasoningEffort = $ReasoningEffort
                    cliVersion = $cliVersion
                    prompt = $prompt
                    wallMs = $timer.ElapsedMilliseconds
                    exitCode = $exitCode
                    gradeExitCode = $gradeExitCode
                    grade = $grade
                    usage = $usage
                    toolAudit = $toolAudit
                    events = [System.IO.Path]::GetFileName($eventPath)
                    patch = [System.IO.Path]::GetFileName($patchPath)
                }
                $runPath = Join-Path $OutputDirectory "$stem.json"
                $run | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $runPath -Encoding utf8
                if ($auditExitCode -ne 0) {
                    throw "$arm $language run $index violated the edit-channel policy: $($toolAudit.issues -join ', ')"
                }
                $results += [pscustomobject]$run
                $inputTokens = if ($null -ne $usage) { $usage.input_tokens } else { 'missing' }
                $outputTokens = if ($null -ne $usage) { $usage.output_tokens } else { 'missing' }
                Write-Output "$arm $language run $index`: $($grade.score); wall=$($timer.ElapsedMilliseconds)ms; input=$inputTokens; output=$outputTokens; exit=$exitCode"

                $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
                $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot) + [System.IO.Path]::DirectorySeparatorChar
                if (!$resolvedRunRoot.StartsWith($resolvedTemporaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "refusing to clean unexpected run path: $resolvedRunRoot"
                }
                Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
} finally {
    $env:REFBENCH_PYTHON = $previousPython
    $env:CARGO_TARGET_DIR = $previousCargoTarget
}

$metadata = [ordered]@{
    schema = 'weavatrix.rename-agent-benchmark.agent-matrix.v2'
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    cliVersion = $cliVersion
    model = $Model
    reasoningEffort = $ReasoningEffort
    serenaCommit = $serenaCommit
    weavatrixVersion = $WeavatrixVersion
    weavatrixProfile = $WeavatrixProfile
    tokenizerNote = 'Agent token counts are the cumulative usage reported by turn.completed; MCP catalog and instructions are already included and are not added again.'
    runs = $results
}
$metadata | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'agent-matrix.json') -Encoding utf8
$metadata | ConvertTo-Json -Depth 4
