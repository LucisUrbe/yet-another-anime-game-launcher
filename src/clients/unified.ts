// Channel module for the unified build (YAAGL_CHANNEL_CLIENT=unified): one
// launcher hosting the CN clients of hk4e, hkrpg and nap on one shared Wine
// runtime and prefix. The per-game clients are created by launcher/unified.tsx.
import s from "../assets/Nahida.cr.png";
import type { CreateClientOptions } from "./shared";

export const DEFAULT_WINE_DISTRO_URL =
  "https://github.com/yaagl/anime-game-wine/releases/download/wine-crossover-11.0-1-signed/wine-crossover-11.0-1-osx64-signed.tar.xz";
export const DEFAULT_WINE_DISTRO_TAG = "11.0-1-crossover-signed-experimental";

export const UPDATE_UI_IMAGE = s;

// Kept for module-shape compatibility with the single-game channel modules.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createClient(_options: CreateClientOptions): never {
  throw new Error("The unified build creates its clients in launcher/unified");
}
