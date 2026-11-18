import { getKey, getKeyOrDefault, setKey } from "./neu";

/**
 * Key/value storage used by settings and per-game state.
 *
 * Single-game builds keep using the global (unprefixed) Neutralino storage, so
 * existing installations keep their settings. The unified build hosts several
 * games in one data directory and therefore namespaces per-game keys.
 */
export interface KeyStore {
  readonly scope: string | undefined;
  getKey(key: string): Promise<string>;
  getKeyOrDefault(key: string, defaultValue: string): Promise<string>;
  setKey(key: string, value: string | null): Promise<unknown>;
}

export const IS_UNIFIED_BUILD =
  import.meta.env["YAAGL_CHANNEL_CLIENT"] === "unified";

export const globalStore: KeyStore = {
  scope: undefined,
  getKey,
  getKeyOrDefault,
  setKey,
};

/** Neutralino storage keys must match ^[a-zA-Z-_0-9]{1,50}$. */
export function scopedKey(scope: string, key: string) {
  const scoped = `${scope}__${key}`;
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(scoped)) {
    throw new Error(`Invalid scoped storage key: ${scoped}`);
  }
  return scoped;
}

export function scopedStore(scope: string): KeyStore {
  return {
    scope,
    getKey: key => getKey(scopedKey(scope, key)),
    getKeyOrDefault: (key, defaultValue) =>
      getKeyOrDefault(scopedKey(scope, key), defaultValue),
    setKey: (key, value) => setKey(scopedKey(scope, key), value),
  };
}

/** Storage for one game (`server.id`): scoped in the unified build only. */
export function gameStore(gameId: string): KeyStore {
  return IS_UNIFIED_BUILD ? scopedStore(gameId) : globalStore;
}

const STORE = Symbol("yaagl.store");

/** Attach a store to a per-game config object so its settings UI uses it. */
export function bindStore<T extends object>(target: T, store: KeyStore): T {
  Object.defineProperty(target, STORE, {
    value: store,
    enumerable: false,
    configurable: true,
  });
  return target;
}

export function storeOf(target: object | undefined): KeyStore {
  return (target as { [STORE]?: KeyStore } | undefined)?.[STORE] ?? globalStore;
}
