/**
 * PatriciaSuggestionEngine — runs Patricia (Adam Kulju, MIT) in a Worker
 * built from a Blob URL (CSP-safe — same trick as SuggestionEngine for
 * Komodo Dragon).
 *
 * Patricia exposes itself to JS through two emscripten exports:
 *   wasm_init()         — one-shot initialiser
 *   wasm_command(line)  — feed one UCI command, results flow to Module.print
 *
 * Strength tuning is done via Patricia's `Skill_Level` UCI option (1..21),
 * which maps to predefined ELO targets:
 *   1=500  2=800  3=1000  4=1200  5=1300  6=1400  7=1500  8=1600
 *   9=1700 10=1800 11=1900 12=2000 13=2100 14=2200 15=2300 16=2400
 *   17=2500 18=2650 19=2800 20=3000 21=full strength
 */

import { buildGoCommand, type SearchOptions } from './searchOptions';
import { labelSuggestions, type LabeledSuggestion, type Suggestion } from './engineLabeler';
import type { IEngine, SuggestionSearchParams } from './engineApi';
import type { EngineCapabilities } from '../stores/engineStore';

const HASH_MB = 32;
const SEARCH_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 10_000;

// Patricia advertises only Hash/Threads/SyzygyPath/MultiPV/Skill_Level/UCI_Chess960.
// No personality/dynamism/king-safety/variety — surface what's actually tunable.
const PATRICIA_CAPABILITIES: EngineCapabilities = {
  hasPersonality: false, hasUciElo: true, hasDynamism: false,
  hasKingSafety: false, hasVariety: false,
};

export const PATRICIA_ELO_LEVELS: number[] = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

const SKILL_LEVELS = PATRICIA_ELO_LEVELS;

/** Snap an arbitrary ELO to the nearest Patricia skill-level palier. */
export function snapToPatriciaElo(elo: number): number {
  let best = PATRICIA_ELO_LEVELS[0];
  let bestDelta = Math.abs(best - elo);
  for (const v of PATRICIA_ELO_LEVELS) {
    const d = Math.abs(v - elo);
    if (d < bestDelta) { best = v; bestDelta = d; }
  }
  return best;
}

/**
 * Map a target ELO to Patricia's Skill_Level (1..21).
 *   - ELO ≥ 3000 OR `limitStrength` off → 21 (full strength).
 *   - Otherwise → index of the closest predefined level.
 */
function eloToSkillLevel(elo: number, limit: boolean): number {
  if (!limit || elo >= 3000) return 21;
  let bestIdx = 0;
  let bestDelta = Math.abs(SKILL_LEVELS[0] - elo);
  for (let i = 1; i < SKILL_LEVELS.length; i++) {
    const d = Math.abs(SKILL_LEVELS[i] - elo);
    if (d < bestDelta) { bestDelta = d; bestIdx = i; }
  }
  return bestIdx + 1; // 1-indexed
}

interface PendingResults {
  byPv: Map<number, Suggestion>;
}

function parseInfoLine(line: string): Suggestion | null {
  // Example:
  //   info multipv 1 depth 14 seldepth 27 score cp 25 nodes 164758 nps 1539794
  //   tbhits 0 time 107 pv e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f1c4 g8f6
  const tokens = line.split(/\s+/);
  let multipv = 1, depth = 0, evaluation = 0, mateScore: number | null = null;
  const pv: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'multipv') { multipv = parseInt(tokens[++i], 10); }
    else if (t === 'depth') { depth = parseInt(tokens[++i], 10); }
    else if (t === 'score') {
      const kind = tokens[++i];
      const v = parseInt(tokens[++i], 10);
      if (kind === 'cp') evaluation = v;
      else if (kind === 'mate') mateScore = v;
    }
    else if (t === 'pv') { pv.push(...tokens.slice(i + 1)); break; }
    i++;
  }
  if (!pv.length) return null;
  return {
    multipv,
    move: pv[0],
    evaluation,
    depth,
    winRate: 0,        // Patricia doesn't emit WDL — left at 0 for the UI.
    drawRate: 0,
    lossRate: 0,
    mateScore,
    pv,
  };
}

export class PatriciaSuggestionEngine implements IEngine {
  readonly id = 'patricia' as const;
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private _ready = false;
  private _supportedOptions: Set<string> = new Set();

  private activeResolve: ((s: LabeledSuggestion[]) => void) | null = null;
  private activeReject: ((e: Error) => void) | null = null;
  private activeListener: ((e: MessageEvent) => void) | null = null;
  private activeFen: string | null = null;
  private activeMultiPv = 1;
  private activeTimer: ReturnType<typeof setTimeout> | null = null;
  private activeResults: PendingResults | null = null;

  get ready(): boolean { return this._ready; }
  getCapabilities(): EngineCapabilities { return PATRICIA_CAPABILITIES; }

  async init(): Promise<void> {
    const jsUrl = browser.runtime.getURL('/engine/patricia.js');
    const wasmUrl = browser.runtime.getURL('/engine/patricia.wasm');

    // Fetch the glue JS, append a worker bootstrap that imports it via
    // ccall and bridges UCI lines to/from the main thread via postMessage.
    const res = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: new URL(jsUrl).pathname,
    }) as { text?: string; error?: string };
    if (res.error || !res.text) {
      throw new Error(`Failed to fetch patricia.js: ${res.error}`);
    }

    const bootstrap = `
      ${res.text}
      // The above evaluates the emscripten MODULARIZE factory into 'Module'.
      const PATRICIA_WASM_URL = ${JSON.stringify(wasmUrl)};
      let cmd = null;
      const lines = [];
      let flushTimer = null;
      function flush() {
        if (lines.length) postMessage(lines.splice(0));
        flushTimer = null;
      }
      function dispatchLine(line) {
        lines.push(line);
        if (!flushTimer) flushTimer = setTimeout(flush, 0);
      }
      Module({
        locateFile: (path) => path.endsWith('.wasm') ? PATRICIA_WASM_URL : path,
        print:    dispatchLine,
        printErr: dispatchLine,
      }).then((mod) => {
        cmd = mod.cwrap('wasm_command', null, ['string']);
        const init = mod.cwrap('wasm_init', null, []);
        init();
        flush();
        postMessage({ __ready: true });
      });
      onmessage = (e) => {
        if (cmd && typeof e.data === 'string') {
          cmd(e.data);
          flush();
        }
      };
    `;

    const blob = new Blob([bootstrap], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl);

    // Wait for the worker to confirm it's loaded.
    await this.withTimeout(new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data && e.data.__ready) {
          this.worker!.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMsg);
    }), INIT_TIMEOUT_MS, 'patricia bootstrap timeout');

    // UCI handshake — collect supported options and verify uciok.
    await this.withTimeout(new Promise<void>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const lines: string[] = Array.isArray(e.data) ? e.data : [];
        for (const line of lines) {
          if (line.startsWith('option name ')) {
            const m = line.match(/^option name (.+?) type /);
            if (m) this._supportedOptions.add(m[1]);
          } else if (line.includes('uciok')) {
            this.worker!.removeEventListener('message', onMsg);
            resolve();
            return;
          }
        }
      };
      this.worker!.addEventListener('message', onMsg);
      this.send('uci');
    }), INIT_TIMEOUT_MS, 'patricia uci timeout');

    if (this._supportedOptions.has('Hash')) {
      this.send(`setoption name Hash value ${HASH_MB}`);
    }
    if (this._supportedOptions.has('Threads')) {
      this.send('setoption name Threads value 1');
    }

    // Wait for isready.
    await this.withTimeout(new Promise<void>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        const lines: string[] = Array.isArray(e.data) ? e.data : [];
        if (lines.some((l) => l.includes('readyok'))) {
          this.worker!.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMsg);
      this.send('isready');
    }), INIT_TIMEOUT_MS, 'patricia isready timeout');

    this._ready = true;
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this.worker || !this._ready) throw new Error('PatriciaSuggestionEngine not initialised');
    if (this.activeResolve) await this.cancel();

    return new Promise<LabeledSuggestion[]>((resolve, reject) => {
      this.activeResolve = resolve;
      this.activeReject = reject;
      this.activeFen = params.fen;
      this.activeMultiPv = Math.max(1, Math.min(3, params.multiPv ?? 1));
      this.activeResults = { byPv: new Map() };

      this.activeTimer = setTimeout(() => {
        this.abortActive(new Error('Search timeout'));
      }, SEARCH_TIMEOUT_MS);

      this.activeListener = (e: MessageEvent) => {
        const lines: string[] = Array.isArray(e.data) ? e.data : [];
        for (const line of lines) this.onSearchLine(line);
      };
      this.worker!.addEventListener('message', this.activeListener);

      // Per-search options.
      this.send(`setoption name MultiPV value ${this.activeMultiPv}`);
      const targetElo = params.targetElo ?? 3000;
      const limit = params.limitStrength ?? false;
      const skill = eloToSkillLevel(targetElo, limit);
      if (this._supportedOptions.has('Skill_Level')) {
        this.send(`setoption name Skill_Level value ${skill}`);
      }

      this.send('isready');
      // No need to wait readyok — the engine processes setoption synchronously
      // before the next position/go thanks to in-order Worker postMessage.
      const moveSuffix = params.moves?.length ? ` moves ${params.moves.join(' ')}` : '';
      this.send(`position fen ${params.fen}${moveSuffix}`);
      this.send(buildGoCommand(params.search ?? null, 'patricia'));
    });
  }

  async newGame(): Promise<void> {
    if (!this.worker || !this._ready) return;
    this.send('ucinewgame');
    // No readyok wait needed — the next isready before search will sync.
  }

  async cancel(): Promise<void> {
    if (!this.activeResolve) return;
    // Patricia in WASM is single-threaded synchronous; "stop" arrives only
    // after the current search returns. We just wait for natural completion.
    return new Promise<void>((resolve) => {
      const prevReject = this.activeReject!;
      this.activeResolve = () => {
        prevReject(new DOMException('Patricia search cancelled', 'AbortError'));
        resolve();
      };
      this.send('stop');
    });
  }

  destroy(): void {
    if (this.activeResolve) this.abortActive(new Error('Engine destroyed'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this._ready = false;
  }

  // ────────────────────────────────────────────────────────────────────────

  private send(line: string): void {
    if (this.worker) this.worker.postMessage(line);
  }

  private onSearchLine(line: string): void {
    if (!this.activeResolve) return;
    if (line.startsWith('info') && line.includes(' multipv ')) {
      const sug = parseInfoLine(line);
      if (sug && sug.multipv <= this.activeMultiPv) {
        this.activeResults!.byPv.set(sug.multipv, sug);
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      const collected = Array.from(this.activeResults!.byPv.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, s]) => s);
      const labeled = labelSuggestions(collected, this.activeFen!);
      const resolve = this.activeResolve;
      this.cleanupActive();
      resolve!(labeled);
    }
  }

  private cleanupActive(): void {
    if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
    if (this.activeListener && this.worker) this.worker.removeEventListener('message', this.activeListener);
    this.activeListener = null;
    this.activeResolve = null;
    this.activeReject = null;
    this.activeFen = null;
    this.activeResults = null;
  }

  private abortActive(err: Error): void {
    const reject = this.activeReject;
    this.cleanupActive();
    if (reject) reject(err);
  }

  private async withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}
