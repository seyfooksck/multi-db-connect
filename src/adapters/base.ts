// ============================================
// SDBC - Base Adapter
// Abstract base class for all database adapters
// ============================================

import type {
  DatabaseAdapter,
  DatabaseProvider,
  DatabaseCapabilities,
  QueryFilter,
  QueryOptions,
  UpdateFilter,
  UpdateResult,
  DeleteResult,
  ISchema
} from '../types';

export abstract class BaseAdapter implements DatabaseAdapter {
  abstract name: DatabaseProvider;
  abstract capabilities: DatabaseCapabilities;
  
  protected connected = false;

  abstract connect(uri: string, options?: Record<string, unknown>): Promise<void>;
  abstract disconnect(): Promise<void>;
  
  isConnected(): boolean {
    return this.connected;
  }

  abstract createCollection(name: string, schema: ISchema): Promise<void>;
  abstract dropCollection(name: string): Promise<void>;

  abstract insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>>;
  abstract insertMany(collection: string, docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;

  abstract find(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown>[]>;
  abstract findOne(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown> | null>;

  abstract updateOne(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;
  abstract updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;

  abstract deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult>;
  abstract deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult>;

  abstract countDocuments(collection: string, filter: QueryFilter): Promise<number>;

  /**
   * Bağlantı durumunu kontrol et
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`${this.name} adapter is not connected`);
    }
  }

  /**
   * Sort objesini SQL ORDER BY string'e çevir
   */
  protected sortToOrderBy(sort?: Record<string, 1 | -1>): string {
    if (!sort || Object.keys(sort).length === 0) return '';
    
    const clauses = Object.entries(sort)
      .map(([field, order]) => `${field} ${order === 1 ? 'ASC' : 'DESC'}`);
    
    return `ORDER BY ${clauses.join(', ')}`;
  }

  /**
   * Select alanlarını SQL'e çevir
   */
  protected selectToColumns(select?: QueryOptions['select']): string {
    if (!select) return '*';
    
    if (typeof select === 'string') {
      return select.split(' ').filter(s => !s.startsWith('-')).join(', ') || '*';
    }
    
    if (Array.isArray(select)) {
      return select.join(', ');
    }
    
    // Record<string, 0 | 1>
    const included = Object.entries(select)
      .filter(([, v]) => v === 1)
      .map(([k]) => k);
    
    return included.length > 0 ? included.join(', ') : '*';
  }
}
