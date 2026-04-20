const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';

export const SERVER_URL = WS_URL.replace(/^ws/, 'http');
export const WS_SERVER_URL = WS_URL;

export enum BuildEnv {
  Dev = 'dev',
  Beta = 'beta',
  Prod = 'prod',
}

export const BUILD_ENV: BuildEnv = (import.meta.env.VITE_ENV as BuildEnv) || BuildEnv.Dev;

export const SERVER_LABEL: Record<BuildEnv, string> = {
  [BuildEnv.Dev]: 'Local dev',
  [BuildEnv.Beta]: 'Beta Server — Frankfurt, DE',
  [BuildEnv.Prod]: 'EU West — Falkenstein, DE',
};
