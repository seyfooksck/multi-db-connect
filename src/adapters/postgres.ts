// ============================================
// SDBC - PostgreSQL Adapter
// Node-postgres (pg) implementation
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
import { parseQueryFilter, toSQLWhere, toSQLUpdate } from '../utils/query-parser';
import { generateId } from '../utils/id-generator';

// PostgreSQL types
import type { Pool } from 'pg';

export class PostgreSQLAdapter extends BaseAdapter {
  name = 'postgres' as const;
  capabilities: DatabaseCapabilities = {
    joins: true,
    json: true,
    transactions: true,
    aggregation: true,
    changeStreams: false,
    fullTextSearch: true
  };

  private pool: Pool | null = null;
  private schemas: Map<string, ISchema> = new Map();

  async connect(uri: string, options?: Record<string, unknown>): Promise<void> {
    try {
      const { Pool } = await import('pg');
      
      this.pool = new Pool({
        connectionString: uri,
        ...options
      });
      
      // Bağlantıyı test et
      const client = await this.pool.connect();
      client.release();
      this.connected = true;
    } catch (error) {
      throw new Error(`PostgreSQL connection failed: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  private async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.ensureConnected();
    const result = await this.pool!.query(sql, params);
    return result.rows;
  }

  async createCollection(name: string, schema: ISchema): Promise<void> {
    this.ensureConnected();
    this.schemas.set(name, schema);
    
    // PostgreSQL için tablo oluştur
    const columns = this.schemaToColumns(schema);
    const sql = `CREATE TABLE IF NOT EXISTS "${name}" (${columns})`;
    
    await this.query(sql);
    
    // Index'leri oluştur
    for (const [field, def] of Object.entries(schema.definition)) {
      const fieldDef = def as { unique?: boolean; index?: boolean };
      if (fieldDef.unique) {
        await this.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_${name}_${field}" ON "${name}" ("${field}")`);
      } else if (fieldDef.index) {
        await this.query(`CREATE INDEX IF NOT EXISTS "idx_${name}_${field}" ON "${name}" ("${field}")`);
      }
    }
  }

  async dropCollection(name: string): Promise<void> {
    this.ensureConnected();
    await this.query(`DROP TABLE IF EXISTS "${name}" CASCADE`);
    this.schemas.delete(name);
  }

  async insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const docWithId = {
      _id: doc._id || generateId(),
      ...doc
    };
    
    const keys = Object.keys(docWithId);
    const values = Object.values(docWithId);
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    
    const sql = `INSERT INTO "${collection}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const [result] = await this.query(sql, values);
    
    return result;
  }

  async insertMany(collection: string, docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    
    for (const doc of docs) {
      const result = await this.insertOne(collection, doc);
      results.push(result);
    }
    
    return results;
  }

  async find(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = toSQLWhere(conditions, '$');
    
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
    
    return this.query(sql, params);
  }

  async findOne(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown> | null> {
    const results = await this.find(collection, filter, { ...options, limit: 1 });
    return results[0] || null;
  }

  async updateOne(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    // Önce eşleşen bir kayıt bul
    const existing = await this.findOne(collection, filter);
    if (!existing) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    const { sql, params } = toSQLUpdate(collection, update, `"_id" = $1`, [existing._id], '$');
    // SQL'deki tablo adını düzelt
    const fixedSql = sql.replace(collection, `"${collection}"`);
    
    await this.query(fixedSql, params);
    
    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0
    };
  }

  async updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params: whereParams } = toSQLWhere(conditions, '$');
    
    // Eşleşen kayıtları say
    const countResult = await this.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM "${collection}" WHERE ${where}`,
      whereParams
    );
    const matchedCount = parseInt(countResult[0]?.count || '0', 10);
    
    if (matchedCount === 0) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    const { sql, params } = toSQLUpdate(`"${collection}"`, update, where, whereParams, '$');
    await this.query(sql, params);
    
    return {
      acknowledged: true,
      matchedCount,
      modifiedCount: matchedCount,
      upsertedCount: 0
    };
  }

  async deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const existing = await this.findOne(collection, filter);
    if (!existing) {
      return { acknowledged: true, deletedCount: 0 };
    }
    
    await this.query(`DELETE FROM "${collection}" WHERE "_id" = $1`, [existing._id]);
    
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = toSQLWhere(conditions, '$');
    
    const result = await this.query<{ count: string }>(
      `WITH deleted AS (DELETE FROM "${collection}" WHERE ${where} RETURNING *) SELECT COUNT(*) as count FROM deleted`,
      params
    );
    
    return {
      acknowledged: true,
      deletedCount: parseInt(result[0]?.count || '0', 10)
    };
  }

  async countDocuments(collection: string, filter: QueryFilter): Promise<number> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = toSQLWhere(conditions, '$');
    
    const result = await this.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM "${collection}" WHERE ${where}`,
      params
    );
    
    return parseInt(result[0]?.count || '0', 10);
  }

  /**
   * Schema'yı PostgreSQL sütun tanımlarına çevir
   */
  private schemaToColumns(schema: ISchema): string {
    const columns: string[] = ['"_id" VARCHAR(36) PRIMARY KEY'];
    
    for (const [key, fieldDef] of Object.entries(schema.definition)) {
      if (key === '_id') continue;
      
      const def = fieldDef as { 
        type: any; 
        required?: boolean; 
        unique?: boolean; 
        default?: unknown;
      };
      
      const pgType = this.typeToPG(def.type);
      let column = `"${key}" ${pgType}`;
      
      if (def.required) column += ' NOT NULL';
      if (def.default !== undefined && typeof def.default !== 'function') {
        column += ` DEFAULT ${this.defaultToPG(def.default)}`;
      }
      
      columns.push(column);
    }
    
    return columns.join(', ');
  }

  /**
   * JavaScript tipini PostgreSQL tipine çevir
   */
  private typeToPG(type: any): string {
    switch (type) {
      case String:
      case 'ObjectId':
        return 'VARCHAR(255)';
      case Number:
        return 'DOUBLE PRECISION';
      case Boolean:
        return 'BOOLEAN';
      case Date:
        return 'TIMESTAMP';
      case Array:
      case Object:
      case 'Mixed':
        return 'JSONB';
      default:
        return 'TEXT';
    }
  }

  /**
   * Default değeri PostgreSQL formatına çevir
   */
  private defaultToPG(value: unknown): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    if (typeof value === 'object') return `'${JSON.stringify(value)}'::jsonb`;
    return String(value);
  }
}
