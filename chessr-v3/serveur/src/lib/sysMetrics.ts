import os from 'os';

// Sample CPU times between calls so we report actual usage (not a snapshot average).
function readCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const k of Object.keys(c.times) as (keyof typeof c.times)[]) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}

let prev = readCpuTimes();

export interface SysSample {
  ts: number;
  cpuPct: number;
  memUsed: number;
  memTotal: number;
  memPct: number;
  rss: number;
  load1: number;
  cpuCount: number;
}

let latest: SysSample = {
  ts: Date.now(),
  cpuPct: 0,
  memUsed: 0,
  memTotal: os.totalmem(),
  memPct: 0,
  rss: 0,
  load1: 0,
  cpuCount: os.cpus().length,
};

export function getLatestMetrics(): SysSample {
  return latest;
}

function formatMb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(0);
}

function formatGb(bytes: number) {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

export function startSysMetrics(intervalMs = 5000) {
  setInterval(() => {
    const curr = readCpuTimes();
    const idleDiff = curr.idle - prev.idle;
    const totalDiff = curr.total - prev.total;
    const cpuPct = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
    prev = curr;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPct = (usedMem / totalMem) * 100;

    const rss = process.memoryUsage.rss();
    const load1 = os.loadavg()[0];

    latest = {
      ts: Date.now(),
      cpuPct,
      memUsed: usedMem,
      memTotal: totalMem,
      memPct,
      rss,
      load1,
      cpuCount: os.cpus().length,
    };

    // Snapshot is exposed via /admin/metrics; no need to spam stdout.
  }, intervalMs).unref();
}
