import { describe, expect, it } from "vitest";
import { matchInstancePids, windowsDirMarker } from "./instance";

// Shape captured from `ps -axww -o pid=,command=` with two games in one prefix.
const PS = String.raw`
    1 /sbin/launchd
66864 /Users/me/Library/Application Support/Yaagl Unified/wine/lib/wine/../../bin/wineserver
66868 C:\windows\system32\services.exe
66870 C:\windows\system32\winedevice.exe
66887 C:\windows\system32\explorer.exe /desktop
67981 Z:\Volumes\P3\Games\Genshin Impact Game\YuanShen.exe
67982 Z:\Volumes\P3\Games\Genshin Impact Game\YuanShen_Data\ZFGameBrowser.exe --type=renderer
67983 C:\windows\system32\steam.exe Z:\Volumes\P3\Games\Genshin Impact Game\YuanShen.exe
67989 C:\windows\system32\cmd.exe /c Z:\Users\me\Library\Application Support\Yaagl Unified\config_nap_cn.bat
67991 Z:\Volumes\P3\Games\Zenless Zone Zero Game\ZenlessZoneZero.exe -screen-width 1920
67992 Z:\Volumes\P3\Games\Genshin Impact Game 2\YuanShen.exe
67993 /bin/zsh -c grep Genshin Impact Game\
67994 C:\windows\system32\conhost.exe --server 0x30 --headless
`;

const GI = [
  windowsDirMarker(String.raw`Z:\Volumes\P3\Games\Genshin Impact Game`),
  String.raw`Z:\Users\me\Library\Application Support\Yaagl Unified\config_hk4e_cn.bat`,
];
const ZZZ = [
  windowsDirMarker(String.raw`Z:\Volumes\P3\Games\Zenless Zone Zero Game\\`),
  String.raw`Z:\Users\me\Library\Application Support\Yaagl Unified\config_nap_cn.bat`,
];

describe("matchInstancePids", () => {
  it("selects only one game's processes, including its wrappers", () => {
    expect(matchInstancePids(PS, GI)).toEqual([67981, 67982, 67983]);
    expect(matchInstancePids(PS, ZZZ)).toEqual([67989, 67991]);
  });

  it("never matches shared Wine services or non-Wine processes", () => {
    const all = [...matchInstancePids(PS, GI), ...matchInstancePids(PS, ZZZ)];
    for (const pid of [1, 66864, 66868, 66870, 66887, 67993, 67994]) {
      expect(all).not.toContain(pid);
    }
  });

  it("does not match a sibling directory sharing the name prefix", () => {
    expect(matchInstancePids(PS, GI)).not.toContain(67992);
  });

  it("is case-insensitive and honours exclusions", () => {
    const upper = GI.map(marker => marker.toUpperCase());
    expect(matchInstancePids(PS, upper, [67982])).toEqual([67981, 67983]);
  });

  it("matches nothing without usable markers", () => {
    expect(matchInstancePids(PS, [])).toEqual([]);
    expect(matchInstancePids(PS, ["", "Z:\\"])).toEqual([]);
  });
});

describe("windowsDirMarker", () => {
  it("ends with exactly one backslash", () => {
    expect(windowsDirMarker("Z:\\Games\\Foo")).toBe("Z:\\Games\\Foo\\");
    expect(windowsDirMarker("Z:\\Games\\Foo\\\\")).toBe("Z:\\Games\\Foo\\");
  });
});
