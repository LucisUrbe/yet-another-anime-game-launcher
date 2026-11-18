import { JSXElement } from "solid-js";
import { CommonUpdateProgram } from "./common-update-ui";
import { Config } from "./config";
import { Locale } from "./locale";
import type { SophonGame } from "./sophon/game";
import type { KeyStore } from "./utils";

export type ChannelClientInstallState = "INSTALLED" | "NOT_INSTALLED";

export interface ChannelClient {
  sophon?: SophonGame;
  installState: () => ChannelClientInstallState;
  installDir: () => string;
  /** Storage for this game's settings/state (scoped in the unified build). */
  store?: KeyStore;
  /** Game id (`server.id`) used for per-game defaults. */
  gameId?: string;
  /** Force close only this game's processes. */
  forceClose?: () => Promise<void>;
  /** Enables the shared DX12 toggle only when this client supports DX12 launch. */
  supportsD3d12?: boolean;

  showPredownloadPrompt: () => boolean;
  updateRequired: () => boolean;
  predownloadVersion: () => string;

  uiContent: {
    background?: string;
    background_video?: string;
    background_theme?: string;
    url: string;
    iconImage?: string;
    launchButtonLocation?: "left" | "right";
    logo?: string;
  };

  dismissPredownload(): void;

  update(): CommonUpdateProgram;
  install(path: string): CommonUpdateProgram;
  predownload(): CommonUpdateProgram;
  launch(config: Config): CommonUpdateProgram;
  checkIntegrity(): CommonUpdateProgram;
  init(config: Config): CommonUpdateProgram;
  createConfig(
    locale: Locale,
    config: Partial<Config>
  ): Promise<() => JSXElement>;
}
