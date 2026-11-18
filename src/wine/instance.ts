/**
 * Identify the Wine processes that belong to one game session.
 *
 * Wine rewrites each process' argv area with the Windows image path and
 * arguments (e.g. `Z:\Games\Foo\Foo.exe -arg`), so environment markers are not
 * visible to `ps`. A session is instead recognised by its markers: the game's
 * install directory (as a Windows path, ending in a backslash) and the batch
 * file used to start it. Wrappers such as `cmd.exe /c <bat>`, `steam.exe
 * <game exe>` or `jadeite.exe <game exe>` match as well, while shared system
 * processes (wineserver, services.exe, winedevice.exe, explorer.exe, ...) do not.
 */
export function matchInstancePids(
  psOutput: string,
  markers: string[],
  excludePids: number[] = []
): number[] {
  const needles = markers
    .map(marker => marker.trim().toLowerCase())
    .filter(marker => marker.length > 3);
  if (needles.length === 0) return [];
  const pids: number[] = [];
  for (const rawLine of psOutput.split("\n")) {
    const line = rawLine.trim();
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 1 || excludePids.includes(pid))
      continue;
    const command = match[2].toLowerCase();
    // Only Wine processes carry DOS-style image paths.
    if (!/^[a-z]:\\/.test(command)) continue;
    if (needles.some(needle => command.includes(needle))) pids.push(pid);
  }
  return pids;
}

/** Windows path of a directory, normalised to end with a single backslash. */
export function windowsDirMarker(winePath: string) {
  return winePath.replace(/\\+$/, "") + "\\";
}
