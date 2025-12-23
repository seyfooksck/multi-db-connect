// ============================================
// SDBC - Schema Builder for Migrations
// Fluent API for table operations
// ============================================

import type { BaseAdapter } from '../adapters/base';

export type ColumnType = 
  | 'string' | 'text' | 'integer' | 'bigint' | 'float' | 'double' | 'decimal'
  | 'boolean' | 'date' | 'datetime' | 'timestamp' | 'time'
  | 'json' | 'uuid' | 'binary' | 'enum';

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  defaultValue?: unknown;
  unique: boolean;
  primary: boolean;
  autoIncrement: boolean;
  unsigned: boolean;
  enumValues?: string[];
  references?: {
    table: string;
    column: string;
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  };
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
}

/**
 * Fluent Column Builder
 */
export class ColumnBuilder {
  private column: ColumnDefinition;

  constructor(name: string, type: ColumnType) {
    this.column = {
      name,
      type,
      nullable: true,
      unique: false,
      primary: false,
      autoIncrement: false,
      unsigned: false
    };
  }

  /** NOT NULL constraint */
  notNull(): this {
    this.column.nullable = false;
    return this;
  }

  /** NULL allowed (default) */
  nullable(): this {
    this.column.nullable = true;
    return this;
  }

  /** DEFAULT value */
  default(value: unknown): this {
    this.column.defaultValue = value;
    return this;
  }

  /** UNIQUE constraint */
  unique(): this {
    this.column.unique = true;
    return this;
  }

  /** PRIMARY KEY */
  primary(): this {
    this.column.primary = true;
    this.column.nullable = false;
    return this;
  }

  /** AUTO INCREMENT */
  autoIncrement(): this {
    this.column.autoIncrement = true;
    return this;
  }

  /** UNSIGNED (for numbers) */
  unsigned(): this {
    this.column.unsigned = true;
    return this;
  }

  /** FOREIGN KEY reference */
  references(table: string, column: string = 'id'): this {
    this.column.references = { table, column };
    return this;
  }

  /** ON DELETE action */
  onDelete(action: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'): this {
    if (this.column.references) {
      this.column.references.onDelete = action;
    }
    return this;
  }

  /** ON UPDATE action */
  onUpdate(action: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'): this {
    if (this.column.references) {
      this.column.references.onUpdate = action;
    }
    return this;
  }

  /** Get built column */
  build(): ColumnDefinition {
    return this.column;
  }
}

/**
 * Schema Builder - Table Operations
 */
export class SchemaBuilder {
  private adapter: BaseAdapter;
  private tableName: string = '';
  private columns: ColumnDefinition[] = [];
  private indexes: IndexDefinition[] = [];
  private dropColumns: string[] = [];
  private renameColumns: Array<{ from: string; to: string }> = [];

  constructor(adapter: BaseAdapter) {
    this.adapter = adapter;
  }

  // ============================================
  // Table Operations
  // ============================================

  /**
   * CREATE TABLE
   */
  async createTable(name: string, callback: (table: SchemaBuilder) => void): Promise<void> {
    this.tableName = name;
    this.columns = [];
    this.indexes = [];
    
    callback(this);
    
    const sql = this.buildCreateTableSQL();
    await this.execute(sql);
    
    // Create indexes
    for (const index of this.indexes) {
      await this.execute(this.buildCreateIndexSQL(index));
    }
  }

  /**
   * ALTER TABLE
   */
  async alterTable(name: string, callback: (table: SchemaBuilder) => void): Promise<void> {
    this.tableName = name;
    this.columns = [];
    this.dropColumns = [];
    this.renameColumns = [];
    
    callback(this);
    
    // Add columns
    for (const col of this.columns) {
      await this.execute(this.buildAddColumnSQL(col));
    }
    
    // Drop columns
    for (const colName of this.dropColumns) {
      await this.execute(this.buildDropColumnSQL(colName));
    }
    
    // Rename columns
    for (const rename of this.renameColumns) {
      await this.execute(this.buildRenameColumnSQL(rename.from, rename.to));
    }
  }

  /**
   * DROP TABLE
   */
  async dropTable(name: string): Promise<void> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      await this.adapter.dropCollection(name);
      return;
    }

    const quote = adapterName === 'mysql' ? '`' : '"';
    await this.execute(`DROP TABLE IF EXISTS ${quote}${name}${quote}`);
  }

  /**
   * DROP TABLE IF EXISTS
   */
  async dropTableIfExists(name: string): Promise<void> {
    await this.dropTable(name);
  }

  /**
   * RENAME TABLE
   */
  async renameTable(from: string, to: string): Promise<void> {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    if (adapterName === 'sqlite') {
      await this.execute(`ALTER TABLE ${quote}${from}${quote} RENAME TO ${quote}${to}${quote}`);
    } else {
      await this.execute(`RENAME TABLE ${quote}${from}${quote} TO ${quote}${to}${quote}`);
    }
  }

  /**
   * Check if table exists
   */
  async hasTable(name: string): Promise<boolean> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      // MongoDB için her zaman true döndür
      return true;
    }

    try {
      let sql: string;
      let params: unknown[] = [];
      
      switch (adapterName) {
        case 'postgres':
          sql = `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`;
          params = [name];
          break;
        case 'mysql':
          sql = `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`;
          params = [name];
          break;
        case 'sqlite':
          sql = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
          params = [name];
          break;
        default:
          return false;
      }

      const result = await (this.adapter as any).query(sql, params);
      return result && result.length > 0;
    } catch {
      return false;
    }
  }

  // ============================================
  // Column Type Methods
  // ============================================

  /** Auto-incrementing primary key */
  increments(name: string = 'id'): ColumnBuilder {
    const col = new ColumnBuilder(name, 'integer');
    col.primary().autoIncrement().unsigned();
    this.columns.push(col.build());
    return col;
  }

  /** Big integer auto-incrementing primary key */
  bigIncrements(name: string = 'id'): ColumnBuilder {
    const col = new ColumnBuilder(name, 'bigint');
    col.primary().autoIncrement().unsigned();
    this.columns.push(col.build());
    return col;
  }

  /** UUID primary key */
  uuid(name: string = 'id'): ColumnBuilder {
    const col = new ColumnBuilder(name, 'uuid');
    this.columns.push(col.build());
    return col;
  }

  /** VARCHAR column */
  string(name: string, length: number = 255): ColumnBuilder {
    const col = new ColumnBuilder(name, 'string');
    col['column'].length = length;
    this.columns.push(col.build());
    return col;
  }

  /** TEXT column */
  text(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'text');
    this.columns.push(col.build());
    return col;
  }

  /** INTEGER column */
  integer(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'integer');
    this.columns.push(col.build());
    return col;
  }

  /** BIGINT column */
  bigInteger(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'bigint');
    this.columns.push(col.build());
    return col;
  }

  /** FLOAT column */
  float(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'float');
    this.columns.push(col.build());
    return col;
  }

  /** DOUBLE column */
  double(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'double');
    this.columns.push(col.build());
    return col;
  }

  /** DECIMAL column */
  decimal(name: string, precision: number = 8, scale: number = 2): ColumnBuilder {
    const col = new ColumnBuilder(name, 'decimal');
    col['column'].precision = precision;
    col['column'].scale = scale;
    this.columns.push(col.build());
    return col;
  }

  /** BOOLEAN column */
  boolean(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'boolean');
    this.columns.push(col.build());
    return col;
  }

  /** DATE column */
  date(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'date');
    this.columns.push(col.build());
    return col;
  }

  /** DATETIME column */
  datetime(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'datetime');
    this.columns.push(col.build());
    return col;
  }

  /** TIMESTAMP column */
  timestamp(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'timestamp');
    this.columns.push(col.build());
    return col;
  }

  /** Timestamps (createdAt + updatedAt) */
  timestamps(): void {
    this.timestamp('created_at').default('CURRENT_TIMESTAMP');
    this.timestamp('updated_at').default('CURRENT_TIMESTAMP');
  }

  /** JSON column */
  json(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'json');
    this.columns.push(col.build());
    return col;
  }

  /** ENUM column */
  enum(name: string, values: string[]): ColumnBuilder {
    const col = new ColumnBuilder(name, 'enum');
    col['column'].enumValues = values;
    this.columns.push(col.build());
    return col;
  }

  /** BINARY column */
  binary(name: string): ColumnBuilder {
    const col = new ColumnBuilder(name, 'binary');
    this.columns.push(col.build());
    return col;
  }

  /** Soft delete column */
  softDeletes(name: string = 'deleted_at'): ColumnBuilder {
    return this.timestamp(name).nullable();
  }

  // ============================================
  // Index Operations
  // ============================================

  /** Create INDEX */
  index(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indexes.push({
      name: name || `idx_${this.tableName}_${cols.join('_')}`,
      columns: cols,
      unique: false
    });
  }

  /** Create UNIQUE INDEX */
  uniqueIndex(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indexes.push({
      name: name || `uniq_${this.tableName}_${cols.join('_')}`,
      columns: cols,
      unique: true
    });
  }

  /** Drop column */
  dropColumn(name: string): void {
    this.dropColumns.push(name);
  }

  /** Rename column */
  renameColumn(from: string, to: string): void {
    this.renameColumns.push({ from, to });
  }

  // ============================================
  // SQL Builders
  // ============================================

  private buildCreateTableSQL(): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    const columnDefs = this.columns.map(col => this.columnToSQL(col));
    
    return `CREATE TABLE IF NOT EXISTS ${quote}${this.tableName}${quote} (${columnDefs.join(', ')})`;
  }

  private buildAddColumnSQL(col: ColumnDefinition): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    return `ALTER TABLE ${quote}${this.tableName}${quote} ADD COLUMN ${this.columnToSQL(col)}`;
  }

  private buildDropColumnSQL(colName: string): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    return `ALTER TABLE ${quote}${this.tableName}${quote} DROP COLUMN ${quote}${colName}${quote}`;
  }

  private buildRenameColumnSQL(from: string, to: string): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    if (adapterName === 'mysql') {
      // MySQL needs column definition for rename
      return `ALTER TABLE ${quote}${this.tableName}${quote} RENAME COLUMN ${quote}${from}${quote} TO ${quote}${to}${quote}`;
    }
    
    return `ALTER TABLE ${quote}${this.tableName}${quote} RENAME COLUMN ${quote}${from}${quote} TO ${quote}${to}${quote}`;
  }

  private buildCreateIndexSQL(index: IndexDefinition): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    const uniqueStr = index.unique ? 'UNIQUE ' : '';
    const cols = index.columns.map(c => `${quote}${c}${quote}`).join(', ');
    
    return `CREATE ${uniqueStr}INDEX ${quote}${index.name}${quote} ON ${quote}${this.tableName}${quote} (${cols})`;
  }

  private columnToSQL(col: ColumnDefinition): string {
    const adapterName = this.adapter.name;
    const quote = adapterName === 'mysql' ? '`' : '"';
    
    let sql = `${quote}${col.name}${quote} ${this.typeToSQL(col)}`;
    
    if (col.unsigned && adapterName === 'mysql') {
      sql += ' UNSIGNED';
    }
    
    if (col.primary) {
      sql += ' PRIMARY KEY';
    }
    
    if (col.autoIncrement) {
      sql += adapterName === 'postgres' ? '' : ' AUTO_INCREMENT';
    }
    
    if (!col.nullable && !col.primary) {
      sql += ' NOT NULL';
    }
    
    if (col.unique && !col.primary) {
      sql += ' UNIQUE';
    }
    
    if (col.defaultValue !== undefined) {
      sql += ` DEFAULT ${this.defaultToSQL(col.defaultValue)}`;
    }
    
    if (col.references) {
      sql += ` REFERENCES ${quote}${col.references.table}${quote}(${quote}${col.references.column}${quote})`;
      if (col.references.onDelete) sql += ` ON DELETE ${col.references.onDelete}`;
      if (col.references.onUpdate) sql += ` ON UPDATE ${col.references.onUpdate}`;
    }
    
    return sql;
  }

  private typeToSQL(col: ColumnDefinition): string {
    const adapterName = this.adapter.name;
    
    const typeMap: Record<string, Record<ColumnType, string>> = {
      postgres: {
        string: `VARCHAR(${col.length || 255})`,
        text: 'TEXT',
        integer: col.autoIncrement ? 'SERIAL' : 'INTEGER',
        bigint: col.autoIncrement ? 'BIGSERIAL' : 'BIGINT',
        float: 'REAL',
        double: 'DOUBLE PRECISION',
        decimal: `DECIMAL(${col.precision || 8}, ${col.scale || 2})`,
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
        timestamp: 'TIMESTAMP',
        time: 'TIME',
        json: 'JSONB',
        uuid: 'UUID',
        binary: 'BYTEA',
        enum: `VARCHAR(255)`
      },
      mysql: {
        string: `VARCHAR(${col.length || 255})`,
        text: 'TEXT',
        integer: 'INT',
        bigint: 'BIGINT',
        float: 'FLOAT',
        double: 'DOUBLE',
        decimal: `DECIMAL(${col.precision || 8}, ${col.scale || 2})`,
        boolean: 'TINYINT(1)',
        date: 'DATE',
        datetime: 'DATETIME',
        timestamp: 'TIMESTAMP',
        time: 'TIME',
        json: 'JSON',
        uuid: 'CHAR(36)',
        binary: 'BLOB',
        enum: col.enumValues ? `ENUM(${col.enumValues.map(v => `'${v}'`).join(', ')})` : 'VARCHAR(255)'
      },
      sqlite: {
        string: 'TEXT',
        text: 'TEXT',
        integer: 'INTEGER',
        bigint: 'INTEGER',
        float: 'REAL',
        double: 'REAL',
        decimal: 'REAL',
        boolean: 'INTEGER',
        date: 'TEXT',
        datetime: 'TEXT',
        timestamp: 'TEXT',
        time: 'TEXT',
        json: 'TEXT',
        uuid: 'TEXT',
        binary: 'BLOB',
        enum: 'TEXT'
      }
    };

    return typeMap[adapterName]?.[col.type] || 'TEXT';
  }

  private defaultToSQL(value: unknown): string {
    if (value === 'CURRENT_TIMESTAMP') return 'CURRENT_TIMESTAMP';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    return String(value);
  }

  private async execute(sql: string): Promise<void> {
    if (this.adapter.name === 'mongodb') return;
    await (this.adapter as any).query(sql, []);
  }
}

/**
 * Schema builder factory
 */
export function createSchemaBuilder(adapter: BaseAdapter): SchemaBuilder {
  return new SchemaBuilder(adapter);
}
