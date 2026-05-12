/**
 * RodentConfig — UCI options builder for Rodent IV.
 *
 * Mirrors KomodoConfig.ts. Server-side, Rodent runs as a native binary at
 * engines/{linux,macos}/rodent[-m1]. The binary is spawned with cwd set to
 * its own directory so it finds personalities/ and books/ as siblings.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RodentConfigParams {
  /** Target ELO 800..2800. Capped if out of range. Only active when
   *  limitStrength is true. */
  targetElo: number;
  /** Personality file stem (e.g. 'karpov', 'default'). `.txt` is appended
   *  automatically — the validation drops the extension if a caller passes
   *  one through. */
  personality: string;
  multiPv: number;
  /** 0..100 — mapped to Rodent's EvalBlur 0..200,000 via quadratic curve
   *  matching the WASM RodentSuggestionEngine. */
  imprecision?: number;
  /** When true (default), enable UCI_LimitStrength to honor targetElo. */
  limitStrength?: boolean;
}

/** Hash table size in MB. 64 is the sweet spot for ~1M-node searches. */
export const HASH_MB = 64;

/** Whether to use the opening book. Rodent's vendored books are deployed
 *  alongside the binary at engines/{platform}/books/. */
export const USE_BOOK = true;

/** Personalities directory — used to validate `personality` against the
 *  shipped set. Same path as the binary's cwd-relative `personalities/`. */
function getPersonalitiesDir(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') {
    return path.join(__dirname, '../../engines/macos/personalities');
  }
  return path.join(__dirname, '../../engines/linux/personalities');
}

/** Map a user-supplied personality stem to a valid filename. Falls back to
 *  'default' when the stem doesn't match a shipped personality. */
function resolvePersonality(stem: string | undefined): string {
  const base = (stem || 'default').toLowerCase().replace(/\.txt$/, '');
  // Allowlist comes from the WASM-side RODENT_PERSONALITIES — keep in sync.
  // (Hardcoded here to avoid pulling extension types into server code.)
  const KNOWN = new Set([
    'alekhine', 'anand', 'anderssen', 'botvinnik', 'fischer', 'karpov',
    'kasparov', 'kortchnoi', 'larsen', 'lasker', 'marshall', 'morphy',
    'nimzowitsch', 'petrosian', 'reti', 'rubinstein', 'spassky',
    'steinitz', 'tal', 'tarrasch', 'topalov',
    'default', 'defender', 'dynamic', 'partisan', 'pawnsacker', 'simple',
    'spitfire', 'strangler', 'swapper',
    'amanda', 'ampere', 'bosboom', 'cloe', 'deborah', 'grumpy', 'pedrita',
    'preston',
  ]);
  return KNOWN.has(base) ? base : 'default';
}

/** Compute EvalBlur from the 0..100 imprecision slider using a quadratic
 *  curve — matches the formula in
 *  extension/entrypoints/content/lib/rodentSuggestionEngine.ts so the WASM
 *  and server paths produce identical results.
 *  imprecision=0 → 0; 25 → 12500; 50 → 50000; 100 → 200000. */
function evalBlurFromImprecision(imprecision: number): number {
  const i = Math.max(0, Math.min(100, Math.round(imprecision)));
  return i * i * 20;
}

/** Produce the UCI option dict to send to Rodent before each search.
 *  EngineManager applies these via `setoption name X value Y`. */
export function getRodentConfig(params: RodentConfigParams): Record<string, string> {
  const elo = Math.max(800, Math.min(2800, params.targetElo || 1500));
  const pv = Math.max(1, Math.min(3, params.multiPv || 1));
  const limit = params.limitStrength !== false;
  const personality = resolvePersonality(params.personality);
  const blur = evalBlurFromImprecision(params.imprecision ?? 0);

  return {
    Hash: String(HASH_MB),
    MultiPV: String(pv),
    UCI_LimitStrength: limit ? 'true' : 'false',
    UCI_Elo: String(elo),
    PersonalityFile: `${personality}.txt`,
    EvalBlur: String(blur),
    UseBook: USE_BOOK ? 'true' : 'false',
  };
}
