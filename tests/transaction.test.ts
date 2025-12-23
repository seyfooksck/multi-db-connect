// ============================================
// SDBC - Transaction Tests
// ============================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Transaction,
  TransactionManager,
  getTransactionManager,
  setTransactionManager,
  withTransaction
} from '../src/Transaction';

// Mock adapter
const createMockAdapter = (name: string = 'postgres') => {
  const mockPool = {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }),
    query: vi.fn().mockResolvedValue({ rows: [] })
  };

  return {
    name,
    pool: mockPool,
    client: name === 'mongodb' ? {
      startSession: vi.fn().mockReturnValue({
        startTransaction: vi.fn(),
        commitTransaction: vi.fn().mockResolvedValue(undefined),
        abortTransaction: vi.fn().mockResolvedValue(undefined),
        endSession: vi.fn().mockResolvedValue(undefined)
      })
    } : undefined,
    db: name === 'mongodb' ? {
      collection: vi.fn().mockReturnValue({
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }),
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        }),
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 })
      })
    } : undefined,
    insertOne: vi.fn().mockResolvedValue({ _id: 'mock-id', name: 'test' }),
    find: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    query: vi.fn().mockResolvedValue([])
  } as any;
};

describe('Transaction', () => {
  describe('Transaction Class', () => {
    it('should create transaction with default options', () => {
      const adapter = createMockAdapter();
      const trx = new Transaction(adapter);
      
      expect(trx.isActive).toBe(false);
      expect(trx.isCommitted).toBe(false);
      expect(trx.isRolledBack).toBe(false);
    });

    it('should create transaction with custom options', () => {
      const adapter = createMockAdapter();
      const trx = new Transaction(adapter, {
        isolationLevel: 'SERIALIZABLE',
        timeout: 5000,
        autoRollback: false
      });
      
      expect(trx).toBeDefined();
    });

    it('should begin transaction for postgres', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      
      expect(trx.isActive).toBe(true);
      expect(adapter.pool.connect).toHaveBeenCalled();
    });

    it('should throw if begin called twice', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      
      await expect(trx.begin()).rejects.toThrow('Transaction already started');
    });

    it('should commit transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      await trx.commit();
      
      expect(trx.isCommitted).toBe(true);
      expect(trx.isActive).toBe(false);
    });

    it('should throw when committing without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.commit()).rejects.toThrow('No active transaction to commit');
    });

    it('should throw when committing twice', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      await trx.commit();
      
      await expect(trx.commit()).rejects.toThrow('Transaction already ended');
    });

    it('should rollback transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      await trx.rollback();
      
      expect(trx.isRolledBack).toBe(true);
      expect(trx.isActive).toBe(false);
    });

    it('should throw when rolling back committed transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      await trx.commit();
      
      await expect(trx.rollback()).rejects.toThrow('Cannot rollback committed transaction');
    });

    it('should not throw when rolling back twice', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      await trx.rollback();
      await trx.rollback(); // Should not throw
      
      expect(trx.isRolledBack).toBe(true);
    });

    it('should track duration', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 10));
      
      expect(trx.duration).toBeGreaterThan(0);
    });
  });

  describe('Transaction with PostgreSQL', () => {
    it('should use isolation level', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter, { isolationLevel: 'SERIALIZABLE' });
      
      await trx.begin();
      
      const client = await adapter.pool.connect();
      expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL SERIALIZABLE');
    });
  });

  describe('Transaction with MySQL', () => {
    it('should begin MySQL transaction', async () => {
      const mockConnection = {
        query: vi.fn().mockResolvedValue([]),
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn()
      };

      const adapter = {
        name: 'mysql',
        pool: {
          getConnection: vi.fn().mockResolvedValue(mockConnection)
        }
      } as any;

      const trx = new Transaction(adapter);
      await trx.begin();
      
      expect(trx.isActive).toBe(true);
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
    });
  });

  describe('Transaction with MongoDB', () => {
    it('should start MongoDB session', async () => {
      const adapter = createMockAdapter('mongodb');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      
      expect(trx.isActive).toBe(true);
      expect(adapter.client.startSession).toHaveBeenCalled();
    });
  });

  describe('Transaction with SQLite', () => {
    it('should begin SQLite transaction', async () => {
      const adapter = {
        name: 'sqlite',
        query: vi.fn().mockResolvedValue([])
      } as any;

      const trx = new Transaction(adapter);
      await trx.begin();
      
      expect(trx.isActive).toBe(true);
      expect(adapter.query).toHaveBeenCalledWith('BEGIN TRANSACTION', []);
    });
  });

  describe('Transaction Operations', () => {
    it('should throw query without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.query('SELECT * FROM users')).rejects.toThrow('No active transaction');
    });

    it('should throw insert without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.insert('users', { name: 'test' })).rejects.toThrow('No active transaction');
    });

    it('should throw find without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.find('users', {})).rejects.toThrow('No active transaction');
    });

    it('should throw update without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.update('users', {}, { name: 'test' })).rejects.toThrow('No active transaction');
    });

    it('should throw delete without active transaction', async () => {
      const adapter = createMockAdapter('postgres');
      const trx = new Transaction(adapter);
      
      await expect(trx.delete('users', {})).rejects.toThrow('No active transaction');
    });

    it('should throw for MongoDB query method', async () => {
      const adapter = createMockAdapter('mongodb');
      const trx = new Transaction(adapter);
      
      await trx.begin();
      
      await expect(trx.query('SELECT * FROM users')).rejects.toThrow('Use MongoDB methods');
    });
  });
});

describe('TransactionManager', () => {
  it('should create transaction', () => {
    const adapter = createMockAdapter();
    const manager = new TransactionManager(adapter);
    
    const trx = manager.create();
    expect(trx).toBeInstanceOf(Transaction);
  });

  it('should create transaction with options', () => {
    const adapter = createMockAdapter();
    const manager = new TransactionManager(adapter);
    
    const trx = manager.create({ isolationLevel: 'SERIALIZABLE' });
    expect(trx).toBeInstanceOf(Transaction);
  });

  it('should run callback and commit on success', async () => {
    const adapter = createMockAdapter('postgres');
    const manager = new TransactionManager(adapter);
    
    const result = await manager.run(async (trx) => {
      return 'success';
    });
    
    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should run callback and rollback on error', async () => {
    const adapter = createMockAdapter('postgres');
    const manager = new TransactionManager(adapter);
    
    const result = await manager.run(async (trx) => {
      throw new Error('Test error');
    });
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Test error');
  });

  it('should execute atomic operations', async () => {
    const adapter = createMockAdapter('postgres');
    const manager = new TransactionManager(adapter);
    
    const ops = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3)
    ];
    
    const result = await manager.atomic(ops);
    
    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });
});

describe('Helper Functions', () => {
  beforeEach(() => {
    // Reset global state
    (global as any).globalTransactionManager = null;
  });

  it('should create transaction manager with adapter', () => {
    const adapter = createMockAdapter();
    const manager = getTransactionManager(adapter);
    
    expect(manager).toBeInstanceOf(TransactionManager);
  });

  it('should throw without adapter and no global manager', () => {
    expect(() => getTransactionManager()).toThrow('No adapter provided');
  });

  it('should set and get global transaction manager', () => {
    const adapter = createMockAdapter();
    setTransactionManager(adapter);
    
    const manager = getTransactionManager(adapter);
    expect(manager).toBeInstanceOf(TransactionManager);
  });

  it('should use withTransaction helper', async () => {
    const adapter = createMockAdapter('postgres');
    
    const result = await withTransaction(adapter, async (trx) => {
      return 'data';
    });
    
    expect(result.success).toBe(true);
    expect(result.data).toBe('data');
  });

  it('should withTransaction handle errors', async () => {
    const adapter = createMockAdapter('postgres');
    
    const result = await withTransaction(adapter, async (trx) => {
      throw new Error('Oops');
    });
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Oops');
  });
});

describe('Transaction Edge Cases', () => {
  it('should handle unsupported adapter', async () => {
    const adapter = {
      name: 'unknown'
    } as any;
    
    const trx = new Transaction(adapter);
    
    await expect(trx.begin()).rejects.toThrow('Transactions not supported for unknown');
  });

  it('should handle missing pool for postgres', async () => {
    const adapter = {
      name: 'postgres',
      pool: null
    } as any;
    
    const trx = new Transaction(adapter);
    
    await expect(trx.begin()).rejects.toThrow('PostgreSQL pool not available');
  });

  it('should handle missing pool for mysql', async () => {
    const adapter = {
      name: 'mysql',
      pool: null
    } as any;
    
    const trx = new Transaction(adapter);
    
    await expect(trx.begin()).rejects.toThrow('MySQL pool not available');
  });

  it('should handle missing client for mongodb', async () => {
    const adapter = {
      name: 'mongodb',
      client: null
    } as any;
    
    const trx = new Transaction(adapter);
    
    await expect(trx.begin()).rejects.toThrow('MongoDB client not available');
  });
});
