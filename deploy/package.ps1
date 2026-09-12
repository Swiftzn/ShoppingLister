# Produce the bundle used by the Proxmox installer; excludes local list data.
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $projectPath 'pantry.tar.gz'
tar -czf $bundlePath -C $projectPath server.py static deploy README.md
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
Write-Output "Created $bundlePath"
