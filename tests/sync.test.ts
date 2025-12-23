import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Schema } from '../src/Schema';
import { SchemaSyncManager } from '../src/sync';

// Mock adapter
class MockSQLAdapter {
  public queries: string[] = [];
  public existingTables: Set<string> = new Set();
  public existingColumns: Map<string, string[]> = new Map();
  
  get name() {
    return 'mysql';
  }
  
  getProvider() {
    return 'mysql';
  }
  
  async query(sql: string, params: unknown[] = []): Promise<any> {
    this.queries.push(sql);
    
    // INFORMATION_SCHEMA queries for table exists
    if (sql.includes('information_schema.tables')) {
      const tableMatch = sql.match(/table_name = \?/i);
      if (tableMatch && params[0]) {
        const tableName = params[0] as string;
        return this.existingTables.has(tableName) ? [[tableName]] : [];
      }
      return [];
    }
    
    // INFORMATION_SCHEMA queries for columns
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS') || sql.includes('information_schema.columns')) {
      const tableName = params[0] as string;
      const columns = this.existingColumns.get(tableName) || [];
      return columns.map(c => ({ name: c, COLUMN_NAME: c }));
    }
    
    return [];
  }
  
  async raw(query: string): Promise<any> {
    return this.query(query, []);
  }
  
  async createCollection(collectionName: string, schema: Schema): Promise<void> {
    // Generate CREATE TABLE SQL
    const sqlSchema = schema.toSQLSchema() as Record<string, any>;
    const columns: string[] = ['id VARCHAR(36) PRIMARY KEY'];
    
    for (const [field, config] of Object.entries(sqlSchema)) {
      if (field === 'id') continue;
      const nullable = config.required ? ' NOT NULL' : '';
      columns.push(`${field} ${config.type}${nullable}`);
    }
    
    const sql = `CREATE TABLE IF NOT EXISTS ${collectionName} (${columns.join(', ')})`;
    this.queries.push(sql);
  }
  
  async dropCollection(collectionName: string): Promise<void> {
    const sql = `DROP TABLE IF EXISTS ${collectionName}`;
    this.queries.push(sql);
    this.existingTables.delete(collectionName);
  }
}

describe('SchemaSyncManager', () => {
  let mockAdapter: MockSQLAdapter;
  
  beforeEach(() => {
    mockAdapter = new MockSQLAdapter();
  });
  
  describe('sync() - Table Creation', () => {
    it('should create table if not exists', async () => {
      const schema = new Schema({
        name: { type: String, required: true },
        email: { type: String },
        age: { type: Number }
      }, { collection: 'users' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      const result = await syncManager.sync();
      
      expect(result.created).toBe(true);
      expect(result.altered).toBe(false);
      expect(result.changes).toContain("Table 'users' created");
      
      // CREATE TABLE query should be executed
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toBeDefined();
      expect(createQuery).toContain('users');
      expect(createQuery).toContain('name');
      expect(createQuery).toContain('email');
      expect(createQuery).toContain('age');
    });
    
    it('should add NOT NULL constraint for required fields', async () => {
      const schema = new Schema({
        name: { type: String, required: true },
        optional: { type: String }
      }, { collection: 'users' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('NOT NULL');
    });
    
    it('should add timestamps columns when enabled', async () => {
      const schema = new Schema({
        name: { type: String }
      }, { 
        collection: 'users',
        timestamps: true 
      });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('createdAt');
      expect(createQuery).toContain('updatedAt');
    });
  });
  
  describe('sync() - Table Alteration', () => {
    it('should add new columns when alter is true', async () => {
      // Tablo zaten var
      mockAdapter.existingTables.add('users');
      mockAdapter.existingColumns.set('users', ['id', 'name', 'email']);
      
      const schema = new Schema({
        name: { type: String },
        email: { type: String },
        age: { type: Number },        // YENİ
        phone: { type: String }       // YENİ
      }, { collection: 'users' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      const result = await syncManager.sync({ alter: true });
      
      expect(result.created).toBe(false);
      expect(result.altered).toBe(true);
      expect(result.changes).toContain("Added column 'age'");
      expect(result.changes).toContain("Added column 'phone'");
      
      // ALTER TABLE queries should be executed
      const alterQueries = mockAdapter.queries.filter(q => q.includes('ALTER TABLE'));
      expect(alterQueries.length).toBe(2);
    });
    
    it('should skip existing columns during alter', async () => {
      mockAdapter.existingTables.add('users');
      mockAdapter.existingColumns.set('users', ['id', 'name', 'email']);
      
      const schema = new Schema({
        name: { type: String },
        email: { type: String }
      }, { collection: 'users' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      const result = await syncManager.sync({ alter: true });
      
      expect(result.created).toBe(false);
      expect(result.altered).toBe(false);
      expect(result.changes).toHaveLength(0);
    });
  });
  
  describe('sync() - Force Mode', () => {
    it('should drop and recreate table when force is true', async () => {
      mockAdapter.existingTables.add('users');
      
      const schema = new Schema({
        name: { type: String }
      }, { collection: 'users' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'users', schema);
      const result = await syncManager.sync({ force: true });
      
      expect(result.created).toBe(true);
      
      // DROP TABLE should be executed before CREATE
      const dropQuery = mockAdapter.queries.find(q => q.includes('DROP TABLE'));
      expect(dropQuery).toBeDefined();
    });
  });
  
  describe('Schema to SQL Type Mapping', () => {
    it('should map String to VARCHAR(255)', async () => {
      const schema = new Schema({
        name: { type: String }
      }, { collection: 'test' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'test', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('VARCHAR(255)');
    });
    
    it('should map Number to INT', async () => {
      const schema = new Schema({
        count: { type: Number }
      }, { collection: 'test' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'test', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('INT');
    });
    
    it('should map Boolean to BOOLEAN', async () => {
      const schema = new Schema({
        active: { type: Boolean }
      }, { collection: 'test' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'test', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('BOOLEAN');
    });
    
    it('should map Date to DATETIME', async () => {
      const schema = new Schema({
        createdAt: { type: Date }
      }, { collection: 'test' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'test', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('DATETIME');
    });
    
    it('should map Object to JSON', async () => {
      const schema = new Schema({
        metadata: { type: Object }
      }, { collection: 'test' });
      
      const syncManager = new SchemaSyncManager(mockAdapter as any, 'test', schema);
      await syncManager.sync();
      
      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      expect(createQuery).toContain('JSON');
    });
  });
});

describe('Schema.toSQLSchema()', () => {
  it('should generate SQL schema from definition', () => {
    const schema = new Schema({
      name: { type: String, required: true },
      email: { type: String, unique: true },
      age: { type: Number, default: 18 },
      isActive: { type: Boolean, default: true }
    });
    
    const sqlSchema = schema.toSQLSchema();
    
    expect(sqlSchema).toHaveProperty('name');
    expect(sqlSchema.name.type).toBe('VARCHAR(255)');
    expect(sqlSchema.name.required).toBe(true);
    
    expect(sqlSchema).toHaveProperty('email');
    expect(sqlSchema.email.unique).toBe(true);
    
    expect(sqlSchema).toHaveProperty('age');
    expect(sqlSchema.age.type).toBe('INT');
    expect(sqlSchema.age.default).toBe(18);
  });
  
  it('should include timestamps in SQL schema', () => {
    const schema = new Schema({
      name: { type: String }
    }, { timestamps: true });
    
    const sqlSchema = schema.toSQLSchema();
    
    expect(sqlSchema).toHaveProperty('createdAt');
    expect(sqlSchema.createdAt.type).toBe('DATETIME');
    
    expect(sqlSchema).toHaveProperty('updatedAt');
    expect(sqlSchema.updatedAt.type).toBe('DATETIME');
  });
});
