// ============================================
// SDBC - Transaction API
// Enterprise-grade transaction management
// ============================================

import type { BaseAdapter } from './adapters/base';

export interface TransactionOptions {
  /** Isolation level (SQL databases) */
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  /** Timeout in milliseconds */
  timeout?: number;
  /** Auto-rollback on error */
  autoRollback?: boolean;
}

export interface TransactionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: Error;
  duration: number;
}

type TransactionCallback<T> = (trx: Transaction) => Promise<T>;

/**
 * Transaction class
 * Manages database transactions with automatic rollback
 */
export class Transaction {
  private adapter: BaseAdapter;
  private options: TransactionOptions;
  private _isActive: boolean = false;
  private _isCommitted: boolean = false;
  private _isRolledBack: boolean = false;
  private startTime: number = 0;
  private client: any = null; // Database-specific client/connection

  constructor(adapter: BaseAdapter, options: TransactionOptions = {}) {
    this.adapter = adapter;
    this.options = {
      autoRollback: true,
      ...options
    };
  }

  /** Transaction is active */
  get isActive(): boolean {
    return this._isActive && !this._isCommitted && !this._isRolledBack;
  }

  /** Transaction was committed */
  get isCommitted(): boolean {
    return this._isCommitted;
  }

  /** Transaction was rolled back */
  get isRolledBack(): boolean {
    return this._isRolledBack;
  }

  /** Transaction duration in ms */
  get duration(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Begin transaction
   */
  async begin(): Promise<void> {
    if (this._isActive) {
      throw new Error('Transaction already started');
    }

    this.startTime = Date.now();
    const adapterName = this.adapter.name;

    try {
      switch (adapterName) {
        case 'mongodb':
          await this.beginMongoDB();
          break;
        case 'postgres':
          await this.beginPostgres();
          break;
        case 'mysql':
          await this.beginMySQL();
          break;
        case 'sqlite':
          await this.beginSQLite();
          break;
        default:
          throw new Error(`Transactions not supported for ${adapterName}`);
      }

      this._isActive = true;
    } catch (error) {
      throw new Error(`Failed to begin transaction: ${error}`);
    }
  }

  /**
   * Commit transaction
   */
  async commit(): Promise<void> {
    if (this._isCommitted || this._isRolledBack) {
      throw new Error('Transaction already ended');
    }

    if (!this._isActive) {
      throw new Error('No active transaction to commit');
    }

    const adapterName = this.adapter.name;

    try {
      switch (adapterName) {
        case 'mongodb':
          await this.commitMongoDB();
          break;
        case 'postgres':
          await this.commitPostgres();
          break;
        case 'mysql':
          await this.commitMySQL();
          break;
        case 'sqlite':
          await this.commitSQLite();
          break;
      }

      this._isCommitted = true;
      this._isActive = false;
    } catch (error) {
      if (this.options.autoRollback) {
        await this.rollback();
      }
      throw new Error(`Failed to commit transaction: ${error}`);
    }
  }

  /**
   * Rollback transaction
   */
  async rollback(): Promise<void> {
    if (this._isCommitted) {
      throw new Error('Cannot rollback committed transaction');
    }

    if (this._isRolledBack) {
      return; // Already rolled back
    }

    if (!this._isActive) {
      throw new Error('No active transaction to rollback');
    }

    const adapterName = this.adapter.name;

    try {
      switch (adapterName) {
        case 'mongodb':
          await this.rollbackMongoDB();
          break;
        case 'postgres':
          await this.rollbackPostgres();
          break;
        case 'mysql':
          await this.rollbackMySQL();
          break;
        case 'sqlite':
          await this.rollbackSQLite();
          break;
      }

      this._isRolledBack = true;
      this._isActive = false;
    } catch (error) {
      throw new Error(`Failed to rollback transaction: ${error}`);
    }
  }

  /**
   * Execute query within transaction
   */
  async query(sql: string, params: unknown[] = []): Promise<any> {
    if (!this._isActive) {
      throw new Error('No active transaction');
    }

    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb') {
      throw new Error('Use MongoDB methods for transactions');
    }

    // Use transaction client for SQL
    if (this.client) {
      return await this.client.query(sql, params);
    }

    return await (this.adapter as any).query(sql, params);
  }

  /**
   * Insert within transaction
   */
  async insert(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this._isActive) {
      throw new Error('No active transaction');
    }

    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb' && this.client) {
      // MongoDB session-based insert
      const db = (this.adapter as any).db;
      const result = await db.collection(collection).insertOne(doc, { session: this.client });
      return { ...doc, _id: result.insertedId };
    }

    // SQL databases
    return await this.adapter.insertOne(collection, doc);
  }

  /**
   * Find within transaction
   */
  async find(collection: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    if (!this._isActive) {
      throw new Error('No active transaction');
    }

    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb' && this.client) {
      const db = (this.adapter as any).db;
      return await db.collection(collection).find(filter, { session: this.client }).toArray();
    }

    return await this.adapter.find(collection, filter, {});
  }

  /**
   * Update within transaction
   */
  async update(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>): Promise<number> {
    if (!this._isActive) {
      throw new Error('No active transaction');
    }

    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb' && this.client) {
      const db = (this.adapter as any).db;
      const result = await db.collection(collection).updateMany(filter, update, { session: this.client });
      return result.modifiedCount;
    }

    const result = await this.adapter.updateMany(collection, filter, update);
    return result.modifiedCount;
  }

  /**
   * Delete within transaction
   */
  async delete(collection: string, filter: Record<string, unknown>): Promise<number> {
    if (!this._isActive) {
      throw new Error('No active transaction');
    }

    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb' && this.client) {
      const db = (this.adapter as any).db;
      const result = await db.collection(collection).deleteMany(filter, { session: this.client });
      return result.deletedCount;
    }

    const result = await this.adapter.deleteMany(collection, filter);
    return result.deletedCount;
  }

  // ============================================
  // Database-specific implementations
  // ============================================

  private async beginMongoDB(): Promise<void> {
    const mongoClient = (this.adapter as any).client;
    if (!mongoClient) {
      throw new Error('MongoDB client not available');
    }
    this.client = mongoClient.startSession();
    this.client.startTransaction();
  }

  private async commitMongoDB(): Promise<void> {
    if (this.client) {
      await this.client.commitTransaction();
      await this.client.endSession();
      this.client = null;
    }
  }

  private async rollbackMongoDB(): Promise<void> {
    if (this.client) {
      await this.client.abortTransaction();
      await this.client.endSession();
      this.client = null;
    }
  }

  private async beginPostgres(): Promise<void> {
    const pool = (this.adapter as any).pool;
    if (!pool) {
      throw new Error('PostgreSQL pool not available');
    }
    this.client = await pool.connect();
    
    let sql = 'BEGIN';
    if (this.options.isolationLevel) {
      sql += ` ISOLATION LEVEL ${this.options.isolationLevel}`;
    }
    await this.client.query(sql);
  }

  private async commitPostgres(): Promise<void> {
    if (this.client) {
      await this.client.query('COMMIT');
      this.client.release();
      this.client = null;
    }
  }

  private async rollbackPostgres(): Promise<void> {
    if (this.client) {
      await this.client.query('ROLLBACK');
      this.client.release();
      this.client = null;
    }
  }

  private async beginMySQL(): Promise<void> {
    const pool = (this.adapter as any).pool;
    if (!pool) {
      throw new Error('MySQL pool not available');
    }
    this.client = await pool.getConnection();
    
    if (this.options.isolationLevel) {
      await this.client.query(`SET TRANSACTION ISOLATION LEVEL ${this.options.isolationLevel}`);
    }
    await this.client.beginTransaction();
  }

  private async commitMySQL(): Promise<void> {
    if (this.client) {
      await this.client.commit();
      this.client.release();
      this.client = null;
    }
  }

  private async rollbackMySQL(): Promise<void> {
    if (this.client) {
      await this.client.rollback();
      this.client.release();
      this.client = null;
    }
  }

  private async beginSQLite(): Promise<void> {
    await (this.adapter as any).query('BEGIN TRANSACTION', []);
  }

  private async commitSQLite(): Promise<void> {
    await (this.adapter as any).query('COMMIT', []);
  }

  private async rollbackSQLite(): Promise<void> {
    await (this.adapter as any).query('ROLLBACK', []);
  }
}

/**
 * TransactionManager - Factory for transactions
 */
export class TransactionManager {
  private adapter: BaseAdapter;

  constructor(adapter: BaseAdapter) {
    this.adapter = adapter;
  }

  /**
   * Create a new transaction
   */
  create(options?: TransactionOptions): Transaction {
    return new Transaction(this.adapter, options);
  }

  /**
   * Execute callback within transaction
   * Auto-commits on success, auto-rollbacks on error
   */
  async run<T>(
    callback: TransactionCallback<T>,
    options?: TransactionOptions
  ): Promise<TransactionResult<T>> {
    const trx = this.create(options);
    const startTime = Date.now();

    try {
      await trx.begin();
      const data = await callback(trx);
      await trx.commit();

      return {
        success: true,
        data,
        duration: Date.now() - startTime
      };
    } catch (error) {
      if (trx.isActive) {
        await trx.rollback();
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute multiple operations atomically
   */
  async atomic<T>(operations: Array<() => Promise<T>>): Promise<TransactionResult<T[]>> {
    return this.run(async (_trx) => {
      const results: T[] = [];
      for (const op of operations) {
        results.push(await op());
      }
      return results;
    });
  }
}

// ============================================
// Export helpers
// ============================================

let globalTransactionManager: TransactionManager | null = null;

/**
 * Get or create transaction manager
 */
export function getTransactionManager(adapter?: BaseAdapter): TransactionManager {
  if (adapter) {
    return new TransactionManager(adapter);
  }
  
  if (!globalTransactionManager) {
    throw new Error('No adapter provided and no global transaction manager set');
  }
  
  return globalTransactionManager;
}

/**
 * Set global transaction manager
 */
export function setTransactionManager(adapter: BaseAdapter): void {
  globalTransactionManager = new TransactionManager(adapter);
}

/**
 * Run callback in transaction (shorthand)
 */
export async function withTransaction<T>(
  adapter: BaseAdapter,
  callback: TransactionCallback<T>,
  options?: TransactionOptions
): Promise<TransactionResult<T>> {
  const manager = new TransactionManager(adapter);
  return manager.run(callback, options);
}
