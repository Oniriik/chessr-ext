/**
 * MaiaInstance — wraps one `maia-native` child process.
 *
 * Protocol (line-based stdin/stdout, defined in
 * maia2-wasm/maia-runtime/native/main.cpp):
 *   stderr: "READY\n"  ← weights loaded, ready
 *   stdin:  "predict|<fen>|<eloSelf>|<eloOppo>\n"
 *   stdout: "result <value> <logit0> <logit1> ... <logit1879>\n"
 *           OR "err <reason>\n"
 *
 * Single in-flight predict per instance. Pool sizing controls concurrency.
 *
 * Note: instances are spawned at init time and stay alive — startup cost
 * (~80 MB weight load) is paid once, not per request.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PREDICT_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 30_000;

export interface PredictResult {
  value: number;
  logits: Float32Array;
}

export class MaiaInstance extends EventEmitter {
  public readonly id: number;
  public isReady = false;
  public isBusy = false;

  private process: ChildProcess | null = null;
  private buffer = '';

  constructor(id = 0) {
    super();
    this.id = id;
  }

  private getEnginePath(): string {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === 'linux') {
      return path.join(__dirname, '../../engines/linux/maia-native');
    }
    if (platform === 'darwin' && arch === 'arm64') {
      // No native macOS build yet — Mac dev runs the serveur in
      // platform: linux/amd64 via Rosetta, so hits the linux/ binary.
      return path.join(__dirname, '../../engines/linux/maia-native');
    }
    throw new Error(`MaiaInstance: unsupported platform ${platform} ${arch}`);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const enginePath = this.getEnginePath();
      console.log(`[Maia ${this.id}] Starting: ${enginePath}`);

      this.process = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

      this.process.stdout?.on('data', (data: Buffer) => this.handleStdout(data.toString()));
      this.process.stderr?.on('data', (data: Buffer) => {
        const txt = data.toString().trim();
        if (txt === 'READY') {
          this.isReady = true;
          console.log(`[Maia ${this.id}] READY`);
          resolve();
        } else {
          console.error(`[Maia ${this.id} stderr]`, txt);
        }
      });
      this.process.on('error', (err) => {
        console.error(`[Maia ${this.id}] process error:`, err);
        reject(err);
      });
      this.process.on('close', (code) => {
        console.log(`[Maia ${this.id}] exited with code ${code}`);
        this.isReady = false;
        this.isBusy = false;
      });

      setTimeout(() => {
        if (!this.isReady) reject(new Error(`[Maia ${this.id}] READY timeout`));
      }, READY_TIMEOUT_MS);
    });
  }

  private handleStdout(data: string) {
    this.buffer += data;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.emit('line', line);
    }
  }

  /** One predict call. Spawns no subprocess — sends to existing one. */
  async predict(fen: string, eloSelfBucket: number, eloOppoBucket: number): Promise<PredictResult> {
    if (!this.isReady) throw new Error(`[Maia ${this.id}] not ready`);
    if (!this.process?.stdin) throw new Error(`[Maia ${this.id}] no stdin`);
    this.isBusy = true;

    return new Promise<PredictResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('line', onLine);
        this.isBusy = false;
        reject(new Error(`[Maia ${this.id}] predict timeout`));
      }, PREDICT_TIMEOUT_MS);

      const onLine = (line: string) => {
        clearTimeout(timer);
        this.removeListener('line', onLine);
        this.isBusy = false;

        if (line.startsWith('err ')) {
          reject(new Error(`[Maia ${this.id}] ${line.slice(4)}`));
          return;
        }
        if (!line.startsWith('result ')) {
          reject(new Error(`[Maia ${this.id}] unexpected reply: ${line.slice(0, 60)}`));
          return;
        }
        // Format: "result <value> <logit0> <logit1> ..."
        const parts = line.split(' ');
        if (parts.length < 2) {
          reject(new Error(`[Maia ${this.id}] truncated reply`));
          return;
        }
        const value = parseFloat(parts[1]);
        const logits = new Float32Array(parts.length - 2);
        for (let i = 0; i < logits.length; i++) {
          logits[i] = parseFloat(parts[i + 2]);
        }
        resolve({ value, logits });
      };

      this.on('line', onLine);
      this.process!.stdin!.write(`predict|${fen}|${eloSelfBucket}|${eloOppoBucket}\n`);
    });
  }

  stop(): void {
    if (this.process) {
      try { this.process.stdin?.write('quit\n'); } catch { /* ignore */ }
      this.process.kill();
      this.process = null;
    }
    this.isReady = false;
    this.isBusy = false;
  }
}
