import { WebSocket } from 'ws';
import os from 'os';
import { StockfishPool } from './stockfish-pool.js';
import { UserInfo, MetricsResponse } from './types.js';

/**
 * Collects and exposes server metrics
 */
export class MetricsCollector {
  private clients: Map<WebSocket, UserInfo>;
  private pool: StockfishPool;
  private suggestionsCount = 0;
  private serverStartTime: number;
  private lastCpuInfo: { idle: number; total: number } | null = null;
  private cpuUsage = 0;

  constructor(clients: Map<WebSocket, UserInfo>, pool: StockfishPool) {
    this.clients = clients;
    this.pool = pool;
    this.serverStartTime = Date.now();
    this.startCpuMonitoring();
  }

  /**
   * Start monitoring CPU usage
   */
  private startCpuMonitoring() {
    // Update CPU usage every 2 seconds
    setInterval(() => {
      this.cpuUsage = this.calculateCpuUsage();
    }, 2000);
  }

  /**
   * Calculate CPU usage percentage
   */
  private calculateCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }

    if (this.lastCpuInfo) {
      const idleDiff = idle - this.lastCpuInfo.idle;
      const totalDiff = total - this.lastCpuInfo.total;
      const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
      this.lastCpuInfo = { idle, total };
      return usage;
    }

    this.lastCpuInfo = { idle, total };
    return 0;
  }

  /**
   * Get memory usage
   */
  private getMemoryUsage(): { used: number; total: number; percentage: number } {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const percentage = Math.round((used / total) * 100);
    return { used, total, percentage };
  }

  /**
   * Increment suggestions count
   */
  incrementSuggestions(count: number = 1): void {
    this.suggestionsCount += count;
  }

  /**
   * Get current server metrics
   */
  getMetrics(): MetricsResponse {
    const allUsers = Array.from(this.clients.values());
    const authenticatedUsers = allUsers.filter(u => u.authenticated);

    // Count unique users by email
    const uniqueEmails = new Set(authenticatedUsers.map(u => u.email));

    // Group connections by email for the user list
    const usersByEmail = new Map<string, { email: string; connections: number; firstConnectedAt: string }>();
    for (const user of authenticatedUsers) {
      const existing = usersByEmail.get(user.email);
      if (existing) {
        existing.connections++;
        // Keep the earliest connection time
        if (user.connectedAt < existing.firstConnectedAt) {
          existing.firstConnectedAt = user.connectedAt;
        }
      } else {
        usersByEmail.set(user.email, {
          email: user.email,
          connections: 1,
          firstConnectedAt: user.connectedAt,
        });
      }
    }

    return {
      connectedClients: this.clients.size,
      authenticatedUsers: uniqueEmails.size,
      stockfishPool: {
        total: this.pool.getPoolSize(),
        available: this.pool.getAvailableCount(),
        queued: this.pool.getQueueLength(),
      },
      users: Array.from(usersByEmail.values()).map(u => ({
        id: u.email, // Use email as ID for unique users
        email: u.email,
        connectedAt: u.firstConnectedAt,
        connections: u.connections,
      })),
      suggestionsCount: this.suggestionsCount,
      serverUptime: Date.now() - this.serverStartTime,
      systemResources: {
        cpuUsage: this.cpuUsage,
        memoryUsage: this.getMemoryUsage(),
      },
    };
  }

}
