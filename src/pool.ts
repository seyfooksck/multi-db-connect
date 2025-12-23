// ============================================
// SDBC - Connection Pool Manager
// Enterprise-grade connection pooling
// ============================================

export interface PoolConfig {
  /** Minimum connections in pool */
  min?: number;
  /** Maximum connections in pool */
  max?: number;
  /** Connection acquire timeout (ms) */
  acquireTimeout?: number;
  /** Idle timeout before connection is released (ms) */
  idleTimeout?: number;
  /** Reap interval for idle connections (ms) */
  reapInterval?: number;
  /** Enable connection validation */
  validate?: boolean;
  /** Validation query (SQL databases) */
  validationQuery?: string;
  /** Health check interval (ms) */
  healthCheckInterval?: number;
  /** Retry attempts on connection failure */
  retryAttempts?: number;
  /** Retry delay (ms) */
  retryDelay?: number;
}

export interface PoolStats {
  /** Total connections created */
  totalConnections: number;
  /** Active connections in use */
  activeConnections: number;
  /** Idle connections available */
  idleConnections: number;
  /** Waiting requests for connection */
  waitingRequests: number;
  /** Total queries executed */
  totalQueries: number;
  /** Failed queries */
  failedQueries: number;
  /** Average query time (ms) */
  averageQueryTime: number;
  /** Pool uptime (ms) */
  uptime: number;
  /** Last health check time */
  lastHealthCheck: Date | null;
  /** Health status */
  healthy: boolean;
}

export interface PoolConnection {
  id: string;
  client: any;
  createdAt: Date;
  lastUsedAt: Date;
  queryCount: number;
  inUse: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  latency: number;
  message: string;
  timestamp: Date;
}

const DEFAULT_POOL_CONFIG: Required<PoolConfig> = {
  min: 2,
  max: 10,
  acquireTimeout: 30000,
  idleTimeout: 60000,
  reapInterval: 30000,
  validate: true,
  validationQuery: 'SELECT 1',
  healthCheckInterval: 60000,
  retryAttempts: 3,
  retryDelay: 1000
};

/**
 * Connection Pool Manager
 * Manages database connection pooling with health checks
 */
export class PoolManager {
  private config: Required<PoolConfig>;
  private connections: Map<string, PoolConnection> = new Map();
  private waitingQueue: Array<{
    resolve: (conn: PoolConnection) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  
  private stats: {
    totalQueries: number;
    failedQueries: number;
    queryTimes: number[];
    startTime: Date;
    lastHealthCheck: Date | null;
    healthy: boolean;
  };
  
  private reapTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private createConnection: () => Promise<any>;
  private destroyConnection: (client: any) => Promise<void>;
  private validateConnection: (client: any) => Promise<boolean>;
  private connectionIdCounter: number = 0;

  constructor(
    config: PoolConfig,
    createFn: () => Promise<any>,
    destroyFn: (client: any) => Promise<void>,
    validateFn?: (client: any) => Promise<boolean>
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.createConnection = createFn;
    this.destroyConnection = destroyFn;
    this.validateConnection = validateFn || (async () => true);
    
    this.stats = {
      totalQueries: 0,
      failedQueries: 0,
      queryTimes: [],
      startTime: new Date(),
      lastHealthCheck: null,
      healthy: true
    };
  }

  /**
   * Initialize the pool with minimum connections
   */
  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < this.config.min; i++) {
      promises.push(this.addConnection());
    }
    
    await Promise.all(promises);
    this.startReaper();
    this.startHealthCheck();
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PoolConnection> {
    // Try to find an idle connection
    for (const [id, conn] of this.connections) {
      if (!conn.inUse) {
        // Validate if enabled
        if (this.config.validate) {
          const valid = await this.validateConnection(conn.client);
          if (!valid) {
            await this.removeConnection(id);
            continue;
          }
        }
        
        conn.inUse = true;
        conn.lastUsedAt = new Date();
        return conn;
      }
    }
    
    // Create new connection if under max
    if (this.connections.size < this.config.max) {
      await this.addConnection();
      return this.acquire();
    }
    
    // Wait for available connection
    return this.waitForConnection();
  }

  /**
   * Release a connection back to the pool
   */
  release(connection: PoolConnection): void {
    const conn = this.connections.get(connection.id);
    if (conn) {
      conn.inUse = false;
      conn.lastUsedAt = new Date();
      
      // Check waiting queue
      if (this.waitingQueue.length > 0) {
        const waiter = this.waitingQueue.shift()!;
        clearTimeout(waiter.timeout);
        conn.inUse = true;
        waiter.resolve(conn);
      }
    }
  }

  /**
   * Execute query and track stats
   */
  async executeQuery<T>(
    fn: (client: any) => Promise<T>
  ): Promise<T> {
    const conn = await this.acquire();
    const startTime = Date.now();
    
    try {
      const result = await fn(conn.client);
      conn.queryCount++;
      this.stats.totalQueries++;
      this.stats.queryTimes.push(Date.now() - startTime);
      
      // Keep only last 100 query times
      if (this.stats.queryTimes.length > 100) {
        this.stats.queryTimes.shift();
      }
      
      return result;
    } catch (error) {
      this.stats.failedQueries++;
      throw error;
    } finally {
      this.release(conn);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    let activeConnections = 0;
    let idleConnections = 0;
    
    for (const conn of this.connections.values()) {
      if (conn.inUse) {
        activeConnections++;
      } else {
        idleConnections++;
      }
    }
    
    const avgQueryTime = this.stats.queryTimes.length > 0
      ? this.stats.queryTimes.reduce((a, b) => a + b, 0) / this.stats.queryTimes.length
      : 0;
    
    return {
      totalConnections: this.connections.size,
      activeConnections,
      idleConnections,
      waitingRequests: this.waitingQueue.length,
      totalQueries: this.stats.totalQueries,
      failedQueries: this.stats.failedQueries,
      averageQueryTime: Math.round(avgQueryTime * 100) / 100,
      uptime: Date.now() - this.stats.startTime.getTime(),
      lastHealthCheck: this.stats.lastHealthCheck,
      healthy: this.stats.healthy
    };
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const conn = await this.acquire();
      const valid = await this.validateConnection(conn.client);
      this.release(conn);
      
      const latency = Date.now() - startTime;
      this.stats.lastHealthCheck = new Date();
      this.stats.healthy = valid;
      
      return {
        healthy: valid,
        latency,
        message: valid ? 'Pool is healthy' : 'Validation failed',
        timestamp: new Date()
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.stats.lastHealthCheck = new Date();
      this.stats.healthy = false;
      
      return {
        healthy: false,
        latency,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Resize the pool
   */
  async resize(newMax: number): Promise<void> {
    this.config.max = Math.max(this.config.min, newMax);
    
    // Remove excess idle connections
    if (this.connections.size > this.config.max) {
      const toRemove: string[] = [];
      
      for (const [id, conn] of this.connections) {
        if (!conn.inUse && this.connections.size - toRemove.length > this.config.max) {
          toRemove.push(id);
        }
      }
      
      for (const id of toRemove) {
        await this.removeConnection(id);
      }
    }
  }

  /**
   * Drain and close all connections
   */
  async drain(): Promise<void> {
    // Stop timers
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Reject all waiting requests
    for (const waiter of this.waitingQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Pool is draining'));
    }
    this.waitingQueue = [];
    
    // Close all connections
    const promises: Promise<void>[] = [];
    
    for (const [id, _conn] of this.connections) {
      promises.push(this.removeConnection(id));
    }
    
    await Promise.all(promises);
  }

  /**
   * Warm up pool with connections
   */
  async warmup(count?: number): Promise<void> {
    const targetCount = count || this.config.min;
    const currentCount = this.connections.size;
    
    if (targetCount <= currentCount) {
      return;
    }
    
    const promises: Promise<void>[] = [];
    
    for (let i = currentCount; i < Math.min(targetCount, this.config.max); i++) {
      promises.push(this.addConnection());
    }
    
    await Promise.all(promises);
  }

  // ============================================
  // Private methods
  // ============================================

  private async addConnection(): Promise<void> {
    const id = `conn_${++this.connectionIdCounter}`;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const client = await this.createConnection();
        
        this.connections.set(id, {
          id,
          client,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          queryCount: 0,
          inUse: false
        });
        
        return;
      } catch (error) {
        if (attempt === this.config.retryAttempts) {
          throw new Error(`Failed to create connection after ${attempt} attempts: ${error}`);
        }
        await this.delay(this.config.retryDelay);
      }
    }
  }

  private async removeConnection(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (conn) {
      try {
        await this.destroyConnection(conn.client);
      } catch {
        // Ignore destroy errors
      }
      this.connections.delete(id);
    }
  }

  private waitForConnection(): Promise<PoolConnection> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(w => w.resolve === resolve);
        if (index > -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error('Connection acquire timeout'));
      }, this.config.acquireTimeout);
      
      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }

  private startReaper(): void {
    this.reapTimer = setInterval(async () => {
      const now = Date.now();
      const toRemove: string[] = [];
      
      for (const [id, conn] of this.connections) {
        // Don't remove if in use or below minimum
        if (conn.inUse || this.connections.size <= this.config.min) {
          continue;
        }
        
        // Remove if idle too long
        const idleTime = now - conn.lastUsedAt.getTime();
        if (idleTime > this.config.idleTimeout) {
          toRemove.push(id);
        }
      }
      
      for (const id of toRemove) {
        await this.removeConnection(id);
      }
    }, this.config.reapInterval);
  }

  private startHealthCheck(): void {
    if (this.config.healthCheckInterval > 0) {
      this.healthCheckTimer = setInterval(async () => {
        await this.healthCheck();
      }, this.config.healthCheckInterval);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// Factory functions
// ============================================

/**
 * Create a PostgreSQL pool manager
 */
export function createPostgresPool(connectionString: string, config?: PoolConfig): PoolManager {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg');
  
  return new PoolManager(
    config || {},
    async () => {
      const client = new Client({ connectionString });
      await client.connect();
      return client;
    },
    async (client) => {
      await client.end();
    },
    async (client) => {
      try {
        await client.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }
  );
}

/**
 * Create a MySQL pool manager
 */
export function createMySQLPool(connectionString: string, config?: PoolConfig): PoolManager {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql = require('mysql2/promise');
  
  // Parse connection string
  const url = new URL(connectionString);
  
  return new PoolManager(
    config || {},
    async () => {
      return await mysql.createConnection({
        host: url.hostname,
        port: parseInt(url.port) || 3306,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1)
      });
    },
    async (client) => {
      await client.end();
    },
    async (client) => {
      try {
        await client.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }
  );
}

/**
 * Create a SQLite pool manager (simulated pooling)
 */
export function createSQLitePool(dbPath: string, config?: PoolConfig): PoolManager {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  
  return new PoolManager(
    { ...config, max: 1 }, // SQLite is single-threaded
    async () => {
      return new Database(dbPath);
    },
    async (client) => {
      client.close();
    },
    async (client) => {
      try {
        client.prepare('SELECT 1').get();
        return true;
      } catch {
        return false;
      }
    }
  );
}

// ============================================
// Connection wrapper with retry
// ============================================

export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  factor?: number;
}

/**
 * Execute with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 5000,
    factor = 2
  } = config;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Circuit breaker for connection failures
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private resetTimeout: number = 30000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      
      // Success - reset failures
      if (this.state === 'half-open') {
        this.state = 'closed';
      }
      this.failures = 0;
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      
      throw error;
    }
  }
  
  getState(): { state: string; failures: number } {
    return {
      state: this.state,
      failures: this.failures
    };
  }
  
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}
