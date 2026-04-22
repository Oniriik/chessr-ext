import { MaiaEngine } from "./inference.js";

// fp32 = bit-exact parity with the official PyTorch checkpoint.
// fp16 also available (~50% size, ~0.05% prob delta) at /models/blitz_model.fp16.onnx
const MODEL_URL = "/models/blitz_model.onnx";
const MOVES_URL = "/models/moves.json";

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), env: $("env"),
  fen: $("fen"), eloSelf: $("elo-self"), eloOppo: $("elo-oppo"),
  threads: $("threads"), threadsOut: $("threads-out"),
  run: $("run"), bench: $("bench"), timing: $("timing"),
  winbar: $("winbar"), winprobText: $("winprob-text"),
  moves: $("moves"),
};

const HW = navigator.hardwareConcurrency || 4;
els.threads.max = String(Math.min(HW, 8));
els.threads.value = String(Math.min(4, Math.max(1, Math.floor(HW / 2))));
els.threadsOut.value = els.threads.value;
const HAS_SAB = typeof SharedArrayBuffer !== "undefined";

const engine = new MaiaEngine();

async function init() {
  els.env.innerHTML = `
    <span class="pill">hw cores: ${HW}</span>
    <span class="pill ${HAS_SAB ? "live" : ""}">SharedArrayBuffer: ${HAS_SAB ? "yes" : "no"}</span>
    <span class="pill ${crossOriginIsolated ? "live" : ""}">crossOriginIsolated: ${crossOriginIsolated ? "yes" : "no"}</span>
  `;
  if (!HAS_SAB || !crossOriginIsolated) {
    // Force single thread when SAB is unavailable.
    els.threads.value = "1";
    els.threads.max = "1";
    els.threadsOut.value = "1";
  }

  const initialThreads = parseInt(els.threads.value, 10);
  els.status.textContent = `Loading model (${initialThreads} thread${initialThreads > 1 ? "s" : ""}) …`;
  const t0 = performance.now();
  await engine.load({
    modelUrl: MODEL_URL,
    movesUrl: MOVES_URL,
    threads: initialThreads,
    simd: true,
  });
  const dt = (performance.now() - t0).toFixed(0);
  els.status.innerHTML = `<span class="pill live">ready</span> session created in ${dt}ms · ${engine.threads} thread${engine.threads > 1 ? "s" : ""}`;
  els.run.disabled = false;
  els.bench.disabled = false;
}

let pendingRecreate = null;
els.threads.addEventListener("input", () => {
  els.threadsOut.value = els.threads.value;
});
els.threads.addEventListener("change", async () => {
  const n = parseInt(els.threads.value, 10);
  if (pendingRecreate) return;
  els.run.disabled = true;
  els.status.textContent = `Recreating session with ${n} thread${n > 1 ? "s" : ""} …`;
  pendingRecreate = engine.setThreads(n).then(() => {
    els.status.innerHTML = `<span class="pill live">ready</span> session created in ${engine.lastLoadMs.toFixed(0)}ms · ${engine.threads} thread${engine.threads > 1 ? "s" : ""}`;
    els.run.disabled = false;
    pendingRecreate = null;
  }).catch(err => {
    els.status.textContent = `error: ${err.message}`;
    pendingRecreate = null;
  });
});

async function runOnce() {
  els.run.disabled = true;
  try {
    const result = await engine.predict({
      fen: els.fen.value.trim(),
      eloSelf: parseInt(els.eloSelf.value, 10),
      eloOppo: parseInt(els.eloOppo.value, 10),
    });
    els.timing.textContent = `${result.elapsedMs.toFixed(1)}ms (${result.threads} thread${result.threads > 1 ? "s" : ""}, ${result.moves.length} legal moves)`;

    const wpct = (result.winProb * 100).toFixed(1);
    els.winbar.style.width = `${wpct}%`;
    els.winprobText.textContent = `${wpct}%`;

    els.moves.innerHTML = "";
    for (let i = 0; i < Math.min(result.moves.length, 10); i++) {
      const m = result.moves[i];
      const li = document.createElement("li");
      if (i === 0) li.className = "top";
      li.innerHTML = `<span class="uci">${m.uci}</span><span class="prob">${(m.prob * 100).toFixed(1)}%</span>`;
      els.moves.appendChild(li);
    }
  } catch (err) {
    els.timing.textContent = `error: ${err.message}`;
    console.error(err);
  } finally {
    els.run.disabled = false;
  }
}
els.run.addEventListener("click", runOnce);

async function benchmark() {
  els.bench.disabled = true;
  els.run.disabled = true;
  const fen = els.fen.value.trim();
  const eloSelf = parseInt(els.eloSelf.value, 10);
  const eloOppo = parseInt(els.eloOppo.value, 10);
  const maxThreads = parseInt(els.threads.max, 10);
  const results = [];
  for (let n = 1; n <= maxThreads; n *= 2) {
    els.status.textContent = `Bench: ${n} thread${n > 1 ? "s" : ""} …`;
    await engine.setThreads(n);
    // warm up
    await engine.predict({ fen, eloSelf, eloOppo });
    let total = 0; const N = 10;
    for (let i = 0; i < N; i++) {
      const r = await engine.predict({ fen, eloSelf, eloOppo });
      total += r.elapsedMs;
    }
    results.push({ threads: n, avgMs: total / N });
  }
  els.bench.disabled = false;
  els.run.disabled = false;
  els.threads.value = String(results[0].threads);
  els.threadsOut.value = els.threads.value;
  const lines = results.map(r => `${r.threads}t: ${r.avgMs.toFixed(1)}ms`).join(" · ");
  els.status.innerHTML = `<span class="pill live">bench done</span> ${lines}`;
}
els.bench.addEventListener("click", benchmark);

els.run.disabled = true;
els.bench.disabled = true;
init().catch(err => {
  els.status.textContent = `init failed: ${err.message}`;
  console.error(err);
});
