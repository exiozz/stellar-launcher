// Music control through Windows' media session (the panel that shows up with the volume keys).
// Works with Spotify, Deezer, browsers (YouTube…) and any app that registers with Windows.
// A small PowerShell helper stays open: it reports what is playing and runs commands instantly.
const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Namespace StellarM -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(3000); $task.Result }
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Gaming.Input.RawGameController, Windows.Gaming.Input, ContentType = WindowsRuntime]
$padPrev = @{}
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
function Key([byte]$vk) { [StellarM.K]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [StellarM.K]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) }
function Session { $s = $mgr.GetCurrentSession(); if (-not $s) { $s = @($mgr.GetSessions())[0] }; $s }
function Thumb($ref) {
  # Cover art is optional: any failure just means "no cover" (never blocks the title updates).
  try {
    if (-not $ref) { return $null }
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $stream -or $stream.Size -gt 600000) { return $null }
    $ms = New-Object IO.MemoryStream
    [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream).CopyTo($ms)
    $type = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
    'data:' + $type + ';base64,' + [Convert]::ToBase64String($ms.ToArray())
  } catch { $null }
}
$last = ''; $lastTrack = ''; $thumb = $null; $tick = 6
# [Console]::In blocks until a line arrives; a StreamReader on the raw stdin reads truly in the background.
$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput())
$read = $stdin.ReadLineAsync()
while ($true) {
  if ($read.IsCompleted) {
    $cmd = $read.Result
    if ($null -eq $cmd) { exit }   # Stellar closed: stop
    $s = Session
    switch ($cmd) {
      'toggle' { if ($s) { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) } else { Key 0xB3 } }
      'next'   { if ($s) { [void](Await ($s.TrySkipNextAsync()) ([bool])) } else { Key 0xB0 } }
      'prev'   { if ($s) { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) } else { Key 0xB1 } }
      'volup'  { Key 0xAF }
      'voldown'{ Key 0xAE }
      'mute'   { Key 0xAD }
    }
    $last = ''; $tick = 99
    $read = $stdin.ReadLineAsync()
  }
  # controllers: report every newly pressed button as {"pad":index}
  try {
    foreach ($c in [Windows.Gaming.Input.RawGameController]::RawGameControllers) {
      $b = New-Object bool[] $c.ButtonCount
      $sw = New-Object Windows.Gaming.Input.GameControllerSwitchPosition[] $c.SwitchCount
      $ax = New-Object double[] $c.AxisCount
      [void]$c.GetCurrentReading($b, $sw, $ax)
      $id = [string]$c.NonRoamableId
      $prev = $padPrev[$id]
      for ($i = 0; $i -lt $b.Length; $i++) {
        if ($b[$i] -and (-not $prev -or -not $prev[$i])) { [Console]::Out.WriteLine('{"pad":' + $i + '}'); [Console]::Out.Flush() }
      }
      $padPrev[$id] = $b
    }
  } catch {}
  if (++$tick -ge 14) {
    $tick = 0
    $s = Session
    $state = @{ app = ''; title = ''; artist = ''; album = ''; status = 'none'; thumb = $null }
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $state.app = $s.SourceAppUserModelId; $state.title = $p.Title; $state.artist = $p.Artist; $state.album = $p.AlbumTitle
      $state.status = [string]$s.GetPlaybackInfo().PlaybackStatus
      $track = "$($state.app)|$($state.title)|$($state.artist)"
      if ($track -ne $lastTrack) { $lastTrack = $track; $thumb = Thumb $p.Thumbnail }
      $state.thumb = $thumb
    }
    $key = "$($state.app)|$($state.title)|$($state.artist)|$($state.status)"
    if ($key -ne $last) { $last = $key; [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
  }
  Start-Sleep -Milliseconds 50
}`;

const COMMANDS = new Set(['toggle', 'next', 'prev', 'volup', 'voldown', 'mute']);

/** Starts the helper. onState({ app, title, artist, album, status, thumb }) on every change. */
function startMedia(onState, onPad = () => {}) {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const s = JSON.parse(line);
        if (Number.isInteger(s.pad)) {
          onPad(s.pad);
          continue;
        }
        onState({
          app: String(s.app || ''),
          title: String(s.title || ''),
          artist: String(s.artist || ''),
          album: String(s.album || ''),
          status: String(s.status || 'none'),
          thumb: typeof s.thumb === 'string' && /^data:image\/(jpeg|png|bmp|gif);base64,/.test(s.thumb) ? s.thumb : null,
        });
      } catch {
        /* partial or malformed line */
      }
    }
  });
  return {
    proc,
    command: (cmd) => {
      if (COMMANDS.has(cmd) && proc.stdin.writable) proc.stdin.write(cmd + '\n');
    },
    stop: () => {
      proc.stdin.end();
      proc.kill();
    },
  };
}

/** "Spotify.exe" / "Deezer…" / "chrome" -> a readable source name. */
function appLabel(id) {
  const s = String(id).toLowerCase();
  if (s.includes('spotify')) return 'Spotify';
  if (s.includes('deezer')) return 'Deezer';
  if (s.includes('applemusic') || s.includes('itunes')) return 'Apple Music';
  if (s.includes('soundcloud')) return 'SoundCloud';
  if (/chrome|msedge|firefox|opera|brave|vivaldi/.test(s)) return 'Navigateur';
  if (s.includes('zune') || s.includes('media')) return 'Lecteur Windows';
  return id ? String(id).replace(/\.exe$/i, '').split(/[!_.]/)[0] : '';
}

module.exports = { startMedia, appLabel };
