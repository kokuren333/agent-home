param([string]$ServiceName = "EBSRuntime")
Stop-ScheduledTask -TaskName $ServiceName
