import { join } from "path-browserify";
import { Server } from "@constants";
import { resolve } from "@utils";
import { Wine, windowsDirMarker } from "@wine";

/** Per-game launch script, so concurrent games never share one file. */
export function launchScriptPath(server: Server) {
  return resolve(`./config_${server.id}.bat`);
}

/** Markers identifying this game's Wine processes (see matchInstancePids). */
export function instanceMarkers(wine: Wine, server: Server, gameDir: string) {
  return [
    windowsDirMarker(wine.toWinePath(join(gameDir))),
    wine.toWinePath(launchScriptPath(server)),
  ];
}

/**
 * Root script that briefly blocks `blockUrl` via /etc/hosts while the game
 * starts. Markers and script path are per game so concurrent games only ever
 * remove their own section.
 */
export function networkBlockScript(
  server: Server,
  blockUrl: string,
  seconds: number
) {
  const path = `/tmp/yaagl_network_block_script_${server.id}.sh`;
  const commands = [
    `#!/bin/sh`,

    `HOSTS_FILE="/etc/hosts"`,
    `ENTRY="0.0.0.0 ${blockUrl}"`,
    `PAD_START="# Temporarily Added by Yaagl ${server.id}"`,
    `PAD_END="# End of section"`,

    `if ! grep -qF "$ENTRY" "$HOSTS_FILE"; then`,
    `sudo bash -c "echo -e '$PAD_START\n$ENTRY\n$PAD_END' >> '/etc/hosts'"`,
    `fi`,
    `sleep ${seconds}`,
    `sudo sed -i.bak "/$PAD_START/,/$PAD_END/d" "$HOSTS_FILE"`,

    `rm ${path}`,
  ];
  return { path, content: commands.join("\n") };
}
