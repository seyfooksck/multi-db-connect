// ============================================
// SDBC - Pool Tests
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PoolManager,
  withRetry,
  CircuitBreaker
} from '../src/pool';

describe('Connection Pool', () => {
  describe('PoolManager', () => {
    let pool: PoolManager;
    let createCount: number;
    let destroyCount: number;

    beforeEach(() => {
      createCount = 0;
      destroyCount = 0;
      
      pool = new PoolManager(
        { min: 2, max: 5, acquireTimeout: 1000, idleTimeout: 500, reapInterval: 100 },
        async () => {
          createCount++;
          return { id: createCount, connected: true };
        },
        async () => {
          destroyCount++;
        },
        async (client) => client.connected
      );
    });

    afterEach(async () => {
      await pool.drain();
    });

    it('should initialize with minimum connections', async () => {
      await pool.initialize();
      
      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(2);
      expect(stats.idleConnections).toBe(2);
      expect(stats.activeConnections).toBe(0);
    });

    it('should acquire and release connections', async () => {
      await pool.initialize();
      
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.inUse).toBe(true);
      
      const stats1 = pool.getStats();
      expect(stats1.activeConnections).toBe(1);
      
      pool.release(conn);
      
      const stats2 = pool.getStats();
      expect(stats2.activeConnections).toBe(0);
      expect(stats2.idleConnections).toBe(2);
    });

    it('should create new connections when pool is exhausted', async () => {
      await pool.initialize();
      
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();
      
      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(3);
      expect(stats.activeConnections).toBe(3);
      
      pool.release(conn1);
      pool.release(conn2);
      pool.release(conn3);
    });

    it('should not exceed max connections', async () => {
      await pool.initialize();
      
      const connections = [];
      for (let i = 0; i < 5; i++) {
        connections.push(await pool.acquire());
      }
      
      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(5);
      
      // Should timeout when trying to acquire more
      const acquirePromise = pool.acquire();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), 500)
      );
      
      await expect(Promise.race([acquirePromise, timeoutPromise]))
        .rejects.toThrow();
      
      // Release all
      for (const conn of connections) {
        pool.release(conn);
      }
    });

    it('should execute query and track stats', async () => {
      await pool.initialize();
      
      const result = await pool.executeQuery(async (client) => {
        return client.id * 10;
      });
      
      expect(result).toBeGreaterThan(0);
      
      const stats = pool.getStats();
      expect(stats.totalQueries).toBe(1);
      expect(stats.failedQueries).toBe(0);
    });

    it('should track failed queries', async () => {
      await pool.initialize();
      
      await expect(pool.executeQuery(async () => {
        throw new Error('Query failed');
      })).rejects.toThrow('Query failed');
      
      const stats = pool.getStats();
      expect(stats.totalQueries).toBe(0);
      expect(stats.failedQueries).toBe(1);
    });

    it('should perform health check', async () => {
      await pool.initialize();
      
      const health = await pool.healthCheck();
      
      expect(health.healthy).toBe(true);
      expect(health.latency).toBeGreaterThanOrEqual(0);
      expect(health.message).toBe('Pool is healthy');
    });

    it('should resize pool', async () => {
      await pool.initialize();
      
      // Increase max
      await pool.resize(10);
      const stats1 = pool.getStats();
      expect(stats1.totalConnections).toBe(2); // Still minimum
      
      // Decrease max (but not below min)
      await pool.resize(1);
      const stats2 = pool.getStats();
      expect(stats2.totalConnections).toBe(2); // Cannot go below min
    });

    it('should warmup pool', async () => {
      await pool.initialize();
      
      await pool.warmup(4);
      
      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(4);
      expect(stats.idleConnections).toBe(4);
    });

    it('should drain pool', async () => {
      await pool.initialize();
      await pool.acquire();
      
      await pool.drain();
      
      const stats = pool.getStats();
      expect(stats.totalConnections).toBe(0);
    });

    it('should track uptime', async () => {
      await pool.initialize();
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 50));
      
      const stats = pool.getStats();
      expect(stats.uptime).toBeGreaterThan(0);
    });

    it('should handle waiting queue', async () => {
      const smallPool = new PoolManager(
        { min: 1, max: 1, acquireTimeout: 2000 },
        async () => ({ connected: true }),
        async () => {},
        async () => true
      );
      
      await smallPool.initialize();
      
      const conn1 = await smallPool.acquire();
      
      // Start waiting for connection
      const waitingPromise = smallPool.acquire();
      
      // Release after 100ms
      setTimeout(() => smallPool.release(conn1), 100);
      
      const conn2 = await waitingPromise;
      expect(conn2).toBeDefined();
      
      smallPool.release(conn2);
      await smallPool.drain();
    });
  });

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fail'));
      
      await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 }))
        .rejects.toThrow('always fail');
      
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should respect max delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const start = Date.now();
      await withRetry(fn, { baseDelay: 1000, maxDelay: 50 });
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('CircuitBreaker', () => {
    it('should be closed initially', () => {
      const breaker = new CircuitBreaker(3, 1000);
      
      expect(breaker.getState().state).toBe('closed');
      expect(breaker.getState().failures).toBe(0);
    });

    it('should allow execution when closed', async () => {
      const breaker = new CircuitBreaker(3, 1000);
      
      const result = await breaker.execute(async () => 'success');
      
      expect(result).toBe('success');
    });

    it('should count failures', async () => {
      const breaker = new CircuitBreaker(3, 1000);
      
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      
      expect(breaker.getState().failures).toBe(1);
    });

    it('should open after threshold failures', async () => {
      const breaker = new CircuitBreaker(3, 1000);
      
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch {}
      }
      
      expect(breaker.getState().state).toBe('open');
    });

    it('should reject when open', async () => {
      const breaker = new CircuitBreaker(1, 10000);
      
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      
      await expect(breaker.execute(async () => 'success'))
        .rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker(1, 50);
      
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      
      // Wait for reset timeout
      await new Promise(r => setTimeout(r, 100));
      
      // Should allow execution in half-open state
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState().state).toBe('closed');
    });

    it('should reset on success after failure', async () => {
      const breaker = new CircuitBreaker(3, 1000);
      
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch {}
      
      expect(breaker.getState().failures).toBe(1);
      
      await breaker.execute(async () => 'success');
      
      expect(breaker.getState().failures).toBe(0);
    });

    it('should reset manually', () => {
      const breaker = new CircuitBreaker(1, 10000);
      
      breaker.reset();
      
      expect(breaker.getState().state).toBe('closed');
      expect(breaker.getState().failures).toBe(0);
    });
  });
});

describe('Pool Stats', () => {
  it('should calculate average query time', async () => {
    const pool = new PoolManager(
      { min: 1, max: 5 },
      async () => ({ connected: true }),
      async () => {},
      async () => true
    );
    
    await pool.initialize();
    
    // Execute multiple queries
    for (let i = 0; i < 5; i++) {
      await pool.executeQuery(async () => {
        await new Promise(r => setTimeout(r, 10));
        return i;
      });
    }
    
    const stats = pool.getStats();
    expect(stats.totalQueries).toBe(5);
    expect(stats.averageQueryTime).toBeGreaterThan(0);
    
    await pool.drain();
  });
});
