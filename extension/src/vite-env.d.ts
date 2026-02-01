/**
 * Type definitions for environment variables injected by Webpack DefinePlugin
 */

declare namespace NodeJS {
  interface ProcessEnv {
    readonly STOCKFISH_SERVER_URL: string;
    readonly SUPABASE_URL: string;
    readonly SUPABASE_ANON_KEY: string;
    readonly PADDLE_ENVIRONMENT: string;
    readonly PADDLE_CLIENT_TOKEN: string;
    readonly API_BASE_URL: string;
    readonly NODE_ENV: 'development' | 'production';
  }
}
