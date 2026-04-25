/**
 * MaiaPool — pool of N MaiaInstance child processes. Same acquire/release
 * pattern as EnginePool / StockfishPool, just for the maia-native binary.
 */

import { MaiaInstance } from './MaiaInstance.js';

export class MaiaPool {
  private instances: MaiaInstance[] = [];
  private waiters: Array<(eng: MaiaInstance) => void> = [];

  constructor(private maxInstances = 1) {}

  async init(): Promise<void> {
    console.log(`[MaiaPool] Initializing ${this.maxInstances} Maia instances...`);
    await Promise.all(
      Array.from({ length: this.maxInstances }, async (_, i) => {
        const inst = new MaiaInstance(i);
        await inst.start();
        this.instances.push(inst);
      }),
    );
    console.log(`[MaiaPool] Initialized ${this.maxInstances} Maia instances`);
  }

  acquire(): Promise<MaiaInstance> {
    const free = this.instances.find((i) => i.isReady && !i.isBusy);
    if (free) {
      free.isBusy = true;
      return Promise.resolve(free);
    }
    return new Promise<MaiaInstance>((resolve) => this.waiters.push(resolve));
  }

  release(inst: MaiaInstance): void {
    inst.isBusy = false;
    const next = this.waiters.shift();
    if (next) {
      inst.isBusy = true;
      next(inst);
    }
  }

  async shutdown(): Promise<void> {
    console.log('[MaiaPool] Shutting down all Maia instances...');
    for (const inst of this.instances) inst.stop();
    this.instances = [];
    this.waiters = [];
    console.log('[MaiaPool] All Maia instances stopped');
  }

  getStats() {
    const total = this.instances.length;
    const busy = this.instances.filter((i) => i.isBusy).length;
    return { total, available: total - busy, busy, waiting: this.waiters.length };
  }
}
