import { describe, expect, it } from "vitest";
import {
  scopedKey,
  bindStore,
  storeOf,
  globalStore,
  scopedStore,
} from "./store";
import { createMutex, wait } from "./helper";

describe("scoped storage", () => {
  it("prefixes keys with the game scope", () => {
    expect(scopedKey("hk4e_cn", "game_install_dir")).toBe(
      "hk4e_cn__game_install_dir"
    );
  });

  it("keeps every per-game key within Neutralino's key rules", () => {
    const keys = [
      "config_hk4e_enable_hdr",
      "config_resolution_height",
      "config_max_framerate_custom",
      "installed_jadeite_version",
      "config_monitor_refresh_rate_custom",
    ];
    for (const scope of ["hk4e_cn", "hkrpg_cn", "nap_cn"]) {
      for (const key of keys) expect(() => scopedKey(scope, key)).not.toThrow();
    }
    expect(() => scopedKey("hk4e_cn", "bad key")).toThrow();
    expect(() => scopedKey("hk4e_cn", "x".repeat(50))).toThrow();
  });

  it("finds the store bound to a config object", () => {
    const store = scopedStore("nap_cn");
    const config = bindStore({ a: 1 }, store);
    expect(storeOf(config)).toBe(store);
    expect(Object.keys(config)).toEqual(["a"]);
    expect(storeOf({})).toBe(globalStore);
    expect(storeOf(undefined)).toBe(globalStore);
  });
});

describe("createMutex", () => {
  it("runs sections one at a time, even after a failure", async () => {
    const run = createMutex();
    const events: string[] = [];
    const section = (name: string, ms: number, fail = false) =>
      run(async () => {
        events.push(`${name}:start`);
        await wait(ms);
        events.push(`${name}:end`);
        if (fail) throw new Error(name);
      });
    const results = await Promise.allSettled([
      section("a", 20, true),
      section("b", 5),
      section("c", 1),
    ]);
    expect(results.map(r => r.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(events).toEqual([
      "a:start",
      "a:end",
      "b:start",
      "b:end",
      "c:start",
      "c:end",
    ]);
  });
});
