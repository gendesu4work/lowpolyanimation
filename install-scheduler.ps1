# Registers a Windows scheduled task that runs scripts/scheduler.js every 15 minutes while you're logged in.
# Run once:  powershell -ExecutionPolicy Bypass -File install-scheduler.ps1
# Remove:    Unregister-ScheduledTask -TaskName "ShortsAutomation" -Confirm:$false
$dir = $PSScriptRoot
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$dir\scripts\scheduler.js`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
Register-ScheduledTask -TaskName "ShortsAutomation" -Action $action -Trigger $trigger -Settings $settings -Description "Posts queued shorts to Instagram/TikTok and refreshes stats" -Force | Out-Null
Write-Host "Scheduled task 'ShortsAutomation' installed: runs every 15 minutes."
