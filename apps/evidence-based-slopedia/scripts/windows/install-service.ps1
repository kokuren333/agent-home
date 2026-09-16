param([string]$ServiceName = "EBSRuntime")
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$bot = Join-Path $root "automation\discord_bot"
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required." }
if (!(Test-Path (Join-Path $bot ".env"))) { throw "Create automation\discord_bot\.env from .env.example before installing." }
$action = New-ScheduledTaskAction -Execute "npm.cmd" -Argument "run start" -WorkingDirectory $bot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $ServiceName
& (Join-Path $PSScriptRoot "health-check.ps1")
