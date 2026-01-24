import { WebSocket } from 'ws';
import { StockfishPool } from './stockfish-pool.js';
import { UserInfo, MetricsResponse } from './types.js';

/**
 * Collects and exposes server metrics
 */
export class MetricsCollector {
  private clients: Map<WebSocket, UserInfo>;
  private pool: StockfishPool;

  constructor(clients: Map<WebSocket, UserInfo>, pool: StockfishPool) {
    this.clients = clients;
    this.pool = pool;
  }

  /**
   * Get current server metrics
   */
  getMetrics(): MetricsResponse {
    const allUsers = Array.from(this.clients.values());
    const authenticatedUsers = allUsers.filter(u => u.authenticated);

    return {
      connectedClients: this.clients.size,
      authenticatedUsers: authenticatedUsers.length,
      stockfishPool: {
        total: this.pool.getPoolSize(),
        available: this.pool.getAvailableCount(),
        queued: this.pool.getQueueLength(),
      },
      users: authenticatedUsers.map(u => ({
        id: u.id,
        email: u.email,
        connectedAt: u.connectedAt,
      })),
    };
  }
}
