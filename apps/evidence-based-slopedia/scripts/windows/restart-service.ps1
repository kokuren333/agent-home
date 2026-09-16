param([string]$ServiceName = "EBSRuntime")
Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $ServiceName
