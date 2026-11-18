import {
  exec as unixExec,
  exec2 as unixExec2,
  getKey,
  log,
  setKey,
  arrayFind,
  getCPUInfo,
  build,
  generateRandomString,
  stats,
  resolve,
  writeFile,
  removeFileIfExists,
  wait,
} from "@utils";
import { dirname, join } from "path-browserify";
import { WineDistribution } from "./distro";
import { matchInstancePids } from "./instance";

export async function createWine(options: {
  prefix: string;
  distro: WineDistribution;
  /**
   * Several games run in this prefix at the same time (unified build). Waits
   * and kills then target one game's processes instead of the wineserver.
   */
  sharedPrefix?: boolean;
}) {
  const sharedPrefix = options.sharedPrefix === true;
  const loaderBin = await getCorrectWineBinary();

  async function cmd(command: string, args: string[]) {
    return await exec("cmd", [command, ...args]);
  }

  async function exec(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await unixExec(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      withEnvironmentVariables(env),
      false,
      log_file
    );
  }

  async function exec2(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await unixExec2(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      withEnvironmentVariables(env),
      false,
      log_file
    );
  }

  async function waitUntilServerOff() {
    return await unixExec2([join(dirname(loaderBin), "wineserver"), "-w"], {
      ...getEnvironmentVariables(),
    });
  }

  async function killServer() {
    return await unixExec2([join(dirname(loaderBin), "wineserver"), "-k"], {
      ...getEnvironmentVariables(),
    });
  }

  /**
   * Let pending prefix changes (registry edits) settle before starting a game.
   * With a shared prefix the wineserver may be serving other running games, so
   * waiting for it to exit would block; its live state is already visible.
   */
  async function settle() {
    if (sharedPrefix) return;
    await waitUntilServerOff();
  }

  async function listInstancePids(markers: string[]) {
    // Polled while a game runs: bypass exec() so the log is not flooded.
    const { stdOut, exitCode } = await Neutralino.os.execCommand(
      "/bin/ps -axww -o pid=,command="
    );
    if (exitCode !== 0) throw new Error(`ps failed with code ${exitCode}`);
    return matchInstancePids(stdOut, markers);
  }

  /** Wait until the game session identified by `markers` has fully exited. */
  async function waitForInstance(markers: string[], pollMs = 2000) {
    if (!sharedPrefix) {
      await waitUntilServerOff();
      return;
    }
    // Give a launcher process a moment to spawn the real game.
    await wait(pollMs);
    while ((await listInstancePids(markers)).length > 0) {
      await wait(pollMs);
    }
  }

  /** Force close one game session, leaving other games in the prefix alone. */
  async function killInstance(markers: string[]) {
    if (!sharedPrefix) {
      await killServer();
      return;
    }
    const pids = await listInstancePids(markers);
    await log(`Force closing instance [${markers.join(" | ")}]: ${pids}`);
    if (pids.length > 0) {
      await unixExec(["kill", "-9", ...pids.map(String)]).catch(e =>
        log(String(e))
      );
    }
  }

  async function runRegistryScript(cmd: string) {
    // Unique name: games starting concurrently must not clobber each other.
    const script = resolve(`winedrv_config_${generateRandomString(8)}.bat`);
    await writeFile(script, cmd);
    try {
      await exec("cmd", ["/c", `${toWinePath(script)}`], {}, "/dev/null");
    } finally {
      await removeFileIfExists(script);
    }
    await settle();
  }

  function toWinePath(absPath: string) {
    return "Z:" + `${absPath}`.replaceAll("/", "\\");
  }

  const useMsync = options.distro.attributes.supportsMsync === true;

  function getEnvironmentVariables(): { [key: string]: string } {
    return {
      WINEDEBUG: "fixme-all,err-unwind,+timestamp",
      WINEPREFIX: options.prefix,
      ...(useMsync ? { WINEMSYNC: "1" } : {}),
    };
  }

  /**
   * The wineserver and all of its clients must agree on the sync mechanism,
   * otherwise ntdll aborts ("Server is running with WINEMSYNC but this
   * process is not"). With MSync, it is used for every process of the prefix
   * (registry scripts, wineserver -k/-w, all games of a shared prefix), and a
   * per-call WINEESYNC request is dropped.
   */
  function withEnvironmentVariables(env?: { [key: string]: string }) {
    const merged = { ...getEnvironmentVariables(), ...(env ?? {}) };
    if (useMsync) {
      merged.WINEMSYNC = "1";
      delete merged.WINEESYNC;
    }
    return merged;
  }

  async function openCmdWindow({ gameDir }: { gameDir: string }) {
    return await unixExec2(
      [
        `osascript`,
        "-e",
        [
          "tell",
          "app",
          '"Terminal"',
          "to",
          "do",
          "script",
          `"${build([loaderBin, "cmd"], {
            ...getEnvironmentVariables(),
            WINEPATH: toWinePath(gameDir),
          })
            .replaceAll("\\", "\\\\")
            .replaceAll('"', '\\"')}"`,
        ].join(" "),
        "-e",
        ["tell", "app", '"Terminal"', "to", "activate"].join(" "),
      ],
      {},
      false,
      "/dev/null"
    );
  }

  let netbiosname: string;
  try {
    netbiosname = await getKey("wine_netbiosname");
  } catch {
    netbiosname = `DESKTOP-${generateRandomString(7)}`; // exactly 15 chars
    await setKey("wine_netbiosname", netbiosname);
  }

  async function setProps(props: { retina: boolean; leftCmd: boolean }) {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v RetinaMode /t REG_SZ /d ${
      props.retina ? "y" : "n"
    } /f
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v LeftCommandIsCtrl /t REG_SZ /d ${
      props.leftCmd ? "y" : "n"
    } /f
`;
    await runRegistryScript(cmd);
  }

  async function setNVExtension() {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /t REG_SZ /d "C:\\Windows\\System32" /f
`;
    await runRegistryScript(cmd);
  }

  return {
    exec,
    exec2,
    waitUntilServerOff,
    killServer,
    settle,
    waitForInstance,
    killInstance,
    sharedPrefix,
    cmd,
    toWinePath,
    prefix: options.prefix,
    openCmdWindow,
    setProps,
    setNVExtension,
    attributes: {
      ...options.distro.attributes,
    },
  };
}

export async function getCorrectWineBinary() {
  try {
    // use wine64 if it is presented
    // in newer version of wine (esp. WoW64 mode), only one binary `bin/wine` exists
    await stats("./wine/bin/wine64");
    return resolve("./wine/bin/wine64");
  } catch {
    return resolve("./wine/bin/wine");
  }
}

export type Wine = ReturnType<typeof createWine> extends Promise<infer T>
  ? T
  : never;
