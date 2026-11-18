import { join } from "path-browserify";
import { CommonUpdateProgram } from "@common-update-ui";
import { Server } from "@constants";
import {
  mkdirp,
  removeFile,
  writeBinary,
  writeFile,
  readBinary,
  resolve,
  utf16le,
  log,
  exec,
  getKeyOrDefault,
  resolvePreferredMaxFrameRate,
} from "@utils";
import { Wine } from "@wine";
import { Config } from "@config";
import { putLocal, patchProgram, patchRevertProgram } from "../patch";
import {
  instanceMarkers,
  launchScriptPath,
  networkBlockScript,
} from "../instance";
import { HKRPG_CN_BLOCK_URL, HKRPG_OS_BLOCK_URL } from "../../secret";
import { gt } from "semver";

export async function* launchGameProgram({
  gameDir,
  gameExecutable,
  wine,
  config,
  server,
}: {
  gameDir: string;
  gameExecutable: string;
  wine: Wine;
  config: Config;
  server: Server;
}): CommonUpdateProgram {
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "PATCHING"];

  await fixWebview(wine, server);
  await wine.setProps(config);
  if (wine.attributes.renderBackend == "dxmt") await wine.setNVExtension();

  const cmd = `@echo off
cd "%~dp0"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(resolve("./jadeite/jadeite.exe"))}" "${wine.toWinePath(
    join(gameDir, gameExecutable)
  )}"`;
  await writeFile(launchScriptPath(server), cmd);
  yield* patchProgram(gameDir, wine, server, config);
  const markers = instanceMarkers(wine, server, gameDir);
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  try {
    yield ["setStateText", "GAME_RUNNING"];
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      const blockUrl =
        server.id == "hkrpg_global" ? HKRPG_OS_BLOCK_URL : HKRPG_CN_BLOCK_URL;
      const block = networkBlockScript(server, blockUrl, 15);
      const tmpScriptPath = block.path;
      await writeFile(tmpScriptPath, block.content);
      await exec(
        [
          "osascript",
          "-e",
          `do shell script "source ${tmpScriptPath} > /dev/null 2>&1 &" with administrator privileges`,
        ],
        {},
        false
      );
    }

    const preferredMaxFrameRate = await resolvePreferredMaxFrameRate(config);
    await wine.exec2(
      "cmd",
      ["/c", `${wine.toWinePath(launchScriptPath(server))}`],
      {
        MTL_HUD_ENABLED: config.metalHud ? "1" : "0",
        WINEDLLOVERRIDES: "",
        ...(wine.attributes.renderBackend == "dxmt"
          ? {
              WINEMSYNC: "1",
              DXMT_LOG_PATH: yaaglDir,
              DXMT_CONFIG: [
                ...(preferredMaxFrameRate > 0
                  ? [`d3d11.preferredMaxFrameRate=${preferredMaxFrameRate}`]
                  : []),
                "dxgi.customVendorId=10de",
                "dxgi.customDeviceId=2684",
              ].join(";"),
              DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
              DXMT_ENABLE_NVEXT: "1",
              GST_PLUGIN_FEATURE_RANK: "atdec:MAX,avdec_h264:MAX",
            }
          : {
              WINEESYNC: "1",
            }),
        ...(config.proxyEnabled
          ? {
              HTTP_PROXY: config.proxyHost,
              HTTPS_PROXY: config.proxyHost,
            }
          : {}),
      },
      logfile
    );
    await wine.waitForInstance(markers);
  } catch (e: unknown) {
    // it seems game crashed?
    await log(String(e));
    if (wine.sharedPrefix) {
      // The wrapper failed or was killed; the game itself may still run.
      await wine.waitForInstance(markers).catch(err => log(String(err)));
    }
  }

  await removeFile(launchScriptPath(server));
  yield ["setStateText", "REVERT_PATCHING"];
  yield* patchRevertProgram(gameDir, wine, server, config);
}

async function fixWebview(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\";
  if (server.id === "hkrpg_cn") {
    key +=
      "\x6d\x69\x48\x6f\x59\x6f\\\u5d29\u574f\uff1a\u661f\u7a79\u94c1\u9053";
  } else if (server.id === "hkrpg_global") {
    key +=
      "\x43\x6f\x67\x6e\x6f\x73\x70\x68\x65\x72\x65\\\x53\x74\x61\x72\x20\x52\x61\x69\x6c";
  } else {
    return;
  }

  const reg = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"MIHOYOSDK_WEBVIEW_RENDER_METHOD_h1573598267"=-`,
  ];

  try {
    await wine.exec(
      "reg",
      ["query", key],
      {},
      resolve(`fix_webview_${server.id}.log`)
    );

    // the output contains malformed CJK characters
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(
      await readBinary(resolve(`fix_webview_${server.id}.log`))
    );

    for (let line of output.split("\n")) {
      line = line.trim();
      if (line.startsWith("HOYO_WEBVIEW_RENDER_METHOD_ABTEST_")) {
        const abtest = line.split(" ", 2)[0];
        reg.push(`"${abtest}"=-`);
      }
    }
  } catch (e: unknown) {
    return;
  }

  await writeBinary(
    resolve(`fix_webview_${server.id}.reg`),
    utf16le(reg.join("\r\n"))
  );
  await wine.exec(
    "reg",
    ["import", `${wine.toWinePath(resolve(`./fix_webview_${server.id}.reg`))}`],
    {},
    "/dev/null"
  );
}
