import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoCommand, type SearchOptions, type EngineKind } from './searchOptions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Suggestion {
  multipv: number;
  move: string;
  evaluation: number;
  depth: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  mateScore: number | null;
  pv: string[];
}

export class UCIEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  ready = false;
  busy = false;

  /** Which UCI engine binary this instance wraps — used by searchOptions
   *  when formatting the `go` command, since future engines may diverge. */
  readonly kind: EngineKind = 'dragon';

  private getPath(): string {
    const { platform, arch } = process;
    if (platform === 'darwin' && arch === 'arm64') return path.join(__dirname, '../../engines/macos/dragon-m1');
    if (platform === 'linux') return path.join(__dirname, '../../engines/linux/dragon-avx2');
    throw new Error(`Unsupported platform: ${platform} ${arch}`);
  }

  async start(): Promise<void> {
    const enginePath = this.getPath();
    this.process = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.emit('line', trimmed);
      }
    });

    this.process.stderr!.on('data', (d: Buffer) => console.error('[Engine stderr]', d.toString().trim()));
    this.process.on('close', () => { this.ready = false; this.busy = false; });

    this.send('uci');
    await this.waitFor('uciok');
    this.ready = true;
  }

  send(cmd: string) {
    this.process?.stdin?.write(cmd + '\n');
  }

  waitFor(token: string, timeout = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off('line', handler); reject(new Error(`Timeout waiting for ${token}`)); }, timeout);
      const handler = (line: string) => {
        if (line.includes(token)) { clearTimeout(timer); this.off('line', handler); resolve(line); }
      };
      this.on('line', handler);
    });
  }

  async configure(options: Record<string, string>) {
    for (const [name, value] of Object.entries(options)) {
      this.send(`setoption name ${name} value ${value}`);
    }
    this.send('isready');
    await this.waitFor('readyok');
  }

  async search(
    fen: string,
    multiPv: number,
    opts: { moves?: string[]; search?: SearchOptions } = {},
  ): Promise<Suggestion[]> {
    const { moves, search } = opts;
    const isBlack = fen.split(' ')[1] === 'b';
    this.busy = true;

    return new Promise((resolve, reject) => {
      const results = new Map<string, Suggestion>();
      const timer = setTimeout(() => { this.off('line', handler); this.busy = false; reject(new Error('Search timeout')); }, 30_000);

      const handler = (line: string) => {
        if (line.startsWith('info') && line.includes('pv')) {
          const s = parseInfo(line);
          if (s) {
            if (isBlack) {
              s.evaluation = -s.evaluation;
              if (s.mateScore !== null) s.mateScore = -s.mateScore;
              [s.winRate, s.lossRate] = [s.lossRate, s.winRate];
            }
            results.set(s.move, s);
          }
        }
        if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          this.off('line', handler);
          this.busy = false;
          resolve(Array.from(results.values()).sort((a, b) => a.multipv - b.multipv).slice(0, multiPv));
        }
      };

      this.on('line', handler);
      this.send('ucinewgame');
      this.send(moves?.length ? `position startpos moves ${moves.join(' ')}` : `position fen ${fen}`);
      this.send(buildGoCommand(search, this.kind));
    });
  }

  stop() {
    this.send('quit');
    this.process?.kill();
    this.process = null;
    this.ready = false;
    this.busy = false;
  }
}

function parseInfo(line: string): Suggestion | null {
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  if (!pvMatch) return null;
  const pv = pvMatch[1].split(/\s+/).filter(m => m.length >= 4);
  if (!pv.length) return null;

  const multipv = parseInt(line.match(/\bmultipv\s+(\d+)/)?.[1] || '1');
  const depth = parseInt(line.match(/\bdepth\s+(\d+)/)?.[1] || '0');

  let evaluation = 0;
  let mateScore: number | null = null;
  let winRate = 50, drawRate = 0, lossRate = 50;

  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);

  if (mateMatch) {
    mateScore = parseInt(mateMatch[1]);
    evaluation = mateScore > 0 ? 10000 : -10000;
    winRate = mateScore > 0 ? 100 : 0;
    drawRate = 0;
    lossRate = mateScore > 0 ? 0 : 100;
  } else if (cpMatch) {
    evaluation = parseInt(cpMatch[1]);
  }

  if (wdlMatch) {
    winRate = parseInt(wdlMatch[1]) / 10;
    drawRate = parseInt(wdlMatch[2]) / 10;
    lossRate = parseInt(wdlMatch[3]) / 10;
  } else if (!mateMatch && cpMatch) {
    winRate = 50 + 50 * (2 / (1 + Math.exp(-evaluation / 400)) - 1);
    winRate = Math.round(winRate * 10) / 10;
    lossRate = Math.round((100 - winRate) * 10) / 10;
  }

  return {
    multipv, move: pv[0], evaluation, depth,
    winRate: Math.round(winRate * 10) / 10,
    drawRate: Math.round(drawRate * 10) / 10,
    lossRate: Math.round(lossRate * 10) / 10,
    mateScore, pv,
  };
}
