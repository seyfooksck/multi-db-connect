// ============================================
// SDBC - MySQL Adapter
// mysql2 implementation
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
import { parseQueryFilter, toMySQLWhere, parseUpdateFilter } from '../utils/query-parser';
import { generateId } from '../utils/id-generator';

// MySQL types
type Pool = import('mysql2/promise').Pool;
type RowDataPacket = import('mysql2/promise').RowDataPacket;
type ResultSetHeader = import('mysql2/promise').ResultSetHeader;

export class MySQLAdapter extends BaseAdapter {
  name = 'mysql' as const;
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
      const mysql = await import('mysql2/promise');
      
      // URI'yi parse et
      const url = new URL(uri);
      
      this.pool = mysql.createPool({
        host: url.hostname,
        port: parseInt(url.port || '3306', 10),
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
        waitForConnections: true,
        connectionLimit: 10,
        ...options
      });
      
      // Bağlantıyı test et
      const conn = await this.pool.getConnection();
      conn.release();
      this.connected = true;
    } catch (error) {
      throw new Error(`MySQL connection failed: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  private async query<T = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
    this.ensureConnected();
    const [rows] = await this.pool!.execute(sql, params);
    return rows as T;
  }

  async createCollection(name: string, schema: ISchema): Promise<void> {
    this.ensureConnected();
    this.schemas.set(name, schema);
    
    const columns = this.schemaToColumns(schema);
    const sql = `CREATE TABLE IF NOT EXISTS \`${name}\` (${columns}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
    
    await this.query(sql);
    
    // Index'leri oluştur
    for (const [field, def] of Object.entries(schema.definition)) {
      const fieldDef = def as { unique?: boolean; index?: boolean };
      try {
        if (fieldDef.unique) {
          await this.query(`CREATE UNIQUE INDEX \`idx_${name}_${field}\` ON \`${name}\` (\`${field}\`)`);
        } else if (fieldDef.index) {
          await this.query(`CREATE INDEX \`idx_${name}_${field}\` ON \`${name}\` (\`${field}\`)`);
        }
      } catch {
        // Index zaten varsa görmezden gel
      }
    }
  }

  async dropCollection(name: string): Promise<void> {
    this.ensureConnected();
    await this.query(`DROP TABLE IF EXISTS \`${name}\``);
    this.schemas.delete(name);
  }

  async insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const docWithId = {
      _id: doc._id || generateId(),
      ...doc
    };
    
    const keys = Object.keys(docWithId);
    const values = Object.values(docWithId).map(v => 
      typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v
    );
    const placeholders = keys.map(() => '?');
    
    const sql = `INSERT INTO \`${collection}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${placeholders.join(', ')})`;
    await this.query(sql, values);
    
    return docWithId;
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
    const { where, params } = toMySQLWhere(conditions);
    
    const columns = this.selectToColumns(options?.select);
    let sql = `SELECT ${columns} FROM \`${collection}\` WHERE ${where}`;
    
    if (options?.sort) {
      sql += ` ${this.sortToOrderBy(options.sort)}`;
    }
    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }
    if (options?.skip) {
      sql += ` OFFSET ${options.skip}`;
    }
    
    const rows = await this.query<RowDataPacket[]>(sql, params);
    return rows.map(row => this.parseRow(row));
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
    
    // $set
    for (const [key, value] of Object.entries(parsed.sets)) {
      setClauses.push(`\`${key}\` = ?`);
      params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    }
    
    // $inc
    for (const [key, amount] of Object.entries(parsed.increments)) {
      setClauses.push(`\`${key}\` = \`${key}\` + ?`);
      params.push(amount);
    }
    
    // $unset
    for (const key of parsed.unsets) {
      setClauses.push(`\`${key}\` = NULL`);
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
    const sql = `UPDATE \`${collection}\` SET ${setClauses.join(', ')} WHERE \`_id\` = ?`;
    
    const result = await this.query<ResultSetHeader>(sql, params);
    
    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: result.affectedRows,
      upsertedCount: 0
    };
  }

  async updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params: whereParams } = toMySQLWhere(conditions);
    
    const parsed = parseUpdateFilter(update);
    const setClauses: string[] = [];
    const params: unknown[] = [];
    
    for (const [key, value] of Object.entries(parsed.sets)) {
      setClauses.push(`\`${key}\` = ?`);
      params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    }
    
    for (const [key, amount] of Object.entries(parsed.increments)) {
      setClauses.push(`\`${key}\` = \`${key}\` + ?`);
      params.push(amount);
    }
    
    for (const key of parsed.unsets) {
      setClauses.push(`\`${key}\` = NULL`);
    }
    
    if (setClauses.length === 0) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0
      };
    }
    
    const sql = `UPDATE \`${collection}\` SET ${setClauses.join(', ')} WHERE ${where}`;
    const result = await this.query<ResultSetHeader>(sql, [...params, ...whereParams]);
    
    return {
      acknowledged: true,
      matchedCount: result.affectedRows,
      modifiedCount: result.affectedRows,
      upsertedCount: 0
    };
  }

  async deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const existing = await this.findOne(collection, filter);
    if (!existing) {
      return { acknowledged: true, deletedCount: 0 };
    }
    
    await this.query(`DELETE FROM \`${collection}\` WHERE \`_id\` = ?`, [existing._id]);
    
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = toMySQLWhere(conditions);
    
    const result = await this.query<ResultSetHeader>(
      `DELETE FROM \`${collection}\` WHERE ${where}`,
      params
    );
    
    return {
      acknowledged: true,
      deletedCount: result.affectedRows
    };
  }

  async countDocuments(collection: string, filter: QueryFilter): Promise<number> {
    const conditions = parseQueryFilter(filter);
    const { where, params } = toMySQLWhere(conditions);
    
    const [result] = await this.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM \`${collection}\` WHERE ${where}`,
      params
    );
    
    return result?.count || 0;
  }

  /**
   * Schema'yı MySQL sütun tanımlarına çevir
   */
  private schemaToColumns(schema: ISchema): string {
    const columns: string[] = ['`_id` VARCHAR(36) PRIMARY KEY'];
    
    for (const [key, fieldDef] of Object.entries(schema.definition)) {
      if (key === '_id') continue;
      
      const def = fieldDef as { 
        type: any; 
        required?: boolean; 
        default?: unknown;
      };
      
      const mysqlType = this.typeToMySQL(def.type);
      let column = `\`${key}\` ${mysqlType}`;
      
      if (def.required) column += ' NOT NULL';
      if (def.default !== undefined && typeof def.default !== 'function') {
        column += ` DEFAULT ${this.defaultToMySQL(def.default)}`;
      }
      
      columns.push(column);
    }
    
    return columns.join(', ');
  }

  /**
   * JavaScript tipini MySQL tipine çevir
   */
  private typeToMySQL(type: any): string {
    switch (type) {
      case String:
      case 'ObjectId':
        return 'VARCHAR(255)';
      case Number:
        return 'DOUBLE';
      case Boolean:
        return 'TINYINT(1)';
      case Date:
        return 'DATETIME';
      case Array:
      case Object:
      case 'Mixed':
        return 'JSON';
      default:
        return 'TEXT';
    }
  }

  /**
   * Default değeri MySQL formatına çevir
   */
  private defaultToMySQL(value: unknown): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value === null) return 'NULL';
    if (typeof value === 'object') return `'${JSON.stringify(value)}'`;
    return String(value);
  }

  /**
   * JSON alanlarını parse et
   */
  private parseRow(row: RowDataPacket): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string') {
        try {
          // JSON olabilir mi kontrol et
          if ((value.startsWith('{') && value.endsWith('}')) || 
              (value.startsWith('[') && value.endsWith(']'))) {
            result[key] = JSON.parse(value);
            continue;
          }
        } catch {
          // JSON değilse string olarak bırak
        }
      }
      result[key] = value;
    }
    
    return result;
  }
}
