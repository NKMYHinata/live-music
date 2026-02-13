$last = ""
# Output encoding fix for NodeJS
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

while ($true) {
    try {
        $proc = Get-Process cloudmusic -ErrorAction Stop
        # If multiple processes, pick the one with a title
        $p = $proc | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -First 1
        
        if ($p) {
            $current = $p.MainWindowTitle
            if ($current -ne $last) {
                Write-Output $current
                $last = $current
            }
        } else {
             # Running but no title (minimized to tray?)
        }
    } catch {
        # Not running
    }
    Start-Sleep -Milliseconds 500
}
