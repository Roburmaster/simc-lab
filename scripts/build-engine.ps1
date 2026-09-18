param([switch]$Update, [int]$Parallel = 6)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $projectRoot 'vendor\simc'
$buildDir = Join-Path $projectRoot 'build'
if (!(Test-Path -LiteralPath $sourceDir)) {
    git clone --depth 1 --branch midnight https://github.com/simulationcraft/simc.git $sourceDir
    if ($LASTEXITCODE -ne 0) { throw 'Could not download SimulationCraft.' }
} elseif ($Update) {
    $dirty = git -C $sourceDir status --porcelain
    if ($dirty) { throw 'The SimC source has local changes. Preserve them before updating.' }
    git -C $sourceDir pull --ff-only origin midnight
    if ($LASTEXITCODE -ne 0) { throw 'Could not update SimulationCraft.' }
}
$buildInfo = Get-Content -LiteralPath (Join-Path $sourceDir 'SpellDataDump\build_info.txt') -Raw
if ($buildInfo -notmatch 'SimulationCraft ([\d-]+) for World of Warcraft ([\d.]+) Live \(hotfix ([^)]+)\)') { throw 'Unknown or non-live SimC build.' }
$version = $Matches[1]
$wowVersion = $Matches[2]
$hotfix = $Matches[3]
$wowInfoPath = 'C:\Program Files (x86)\World of Warcraft\.build.info'
if (Test-Path -LiteralPath $wowInfoPath) {
    $rows = Get-Content -LiteralPath $wowInfoPath
    $headers = $rows[0].Split('|') | ForEach-Object { $_.Split('!')[0] }
    foreach ($line in $rows | Select-Object -Skip 1) {
        $values = $line.Split('|')
        if ($values[[array]::IndexOf($headers, 'Product')] -eq 'wow' -and $values[[array]::IndexOf($headers, 'Active')] -eq '1') {
            $installedVersion = $values[[array]::IndexOf($headers, 'Version')]
            if ($installedVersion -ne $wowVersion) { throw "SimC er for $wowVersion, but installed WoW is $installedVersion. Waiting for matching upstream data." }
        }
    }
}
cmake -S $sourceDir -B $buildDir -G 'Visual Studio 18 2026' -A x64 -DBUILD_GUI=OFF -DBUILD_TESTING=OFF -DSC_NO_NETWORKING=ON
if ($LASTEXITCODE -ne 0) { throw 'CMake configuration failed.' }
cmake --build $buildDir --config Release --parallel $Parallel
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
$commit = git -C $sourceDir rev-parse HEAD
$commitDate = git -C $sourceDir show -s --format=%cI HEAD
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'data') -Force | Out-Null
$metadata = @{version=$version;wowVersion=$wowVersion;hotfix=$hotfix;commit=$commit;commitDate=$commitDate;branch='midnight';builtAt=[DateTime]::UtcNow.ToString('o');source='https://github.com/simulationcraft/simc';networking=$false}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'data\engine.json') -Encoding utf8
Write-Host "Complete: SimulationCraft $version / WoW $wowVersion / $commit"
