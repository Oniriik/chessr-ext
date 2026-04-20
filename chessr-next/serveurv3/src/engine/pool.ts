import { UCIEngine } from './uci.js';

type WaitingCallback = (engine: UCIEngine | null) => void;

export class EnginePool {
  private engines: UCIEngine[] = [];
  private queue: WaitingCallback[] = [];
  private size: number;

  constructor(size = 2) {
    this.size = size;
  }

  async init() {
    console.log(`[Pool] Starting ${this.size} engine instances...`);
    for (let i = 0; i < this.size; i++) {
      const engine = new UCIEngine();
      await engine.start();
      this.engines.push(engine);
    }
    console.log(`[Pool] ${this.size} engines ready`);
  }

  acquire(): Promise<UCIEngine | null> {
    const available = this.engines.find(e => e.ready && !e.busy);
    if (available) {
      available.busy = true;
      return Promise.resolve(available);
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(engine: UCIEngine) {
    engine.busy = false;
    const next = this.queue.shift();
    if (next) {
      engine.busy = true;
      next(engine);
    }
  }

  shutdown() {
    for (const cb of this.queue) cb(null);
    this.queue = [];
    for (const e of this.engines) e.stop();
    this.engines = [];
  }
}
