param(
    [ValidateRange(1, 20)]
    [int]$Runs = 3,
    [ValidateSet('weavatrix', 'serena', 'serena-warm')]
    [string[]]$Arms = @('weavatrix', 'serena', 'serena-warm'),
    [string]$WeavatrixExecutable = (Join-Path $env:LOCALAPPDATA 'Temp\weavatrix-refbench-bin\weavatrix-refactor-1.0.5.exe'),
    [string]$WeavatrixConfig = (Join-Path $PSScriptRoot 'config-weavatrix-105.mjs'),
    [string]$PythonExecutable = 'python3',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'results\2026-08-11-v2\protocol')
)

$ErrorActionPreference = 'Stop'
if ('weavatrix' -in $Arms -and !(Test-Path -LiteralPath $WeavatrixExecutable)) {
    throw "missing Weavatrix executable: $WeavatrixExecutable"
}

$fixtures = [ordered]@{
    typescript = Join-Path $PSScriptRoot 'fixture'
    rust = Join-Path $PSScriptRoot 'fixtures\rust'
    python = Join-Path $PSScriptRoot 'fixtures\python'
}
$configs = @{
    weavatrix = $WeavatrixConfig
    serena = Join-Path $PSScriptRoot 'config-serena.mjs'
    'serena-warm' = Join-Path $PSScriptRoot 'config-serena-warm.mjs'
}
$driver = Join-Path $PSScriptRoot 'driver.mjs'
$grader = Join-Path $PSScriptRoot 'verify.mjs'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "weavatrix-refbench-protocol-$([guid]::NewGuid().ToString('N'))"
$cargoTarget = Join-Path $temporaryRoot 'cargo-target'
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$previousEnvironment = @{}
foreach ($name in 'REFBENCH_CAPTURE', 'REFBENCH_FIXTURE', 'REFBENCH_LANGUAGE', 'REFBENCH_WEAVATRIX_EXE', 'REFBENCH_PYTHON', 'CARGO_TARGET_DIR') {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $env:REFBENCH_CAPTURE = '1'
    $env:REFBENCH_WEAVATRIX_EXE = $WeavatrixExecutable
    $env:REFBENCH_PYTHON = $PythonExecutable
    $env:CARGO_TARGET_DIR = $cargoTarget

    foreach ($language in $fixtures.Keys) {
        foreach ($arm in $Arms) {
            for ($index = 1; $index -le $Runs; $index += 1) {
                $runRoot = Join-Path $temporaryRoot "$arm-$language-$index"
                New-Item -ItemType Directory -Path $runRoot | Out-Null
                Get-ChildItem -LiteralPath $fixtures[$language] -Force |
                    Where-Object { $_.Name -notin @('node_modules', 'target', '__pycache__', '.serena') } |
                    Copy-Item -Destination $runRoot -Recurse

                if ($language -eq 'typescript') {
                    & npm.cmd ci --ignore-scripts --no-audit --no-fund --silent --prefix $runRoot
                    if ($LASTEXITCODE -ne 0) { throw "npm ci failed for $arm $language run $index" }
                }

                $env:REFBENCH_FIXTURE = $runRoot
                $env:REFBENCH_LANGUAGE = $language
                $outputPath = Join-Path $OutputDirectory "$arm-$language-run$index.json"
                & node $driver $configs[$arm] $outputPath
                $driverExitCode = $LASTEXITCODE
                if (!(Test-Path -LiteralPath $outputPath)) {
                    throw "driver produced no report for $arm $language run $index"
                }

                $gradeText = (& node $grader $language $runRoot --json 2>&1) -join "`n"
                $gradeExitCode = $LASTEXITCODE
                $grade = $gradeText | ConvertFrom-Json
                $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
                $report | Add-Member -NotePropertyName benchmark -NotePropertyValue ([ordered]@{
                    arm = $arm
                    language = $language
                    run = $index
                    driverExitCode = $driverExitCode
                    gradeExitCode = $gradeExitCode
                    grade = $grade
                })
                $report | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outputPath -Encoding utf8
                Write-Output "$arm $language run $index`: $($grade.score); startup=$([math]::Round($report.startupMs))ms; task=$([math]::Round(($report.calls | Measure-Object ms -Sum).Sum))ms; fixed=$($report.sessionFixedTokens.total) tokens; task=$($report.taskTokens.total) tokens"

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
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}

Write-Output "raw protocol reports: $([System.IO.Path]::GetFullPath($OutputDirectory))"
