// Tracks which program owns the foreground window (Windows), via a small PowerShell
// helper that prints the process name whenever it changes. Used to play keyboard
// sounds only while the Roblox window is active.
const { spawn } = require('child_process');

const SCRIPT = (parentPid) => `
Add-Type -Namespace OrbitW -Name U -MemberDefinition '
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'
$last = ''; $i = 0
while ($true) {
  $p = 0
  [void][OrbitW.U]::GetWindowThreadProcessId([OrbitW.U]::GetForegroundWindow(), [ref]$p)
  $n = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
  if ($n -ne $last) { [Console]::Out.WriteLine($n); [Console]::Out.Flush(); $last = $n }
  if ((++$i % 25) -eq 0 -and -not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds 150
}`;

/**
 * Starts watching; calls onChange(processName) on every foreground change.
 * Returns a stop() function. The helper also exits by itself if this process dies.
 */
function watchForeground(onChange, parentPid = process.pid) {
  // -EncodedCommand (UTF-16LE base64) keeps the script's quotes intact on the command line.
  const encoded = Buffer.from(SCRIPT(parentPid), 'utf16le').toString('base64');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  proc.stdout.on('data', (buf) => {
    const lines = String(buf).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length) onChange(lines[lines.length - 1]);
  });
  return { proc, stop: () => proc.kill() };
}

module.exports = { watchForeground };
