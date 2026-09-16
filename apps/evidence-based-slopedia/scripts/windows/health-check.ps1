$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Push-Location (Join-Path $root "automation\discord_bot")
try { npm run ebs -- runtime status --json } finally { Pop-Location }
