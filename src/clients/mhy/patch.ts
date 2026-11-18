import { gt } from "semver";
import { dirname, join } from "path-browserify";
import { CommonUpdateProgram } from "@common-update-ui";
import { Server } from "@constants";
import {
  writeBinary,
  forceMove,
  removeFile,
  log,
  cp,
  resolve,
  removeFileIfExists,
  fileOrDirExists,
  mkdirp,
  xdelta3,
  cpIfChanged,
  createMutex,
  gameStore,
} from "@utils";
import { Config } from "@config";
import { disableUnityFeature } from "./unity";
import { Wine } from "@wine";
import { DXMT_FILES, DXVK_FILES } from "src/downloadable-resource";

export async function putLocal(url: string, dest: string) {
  return await writeBinary(dest, await (await fetch(url)).arrayBuffer());
}

/**
 * The Wine runtime (and, in the unified build, the prefix) is shared by every
 * game this launcher process starts. Games that are mid-session hold the
 * shared DXMT swap; it is only reverted when the last one finishes.
 */
const activeSessions = new Set<string>();
const sharedRuntimeLock = createMutex();

async function applySharedRuntimePatch(server: Server, system32Dir: string) {
  await sharedRuntimeLock(async () => {
    activeSessions.add(server.id);
    for (const f of DXMT_FILES) {
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      // A leftover .bak already holds the original builtin; keep it.
      if (!(await fileOrDirExists(wineLibPath + ".bak"))) {
        await forceMove(wineLibPath, wineLibPath + ".bak");
      }
      await cpIfChanged(`./dxmt/${f}`, wineLibPath);
    }

    // winemetal files always go to Wine lib directories
    await cpIfChanged(
      `./dxmt/winemetal.dll`,
      resolve("./wine/lib/wine/x86_64-windows/winemetal.dll")
    );
    await cpIfChanged(
      `./dxmt/winemetal.so`,
      resolve("./wine/lib/wine/x86_64-unix/winemetal.so")
    );

    // winemetal.dll also to system32 for both native and builtin
    await cpIfChanged(
      `./dxmt/winemetal.dll`,
      join(system32Dir, "winemetal.dll")
    );

    if (server.id.startsWith("hkrpg")) {
      await cpIfChanged(
        `./dxmt/nvngx.dll`,
        resolve("./wine/lib/wine/x86_64-windows/nvngx.dll")
      );
      await cpIfChanged(`./dxmt/nvngx.dll`, join(system32Dir, "nvngx.dll"));
    }
  });
}

async function revertSharedRuntimePatch(server: Server) {
  await sharedRuntimeLock(async () => {
    activeSessions.delete(server.id);
    if (activeSessions.size > 0) {
      await log(
        `Keeping DXMT in the shared Wine runtime: still used by ${[
          ...activeSessions,
        ].join(", ")}`
      );
      return;
    }
    for (const f of DXMT_FILES) {
      const wineLibPath = resolve(`./wine/lib/wine/x86_64-windows/${f}`);
      if (await fileOrDirExists(wineLibPath + ".bak")) {
        await forceMove(wineLibPath + ".bak", wineLibPath);
      }
    }
  });
}

export async function* patchProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config
): CommonUpdateProgram {
  const store = gameStore(server.id);
  if ((await store.getKeyOrDefault("patched", "NOTFOUND")) != "NOTFOUND") {
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      if (file.tag === "workaround3" && config.workaround3) continue;
      await forceMove(
        join(gameDir, file.file),
        join(gameDir, file.file + ".bak")
      );
      await putLocal(file.diffUrl, join(gameDir, file.file + ".diff"));
      await xdelta3(
        join(gameDir, file.file + ".bak"),
        join(gameDir, file.file + ".diff"),
        join(gameDir, file.file)
      );
      await log("patched " + file.file);
      await removeFile(join(gameDir, file.file + ".diff"));
    }
    for (const { file, tag } of server.removed) {
      if (tag === "workaround3" && config.workaround3) continue;
      if (await fileOrDirExists(join(gameDir, file))) {
        await forceMove(join(gameDir, file), join(gameDir, file + ".bak"));
      }
    }
    for (const file of server.added) {
      await mkdirp(join(gameDir, dirname(file.file)));
      await putLocal(file.url, join(gameDir, file.file));
    }
  }

  const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
  const syswow64Dir = join(wine.prefix, "drive_c", "windows", "syswow64");

  if (wine.attributes.renderBackend == "dxmt") {
    await applySharedRuntimePatch(server, system32Dir);
  }

  if (config.reshade && wine.attributes.renderBackend == "dxmt") {
    await cp(resolve("./reshade/dxgi.dll"), join(gameDir, "dxgi.dll"));
    await cp(
      resolve("./reshade/d3dcompiler_47.dll"),
      join(gameDir, "d3dcompiler_47.dll")
    );
  }

  if (!server.id.startsWith("hkrpg")) {
    await cpIfChanged(
      resolve("./sidecar/protonextras/steam64.exe"),
      join(system32Dir, "steam.exe")
    );
    await cpIfChanged(
      resolve("./sidecar/protonextras/steam32.exe"),
      join(syswow64Dir, "steam.exe")
    );
    await cpIfChanged(
      resolve("./sidecar/protonextras/lsteamclient64.dll"),
      join(system32Dir, "lsteamclient.dll")
    );
    await cpIfChanged(
      resolve("./sidecar/protonextras/lsteamclient32.dll"),
      join(syswow64Dir, "lsteamclient.dll")
    );
  }

  await store.setKey("patched", "1");
}

export async function* patchRevertProgram(
  gameDir: string,
  wine: Wine,
  server: Server,
  config: Config
): CommonUpdateProgram {
  const store = gameStore(server.id);
  try {
    await store.getKey("patched");
  } catch {
    return;
  }
  if (!config.patchOff) {
    for (const file of server.patched) {
      if (await fileOrDirExists(join(gameDir, file.file + ".bak"))) {
        await forceMove(
          join(gameDir, file.file + ".bak"),
          join(gameDir, file.file)
        );
      }
    }
    for (const { file } of server.removed) {
      if (await fileOrDirExists(join(gameDir, file + ".bak"))) {
        await forceMove(join(gameDir, file + ".bak"), join(gameDir, file));
      }
    }
    for (const file of server.added) {
      if (await fileOrDirExists(join(gameDir, file.file))) {
        await removeFile(join(gameDir, file.file));
      }
    }
  }

  if (wine.attributes.renderBackend == "dxmt") {
    await revertSharedRuntimePatch(server);
  }
  if (config.reshade && wine.attributes.renderBackend == "dxmt") {
    await removeFileIfExists(join(gameDir, "dxgi.dll"));
    await removeFileIfExists(join(gameDir, "d3dcompiler_47.dll"));
  }
  await store.setKey("patched", null);
}
