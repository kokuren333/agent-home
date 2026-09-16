param([string]$ServiceName = "EBSRuntime")
Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
