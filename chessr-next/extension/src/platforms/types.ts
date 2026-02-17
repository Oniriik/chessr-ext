import { ComponentType } from 'react';

export type PlatformId = 'chesscom' | 'lichess';

export type RouteId =
  | 'game'
  | 'game-computer'
  | 'play-computer'
  | 'play-online'
  | 'analysis'
  | 'home'
  | 'unknown';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface MountPoint {
  id: string;
  route: RouteId | RouteId[];
  selector: string;
  position: 'before' | 'after' | 'prepend' | 'append';
  component: ComponentType<any>;
  props?: Record<string, unknown>;
  /** Styles to apply to the target element's parent */
  parentStyles?: Partial<CSSStyleDeclaration>;
}

export interface Platform {
  id: PlatformId;
  name: string;
  hostname: RegExp;
  detectRoute: (url: URL) => RouteId;
  getMountPoints: () => MountPoint[];
}

export interface PlatformContext {
  platform: Platform;
  route: RouteId;
  url: URL;
}
