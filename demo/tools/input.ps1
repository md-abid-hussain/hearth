# Mouse and spoken cues for recording the Hearth demo. Reads one command per line on stdin and
# answers "ok" (or "pos x y"). Coordinates are physical pixels; the process is per-monitor DPI aware.
#   pos X Y     move the cursor
#   down | up   press or release the left button
#   where       print the cursor position
#   cue TEXT    speak TEXT through the speakers (not recorded: the screen capture has no audio)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HearthInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
[void][HearthInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 0
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ', 2)
  switch ($parts[0]) {
    'pos' { $xy = $parts[1].Split(' '); [void][HearthInput]::SetCursorPos([int]$xy[0], [int]$xy[1]); [Console]::Out.WriteLine('ok') }
    'down' { [HearthInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); [Console]::Out.WriteLine('ok') }
    'up' { [HearthInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); [Console]::Out.WriteLine('ok') }
    'wheel' { [HearthInput]::mouse_event(0x0800, 0, 0, [uint32]([int]$parts[1] -band 0xFFFFFFFF), [UIntPtr]::Zero); [Console]::Out.WriteLine('ok') }
    'where' { $p = New-Object HearthInput+POINT; [void][HearthInput]::GetCursorPos([ref]$p); [Console]::Out.WriteLine("pos $($p.X) $($p.Y)") }
    'cue' { $voice.SpeakAsyncCancelAll(); [void]$voice.SpeakAsync($parts[1]); [Console]::Out.WriteLine('ok') }
    default { [Console]::Out.WriteLine("error unknown command $($parts[0])") }
  }
}
