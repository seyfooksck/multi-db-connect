// ============================================
// SDBC - SQLite Adapter
// better-sqlite3 implementation
// ============================================

import { BaseAdapter } from './base';
import type {
  DatabaseCapabilities,
  QueryFilter,
  QueryOptions,
  UpdateFilter,
  UpdateResult,
  DeleteResult,
  ISchema
} from '../types';
import { parseQueryFilter, toSQLWhere, parseUpdateFilter } from '../utils/query-parser';
import { generateId } from '../utils/id-generator';

// SQLite types
type Database = import('better-sqlite3').Database;

export class SQLiteAdapter extends BaseAdapter {
  name = 'sqlite' as const;
  capabilities: DatabaseCapabilities = {
    joins: true,
    json: false, // SQLite JSON desteği sınırlı
    transactions: true,
    aggregation: true,
    changeStreams: false,
    fullTextSearch: false
  };

  private db: Database | null = null;
  private schemas: Map<string, ISchema> = new Map();

  async connect(uri: string, options?: Record<string, unknown>): Promise<void> {
    try {
      const BetterSqlite3 = (await import('better-sqlite3')).default;
      
      // URI'den dosya yolunu çıkar
      const filePath = uri.replace('sqlite://', '').replace('sqlite:', '');
      
      this.db = new BetterSqlite3(filePath || ':memory:', options as any);
      this.connected = true;
    } catch (error) {
      throw new Error(`SQLite connection failed: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  private run(sql: string, params: unknown[] = []): any {
    this.ensureConnected();
    return this.db!.prepare(sql).run(...params);
  }

  private all<T = any>(sql: string, params: unknown[] = []): T[] {
    this.ensureConnected();
    return this.db!.prepare(sql).all(...params) as T[];
  }

  private get<T = any>(sql: string, params: unknown[] = []): T | undefined {
    this.ensureConnected();
    return this.db!.prepare(sql).get(...params) as T | undefined;
  }

  async createCollection(name: string, schema: ISchema): Promise<void> {
    this.ensureConnected();
    this.schemas.set(name, schema);
    
    const columns = this.schemaToColumns(schema);
    const sql = `CREATE TABLE IF NOT EXISTS "${name}" (${columns})`;
    
    this.run(sql);
    
    // Index'leri oluştur
    for (const [field, def] of Object.entries(schema.definition)) {
      const fieldDef = def as { unique?: boolean; index?: boolean };
      try {
        if (fieldDef.unique) {
          this.run(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_${name}_${field}" ON "${name}" ("${field}")`);
        } else if (fieldDef.index) {
          this.run(`CREATE INDEX IF NOT EXISTS "idx_${name}_${field}" ON "${name}" ("${field}")`);
        }
      } catch {
        // Index oluşturulamazsa görmezden gel
      }
    }
  }

  async dropCollection(name: string): Promise<void> {
    this.ensureConnected();
    this.run(`DROP TABLE IF EXISTS "${name}"`);
    this.schemas.delete(name);
  }

  async insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const docWithId = {
      _id: doc._id || generateId(),
      ...doc
    };
    
    const keys = Object.keys(docWithId);
    const values = Object.values(docWithId).map(v => this.serializeValue(v));
    const placeholders = keys.map(() => '?');
    
    const sql = `INSERT INTO "${collection}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;
    this.run(sql, values);
    
    return docWithId;
  }

  async insertMany(collection: string, docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    
    // Transaction kullan
    const insertMany = this.db!.transaction((docs: Record<string, unknown>[]) => {
      for (const doc of docs) {
        const docWithId = {
          _id: doc._id || generateId(),
          ...doc
        };
        
        const keys = Object.keys(docWithId);
        const values = Object.values(docWithId).map(v => this.serializeValue(v));
        const placeholders = keys.map(() => '?');
        
        const sql = `INSERT INTO "${collection}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;
        this.run(sql, values);
        results.push(docWithId);
      }
    });
    
    insertMany(docs);
    return results;
  }

  async find(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = this.toSQLiteWhere(conditions);
    
    const columns = this.selectToColumns(options?.select);
    let sql = `SELECT ${columns} FROM "${collection}" WHERE ${where}`;
    
    if (options?.sort) {
      sql += ` ${this.sortToOrderBy(options.sort)}`;
    }
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    if (options?.skip) {
      sql += ` OFFSET ${options.skip}`;
    }
    
    const rows = this.all(sql, params);
    return rows.map(row => this.deserializeRow(row));
  }

  async findOne(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown> | null> {
    const results = await this.find(collection, filter, { ...options, limit: 1 });
    return results[0] || null;
  }

  async updateOne(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const existing = await this.findOne(collection, filter);
    if (!existing) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    const parsed = parseUpdateFilter(update);
    const setClauses: string[] = [];
    const params: unknown[] = [];
    
    for (const [key, value] of Object.entries(parsed.sets)) {
      setClauses.push(`"${key}" = ?`);
      params.push(this.serializeValue(value));
    }
    
    for (const [key, amount] of Object.entries(parsed.increments)) {
      setClauses.push(`"${key}" = "${key}" + ?`);
      params.push(amount);
    }
    
    for (const key of parsed.unsets) {
      setClauses.push(`"${key}" = NULL`);
    }
    
    if (setClauses.length === 0) {
      return {
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    params.push(existing._id);
    const sql = `UPDATE "${collection}" SET ${setClauses.join(', ')} WHERE "_id" = ?`;
    const result = this.run(sql, params);
    
    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: result.changes,
      upsertedCount: 0
    };
  }

  async updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params: whereParams } = this.toSQLiteWhere(conditions);
    
    const parsed = parseUpdateFilter(update);
    const setClauses: string[] = [];
    const params: unknown[] = [];
    
    for (const [key, value] of Object.entries(parsed.sets)) {
      setClauses.push(`"${key}" = ?`);
      params.push(this.serializeValue(value));
    }
    
    for (const [key, amount] of Object.entries(parsed.increments)) {
      setClauses.push(`"${key}" = "${key}" + ?`);
      params.push(amount);
    }
    
    for (const key of parsed.unsets) {
      setClauses.push(`"${key}" = NULL`);
    }
    
    if (setClauses.length === 0) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    const sql = `UPDATE "${collection}" SET ${setClauses.join(', ')} WHERE ${where}`;
    const result = this.run(sql, [...params, ...whereParams]);
    
    return {
      acknowledged: true,
      matchedCount: result.changes,
      modifiedCount: result.changes,
      upsertedCount: 0
    };
  }

  async deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const existing = await this.findOne(collection, filter);
    if (!existing) {
      return { acknowledged: true, deletedCount: 0 };
    }
    
    const result = this.run(`DELETE FROM "${collection}" WHERE "_id" = ?`, [existing._id]);
    
    return { acknowledged: true, deletedCount: result.changes };
  }

  async deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = this.toSQLiteWhere(conditions);
    
    const result = this.run(`DELETE FROM "${collection}" WHERE ${where}`, params);
    
    return {
      acknowledged: true,
      deletedCount: result.changes
    };
  }

  async countDocuments(collection: string, filter: QueryFilter): Promise<number> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = this.toSQLiteWhere(conditions);
    
    const result = this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM "${collection}" WHERE ${where}`,
      params
    );
    
    return result?.count || 0;
  }

  /**
   * SQLite için WHERE clause oluştur (? placeholder kullanır)
   */
  private toSQLiteWhere(conditions: any[]): { where: string; params: unknown[] } {
    const result = toSQLWhere(conditions, '?');
    // SQLite ? placeholder kullanır
    return {
      where: result.where.replace(/\?\d+/g, '?'),
      params: result.params
    };
  }

  /**
   * Schema'yı SQLite sütun tanımlarına çevir
   */
  private schemaToColumns(schema: ISchema): string {
    const columns: string[] = ['"_id" TEXT PRIMARY KEY'];
    
    for (const [key, fieldDef] of Object.entries(schema.definition)) {
      if (key === '_id') continue;
      
      const def = fieldDef as { 
        type: any; 
        required?: boolean; 
        default?: unknown;
      };
      
      const sqliteType = this.typeToSQLite(def.type);
      let column = `"${key}" ${sqliteType}`;
      
      if (def.required) column += ' NOT NULL';
      if (def.default !== undefined && typeof def.default !== 'function') {
        column += ` DEFAULT ${this.defaultToSQLite(def.default)}`;
      }
      
      columns.push(column);
    }
    
    return columns.join(', ');
  }

  /**
   * JavaScript tipini SQLite tipine çevir
   */
  private typeToSQLite(type: any): string {
    switch (type) {
      case String:
      case 'ObjectId':
        return 'TEXT';
      case Number:
        return 'REAL';
      case Boolean:
        return 'INTEGER'; // SQLite'da boolean yok, 0/1 kullanılır
      case Date:
        return 'TEXT'; // ISO string olarak saklanır
      case Array:
      case Object:
      case 'Mixed':
        return 'TEXT'; // JSON string olarak saklanır
      default:
        return 'TEXT';
    }
  }

  /**
   * Default değeri SQLite formatına çevir
   */
  private defaultToSQLite(value: unknown): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value === null) return 'NULL';
    if (typeof value === 'object') return `'${JSON.stringify(value)}'`;
    return String(value);
  }

  /**
   * Değeri SQLite'a kaydetmek için serialize et
   */
  private serializeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * SQLite'dan okunan satırı deserialize et
   */
  private deserializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string') {
        // JSON olabilir mi kontrol et
        if ((value.startsWith('{') && value.endsWith('}')) || 
            (value.startsWith('[') && value.endsWith(']'))) {
          try {
            result[key] = JSON.parse(value);
            continue;
          } catch {
            // JSON değilse string olarak bırak
          }
        }
        // ISO date string mi kontrol et
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          result[key] = new Date(value);
          continue;
        }
      }
      result[key] = value;
    }
    
    return result;
  }
}
