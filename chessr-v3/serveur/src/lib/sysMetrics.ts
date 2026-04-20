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

    const load = os.loadavg()[0].toFixed(2);

    console.log(
      `\x1b[90m[SYS]\x1b[0m cpu=${cpuPct.toFixed(1)}% ` +
        `mem=${formatGb(usedMem)}/${formatGb(totalMem)}GB (${memPct.toFixed(0)}%) ` +
        `rss=${formatMb(rss)}MB load1=${load}`,
    );
  }, intervalMs).unref();
}
