# Windows Runtime

EBS uses its Core scheduler; Windows only starts and keeps the runtime alive. Copy `automation/discord_bot/.env.example` to `.env`, fill required secrets locally, then run PowerShell as an administrator:

```powershell
.\scripts\windows\install-service.ps1
```

The task starts at boot and retries three times with a two-minute interval. Use the companion start, stop, restart, status, uninstall, and health-check scripts in `scripts/windows/`.

The Core scheduler also owns daily backup cadence. It defaults to 03:30 JST and keeps 7 daily, 4 weekly, and 3 monthly recovery points. Override only when needed with `EBS_BACKUP_ENABLED`, `EBS_BACKUP_HOUR_JST`, `EBS_BACKUP_MINUTE_JST`, and the three `EBS_BACKUP_RETENTION_*` variables. Use `npm run ebs -- backup list --json` and `npm run ebs -- backup verify <id> --json` for operational checks; restore stages a verified candidate and never overwrites canonical state on its own.

Keep the notebook on AC power, prevent sleep while it is intended to run, configure lid-close behavior deliberately, and use a stable network. These are operator settings: EBS never changes power policy itself. Stop the service before intentional maintenance; startup performs reconciliation before scheduler admission.
