// ============================================
// SDBC - Schema Sync Manager
// Handles table creation and schema migrations
// ============================================

import type { ISchema, DatabaseAdapter } from './types';

export interface SyncOptions {
  /** Tabloyu zorla yeniden oluştur (DİKKAT: veri kaybı!) */
  force?: boolean;
  /** Yeni alanları ekle, eskilerini koru */
  alter?: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: unknown;
}

/**
 * Schema Sync Manager
 * Veritabanı tablolarını schema ile senkronize eder
 */
export class SchemaSyncManager {
  constructor(
    private adapter: DatabaseAdapter,
    private collectionName: string,
    private schema: ISchema
  ) {}

  /**
   * Tabloyu schema ile senkronize et
   */
  async sync(options: SyncOptions = {}): Promise<{ created: boolean; altered: boolean; changes: string[] }> {
    const result = { created: false, altered: false, changes: [] as string[] };

    // Force mode: tabloyu sil ve yeniden oluştur
    if (options.force) {
      await this.dropTable();
      await this.createTable();
      result.created = true;
      result.changes.push(`Table '${this.collectionName}' dropped and recreated`);
      return result;
    }

    // Tablo var mı kontrol et
    const tableExists = await this.tableExists();

    if (!tableExists) {
      await this.createTable();
      result.created = true;
      result.changes.push(`Table '${this.collectionName}' created`);
      return result;
    }

    // Alter mode: schema değişikliklerini uygula
    if (options.alter) {
      const alterChanges = await this.alterTable();
      if (alterChanges.length > 0) {
        result.altered = true;
        result.changes = alterChanges;
      }
    }

    return result;
  }

  /**
   * Tablo var mı kontrol et
   */
  private async tableExists(): Promise<boolean> {
    const adapterName = this.adapter.name;
    
    try {
      if (adapterName === 'mongodb') {
        // MongoDB için collection kontrolü adapter içinde yapılıyor
        return true; // MongoDB'de her zaman var kabul et, createCollection idempotent
      }

      // SQL veritabanları için
      const query = this.getTableExistsQuery();
      if (!query) return false;

      const queryMethod = (this.adapter as any).query;
      if (typeof queryMethod !== 'function') {
        return false;
      }

      const result = await queryMethod.call(this.adapter, query.sql, query.params);
      return result && result.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Veritabanına göre tablo var mı sorgusu
   */
  private getTableExistsQuery(): { sql: string; params: unknown[] } | null {
    const adapterName = this.adapter.name;

    switch (adapterName) {
      case 'postgres':
        return {
          sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          params: [this.collectionName]
        };
      case 'mysql':
        return {
          sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
          params: [this.collectionName]
        };
      case 'sqlite':
        return {
          sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          params: [this.collectionName]
        };
      default:
        return null;
    }
  }

  /**
   * Yeni tablo oluştur
   */
  private async createTable(): Promise<void> {
    await this.adapter.createCollection(this.collectionName, this.schema);
  }

  /**
   * Tabloyu sil
   */
  private async dropTable(): Promise<void> {
    await this.adapter.dropCollection(this.collectionName);
  }

  /**
   * Mevcut tabloyu schema'ya göre güncelle
   */
  private async alterTable(): Promise<string[]> {
    const changes: string[] = [];
    const adapterName = this.adapter.name;

    if (adapterName === 'mongodb') {
      // MongoDB schema-less olduğu için alter gerekmez
      return changes;
    }

    try {
      // Mevcut sütunları al
      const existingColumns = await this.getExistingColumns();
      const existingColumnNames = new Set(existingColumns.map(c => c.name.toLowerCase()));

      const queryMethod = (this.adapter as any).query;
      
      // Schema'daki alanları kontrol et
      for (const [fieldName, fieldDef] of Object.entries(this.schema.definition)) {
        const columnName = fieldName.toLowerCase();
        
        if (!existingColumnNames.has(columnName)) {
          // Yeni sütun ekle
          const alterSql = this.getAddColumnSQL(fieldName, fieldDef as any);
          if (alterSql && typeof queryMethod === 'function') {
            await queryMethod.call(this.adapter, alterSql, []);
            changes.push(`Added column '${fieldName}'`);
          }
        }
      }

      // Index'leri güncelle
      await this.syncIndexes();

    } catch (error) {
      console.error('Alter table error:', error);
    }

    return changes;
  }

  /**
   * Mevcut sütunları getir
   */
  private async getExistingColumns(): Promise<ColumnInfo[]> {
    const adapterName = this.adapter.name;
    let query: { sql: string; params: unknown[] } | null = null;

    switch (adapterName) {
      case 'postgres':
        query = {
          sql: `SELECT column_name as name, data_type as type, is_nullable as nullable 
                FROM information_schema.columns 
                WHERE table_name = $1`,
          params: [this.collectionName]
        };
        break;
      case 'mysql':
        query = {
          sql: `SELECT COLUMN_NAME as name, DATA_TYPE as type, IS_NULLABLE as nullable 
                FROM information_schema.columns 
                WHERE table_schema = DATABASE() AND table_name = ?`,
          params: [this.collectionName]
        };
        break;
      case 'sqlite':
        query = {
          sql: `PRAGMA table_info("${this.collectionName}")`,
          params: []
        };
        break;
    }

    if (!query) return [];

    try {
      const queryMethod = (this.adapter as any).query;
      if (typeof queryMethod !== 'function') {
        return [];
      }
      
      const result = await queryMethod.call(this.adapter, query.sql, query.params);
      
      if (adapterName === 'sqlite') {
        // SQLite PRAGMA farklı format döner
        return (result || []).map((row: any) => ({
          name: row.name,
          type: row.type,
          nullable: row.notnull === 0
        }));
      }
      
      return result || [];
    } catch {
      return [];
    }
  }

  /**
   * ADD COLUMN SQL oluştur
   */
  private getAddColumnSQL(fieldName: string, fieldDef: { type: any; required?: boolean; default?: unknown }): string | null {
    const adapterName = this.adapter.name;
    const columnType = this.getColumnType(fieldDef.type);
    
    let sql = '';
    const quotedName = adapterName === 'mysql' ? `\`${fieldName}\`` : `"${fieldName}"`;

    switch (adapterName) {
      case 'postgres':
        sql = `ALTER TABLE "${this.collectionName}" ADD COLUMN ${quotedName} ${columnType}`;
        if (fieldDef.required) sql += ' NOT NULL DEFAULT \'\'';
        break;
      case 'mysql':
        sql = `ALTER TABLE \`${this.collectionName}\` ADD COLUMN ${quotedName} ${columnType}`;
        if (fieldDef.required) sql += ' NOT NULL';
        break;
      case 'sqlite':
        sql = `ALTER TABLE "${this.collectionName}" ADD COLUMN ${quotedName} ${columnType}`;
        // SQLite ADD COLUMN ile NOT NULL desteklemez (default olmadan)
        break;
    }

    return sql || null;
  }

  /**
   * JS tipini SQL tipine çevir
   */
  private getColumnType(type: any): string {
    const adapterName = this.adapter.name;

    const typeMap: Record<string, Record<string, string>> = {
      postgres: {
        String: 'VARCHAR(255)',
        Number: 'DOUBLE PRECISION',
        Boolean: 'BOOLEAN',
        Date: 'TIMESTAMP',
        Array: 'JSONB',
        Object: 'JSONB',
        ObjectId: 'VARCHAR(36)',
        Mixed: 'JSONB'
      },
      mysql: {
        String: 'VARCHAR(255)',
        Number: 'DOUBLE',
        Boolean: 'TINYINT(1)',
        Date: 'DATETIME',
        Array: 'JSON',
        Object: 'JSON',
        ObjectId: 'VARCHAR(36)',
        Mixed: 'JSON'
      },
      sqlite: {
        String: 'TEXT',
        Number: 'REAL',
        Boolean: 'INTEGER',
        Date: 'TEXT',
        Array: 'TEXT',
        Object: 'TEXT',
        ObjectId: 'TEXT',
        Mixed: 'TEXT'
      }
    };

    const typeName = typeof type === 'function' ? type.name : String(type);
    return typeMap[adapterName]?.[typeName] || 'TEXT';
  }

  /**
   * Index'leri senkronize et
   */
  private async syncIndexes(): Promise<void> {
    // Schema'daki unique ve index alanları için index oluştur
    for (const [fieldName, fieldDef] of Object.entries(this.schema.definition)) {
      const def = fieldDef as { unique?: boolean; index?: boolean };
      
      if (def.unique || def.index) {
        try {
          const indexSql = this.getCreateIndexSQL(fieldName, def.unique || false);
          if (indexSql) {
            await (this.adapter as any).query?.(indexSql, []);
          }
        } catch {
          // Index zaten varsa görmezden gel
        }
      }
    }
  }

  /**
   * CREATE INDEX SQL oluştur
   */
  private getCreateIndexSQL(fieldName: string, unique: boolean): string | null {
    const adapterName = this.adapter.name;
    const indexName = `idx_${this.collectionName}_${fieldName}`;
    const uniqueKeyword = unique ? 'UNIQUE ' : '';

    switch (adapterName) {
      case 'postgres':
        return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${indexName}" ON "${this.collectionName}" ("${fieldName}")`;
      case 'mysql':
        return `CREATE ${uniqueKeyword}INDEX \`${indexName}\` ON \`${this.collectionName}\` (\`${fieldName}\`)`;
      case 'sqlite':
        return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS "${indexName}" ON "${this.collectionName}" ("${fieldName}")`;
      default:
        return null;
    }
  }
}
