import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TorchAnalysisEngine,
  type TorchAnalysisDeps,
  type WorkerLike,
} from '../torchAnalysisEngine.js';

const FIX = path.join(import.meta.dirname, 'fixtures');

class FakeWorker implements WorkerLike {
  posted: string[] = [];
  private listeners = new Map<string, ((e: any) => void)[]>();
  onAnyCmd?: (s: string) => void;

  postMessage(s: string) { this.posted.push(s); this.onAnyCmd?.(s); }
  addEventListener(ev: string, cb: (e: any) => void) {
    const list = this.listeners.get(ev) ?? [];
    list.push(cb);
    this.listeners.set(ev, list);
  }
  removeEventListener(ev: string, cb: (e: any) => void) {
    const list = this.listeners.get(ev) ?? [];
    this.listeners.set(ev, list.filter((l) => l !== cb));
  }
  terminate() {}
  emit(line: string) {
    for (const cb of this.listeners.get('message') ?? []) cb({ data: line });
  }
}

function makeDeps(worker: FakeWorker): TorchAnalysisDeps {
  return {
    fetchEngineSource: async () => 'self.onmessage = () => {};',
    workerFactory: () => worker,
    wasmUrl: 'mock://torch.wasm',
    mode: 'rich',
  };
}

describe('TorchAnalysisEngine', () => {
  it('initialises by sending uci + setoption + isready and reports ready', async () => {
    const fw = new FakeWorker();
    const eng = new TorchAnalysisEngine(makeDeps(fw));
    fw.onAnyCmd = (cmd) => {
      if (cmd === 'uci') queueMicrotask(() => fw.emit('uciok'));
      if (cmd === 'isready') queueMicrotask(() => fw.emit('readyok'));
    };
    await eng.init();
    assert.equal(eng.ready, true);
    assert.ok(fw.posted.includes('setoption name ServeCommandV2 value true'));
    assert.ok(fw.posted.includes('setoption name ClassificationV3 value true'));
    eng.destroy();
  });

  it('runs analyze() and returns parsed TorchAnalysis', async () => {
    const fw = new FakeWorker();
    const eng = new TorchAnalysisEngine(makeDeps(fw));
    fw.onAnyCmd = (cmd) => {
      if (cmd === 'uci') queueMicrotask(() => fw.emit('uciok'));
      if (cmd === 'isready') queueMicrotask(() => fw.emit('readyok'));
      if (cmd === 'fetch analysis') {
        const raw = fs.readFileSync(path.join(FIX, 'torch-italian-25moves.json'), 'utf8');
        queueMicrotask(() => fw.emit('json ' + raw));
      }
    };
    await eng.init();
    const result = await eng.fetchFullAnalysis(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    assert.equal(typeof result.effectiveElo.white, 'number');
    assert.ok(result.moveAnalyses.length > 0);
    assert.ok(fw.posted.some((c) => c.startsWith('position startpos moves ')));
    assert.ok(fw.posted.includes('fetch analysis'));
    eng.destroy();
  });

  it('rejects on JSON parse error', async () => {
    const fw = new FakeWorker();
    const eng = new TorchAnalysisEngine(makeDeps(fw));
    fw.onAnyCmd = (cmd) => {
      if (cmd === 'uci') queueMicrotask(() => fw.emit('uciok'));
      if (cmd === 'isready') queueMicrotask(() => fw.emit('readyok'));
      if (cmd === 'fetch analysis') queueMicrotask(() => fw.emit('json {not-json'));
    };
    await eng.init();
    await assert.rejects(() => eng.fetchFullAnalysis(['e2e4']), /JSON|parse/);
    eng.destroy();
  });

  it('handles empty history (startpos)', async () => {
    const fw = new FakeWorker();
    const eng = new TorchAnalysisEngine(makeDeps(fw));
    fw.onAnyCmd = (cmd) => {
      if (cmd === 'uci') queueMicrotask(() => fw.emit('uciok'));
      if (cmd === 'isready') queueMicrotask(() => fw.emit('readyok'));
      if (cmd === 'fetch analysis') {
        const raw = fs.readFileSync(path.join(FIX, 'torch-startpos.json'), 'utf8');
        queueMicrotask(() => fw.emit('json ' + raw));
      }
    };
    await eng.init();
    const result = await eng.fetchFullAnalysis([]);
    assert.equal(result.moveAnalyses.length, 0);
    assert.ok(fw.posted.includes('position startpos'));
    eng.destroy();
  });
});
