import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import type { Component } from "solid-js";
import { Aria2 } from "@aria2";
import { Locale } from "@locale";
import { Wine } from "@wine";
import { getKeyOrDefault, setKey } from "@utils";
import { Github } from "../github";
import { ChannelClient } from "../channel-client";
import { createLauncher } from ".";
import { createClient as createHK4EClient } from "../clients/hk4ecn";
import { createClient as createHKRPGClient } from "../clients/hkrpgcn";
import { createClient as createNAPClient } from "../clients/napcn";
import type { CreateClientOptions } from "../clients/shared";
import paimon from "../icons/Paimon.cr.png";
import march7th from "../icons/March7th.cr.png";
import bangboo from "../icons/ZZZ_Bang.cr.png";

interface UnifiedGame {
  /** `server.id`; also the storage scope of the game's settings. */
  id: string;
  label: string;
  icon: string;
  create: (options: CreateClientOptions) => Promise<ChannelClient>;
}

const GAMES: UnifiedGame[] = [
  { id: "hk4e_cn", label: "GI", icon: paimon, create: createHK4EClient },
  { id: "hkrpg_cn", label: "HSR", icon: march7th, create: createHKRPGClient },
  { id: "nap_cn", label: "ZZZ", icon: bangboo, create: createNAPClient },
];

const ACTIVE_GAME_KEY = "unified_active_game";

/**
 * One window hosting several games. Every game keeps its own launcher (task
 * queue, settings, Sophon state) mounted, so a game can keep running or
 * downloading while another one is shown or launched.
 */
export async function createUnifiedLauncher({
  wine,
  aria2,
  locale,
  github,
  onCheckUpdate,
}: {
  wine: Wine;
  aria2: Aria2;
  locale: Locale;
  github: Github;
  onCheckUpdate: () => void;
}): Promise<Component> {
  const saved = await getKeyOrDefault(ACTIVE_GAME_KEY, GAMES[0].id);
  const [activeId, setActiveId] = createSignal(
    GAMES.some(game => game.id === saved) ? saved : GAMES[0].id
  );
  const [running, setRunning] = createStore<Record<string, boolean>>({});

  const entries: Array<UnifiedGame & { Launcher: Component }> = [];
  for (const game of GAMES) {
    const channelClient = await game.create({ wine, aria2, locale });
    const Launcher = await createLauncher({
      wine,
      locale,
      github,
      channelClient,
      onCheckUpdate,
      active: () => activeId() === game.id,
      onRunningChange: value => setRunning(game.id, value),
    });
    entries.push({ ...game, Launcher });
  }

  function select(id: string) {
    setActiveId(id);
    setKey(ACTIVE_GAME_KEY, id).catch(() => undefined);
  }

  return function UnifiedLauncher() {
    return (
      <>
        <For each={entries}>
          {entry => (
            <div
              class="unified-game"
              style={{ display: activeId() === entry.id ? "block" : "none" }}
            >
              <entry.Launcher />
            </div>
          )}
        </For>
        <nav class="game-rail" aria-label="Games">
          <For each={entries}>
            {entry => (
              <button
                type="button"
                class="game-rail-item"
                classList={{ active: activeId() === entry.id }}
                aria-pressed={activeId() === entry.id}
                title={entry.label}
                onClick={() => select(entry.id)}
              >
                <img src={entry.icon} alt={entry.label} draggable={false} />
                <Show when={running[entry.id]}>
                  <span class="game-rail-running" aria-label="Running" />
                </Show>
              </button>
            )}
          </For>
        </nav>
      </>
    );
  };
}
