import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MigrationManager, defineMigration, createMigrationName } from '../src/migration';
import { SchemaBuilder, createSchemaBuilder } from '../src/migration';

// Mock adapter
class MockAdapter {
  public queries: string[] = [];
  public collections: Map<string, any[]> = new Map();
  
  get name() { return 'mysql'; }
  
  async query(sql: string, params: unknown[] = []): Promise<any> {
    this.queries.push(sql);
    
    // Migration table queries
    if (sql.includes('SELECT * FROM') && sql.includes('_sdbc_migrations')) {
      return this.collections.get('_sdbc_migrations') || [];
    }
    
    if (sql.includes('SELECT MAX(batch)')) {
      const migrations = this.collections.get('_sdbc_migrations') || [];
      const maxBatch = migrations.reduce((max: number, m: any) => Math.max(max, m.batch || 0), 0);
      return [{ max_batch: maxBatch }];
    }
    
    if (sql.includes('INSERT INTO')) {
      const match = sql.match(/INSERT INTO `?(\w+)`?/);
      if (match) {
        const tableName = match[1];
        if (!this.collections.has(tableName)) {
          this.collections.set(tableName, []);
        }
        this.collections.get(tableName)!.push({
          name: params[0],
          timestamp: params[1],
          batch: params[2]
        });
      }
    }
    
    if (sql.includes('DELETE FROM')) {
      const tableName = '_sdbc_migrations';
      const migrations = this.collections.get(tableName) || [];
      this.collections.set(tableName, migrations.filter((m: any) => m.name !== params[0]));
    }
    
    return [];
  }
  
  async createCollection(name: string, schema: any): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, []);
    }
  }
  
  async dropCollection(name: string): Promise<void> {
    this.collections.delete(name);
  }
  
  async find(collection: string, filter: any, options: any): Promise<any[]> {
    return this.collections.get(collection) || [];
  }
  
  async insertOne(collection: string, doc: any, schema: any): Promise<any> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, []);
    }
    this.collections.get(collection)!.push(doc);
    return doc;
  }
  
  async deleteMany(collection: string, filter: any): Promise<any> {
    const items = this.collections.get(collection) || [];
    this.collections.set(collection, items.filter((item: any) => 
      !Object.entries(filter).every(([key, value]) => item[key] === value)
    ));
    return { deletedCount: 1 };
  }
}

describe('Migration System', () => {
  let mockAdapter: MockAdapter;
  let migrationManager: MigrationManager;

  beforeEach(() => {
    mockAdapter = new MockAdapter();
    migrationManager = new MigrationManager(mockAdapter as any);
  });

  describe('MigrationManager', () => {
    it('should create migration table on first run', async () => {
      await migrationManager.migrate();
      
      const createTableQuery = mockAdapter.queries.find(q => 
        q.includes('CREATE TABLE') && q.includes('_sdbc_migrations')
      );
      expect(createTableQuery).toBeDefined();
    });

    it('should execute pending migrations', async () => {
      const migration1 = defineMigration({
        name: '001_create_users',
        up: async (adapter) => {
          await (adapter as any).query('CREATE TABLE users (id INT)', []);
        },
        down: async (adapter) => {
          await (adapter as any).query('DROP TABLE users', []);
        }
      });

      migrationManager.addMigration(migration1);
      const result = await migrationManager.migrate();

      expect(result.success).toBe(true);
      expect(result.executed).toContain('001_create_users');
      expect(mockAdapter.queries).toContain('CREATE TABLE users (id INT)');
    });

    it('should track executed migrations', async () => {
      const migration = defineMigration({
        name: '001_test',
        up: async () => {},
        down: async () => {}
      });

      migrationManager.addMigration(migration);
      await migrationManager.migrate();

      const status = await migrationManager.status();
      expect(status.executed.map(m => m.name)).toContain('001_test');
      expect(status.pending.length).toBe(0);
    });

    it('should not re-run executed migrations', async () => {
      const upFn = vi.fn();
      const migration = defineMigration({
        name: '001_test',
        up: upFn,
        down: async () => {}
      });

      migrationManager.addMigration(migration);
      
      // İlk çalıştırma
      await migrationManager.migrate();
      expect(upFn).toHaveBeenCalledTimes(1);
      
      // İkinci çalıştırma - tekrar çalışmamalı
      await migrationManager.migrate();
      expect(upFn).toHaveBeenCalledTimes(1);
    });

    it('should rollback last batch', async () => {
      const downFn = vi.fn();
      const migration = defineMigration({
        name: '001_test',
        up: async () => {},
        down: downFn
      });

      migrationManager.addMigration(migration);
      await migrationManager.migrate();
      
      const result = await migrationManager.rollback();
      
      expect(result.success).toBe(true);
      expect(result.rolled_back).toContain('001_test');
      expect(downFn).toHaveBeenCalled();
    });

    it('should handle migration errors gracefully', async () => {
      const migration = defineMigration({
        name: '001_failing',
        up: async () => {
          throw new Error('Migration failed!');
        },
        down: async () => {}
      });

      migrationManager.addMigration(migration);
      const result = await migrationManager.migrate();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Migration failed');
    });

    it('should execute migrations in order', async () => {
      const order: string[] = [];
      
      const migration1 = {
        name: '001_first',
        timestamp: 1000,
        up: async () => { order.push('first'); },
        down: async () => {}
      };
      
      const migration2 = {
        name: '002_second',
        timestamp: 2000,
        up: async () => { order.push('second'); },
        down: async () => {}
      };

      // Ters sırada ekle
      migrationManager.addMigration(migration2);
      migrationManager.addMigration(migration1);
      
      await migrationManager.migrate();

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('defineMigration', () => {
    it('should create migration with timestamp', () => {
      const migration = defineMigration({
        name: 'test_migration',
        up: async () => {},
        down: async () => {}
      });

      expect(migration.name).toBe('test_migration');
      expect(migration.timestamp).toBeGreaterThan(0);
      expect(migration.up).toBeInstanceOf(Function);
      expect(migration.down).toBeInstanceOf(Function);
    });
  });

  describe('createMigrationName', () => {
    it('should create timestamped migration name', () => {
      const name = createMigrationName('create users table');
      
      expect(name).toMatch(/^\d{8}_\d{6}_create_users_table$/);
    });

    it('should handle special characters', () => {
      const name = createMigrationName('Add user\'s email!');
      
      expect(name).toMatch(/add_user_s_email/);
    });
  });
});

describe('SchemaBuilder', () => {
  let mockAdapter: MockAdapter;
  let schemaBuilder: SchemaBuilder;

  beforeEach(() => {
    mockAdapter = new MockAdapter();
    schemaBuilder = createSchemaBuilder(mockAdapter as any);
  });

  describe('createTable', () => {
    it('should generate CREATE TABLE SQL', async () => {
      await schemaBuilder.createTable('users', (table) => {
        table.increments('id');
        table.string('name');
        table.string('email').unique().notNull();
        table.integer('age').nullable();
        table.timestamps();
      });

      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      
      expect(createQuery).toBeDefined();
      expect(createQuery).toContain('users');
      expect(createQuery).toContain('id');
      expect(createQuery).toContain('name');
      expect(createQuery).toContain('email');
      expect(createQuery).toContain('UNIQUE');
      expect(createQuery).toContain('NOT NULL');
    });

    it('should support different column types', async () => {
      await schemaBuilder.createTable('test', (table) => {
        table.bigIncrements('id');
        table.text('content');
        table.boolean('active');
        table.decimal('price', 10, 2);
        table.json('metadata');
        table.datetime('published_at');
      });

      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      
      expect(createQuery).toContain('BIGINT');
      expect(createQuery).toContain('TEXT');
      expect(createQuery).toContain('TINYINT(1)'); // MySQL boolean
      expect(createQuery).toContain('DECIMAL(10, 2)');
      expect(createQuery).toContain('JSON');
      expect(createQuery).toContain('DATETIME');
    });

    it('should support foreign keys', async () => {
      await schemaBuilder.createTable('posts', (table) => {
        table.increments('id');
        table.integer('user_id').references('users', 'id').onDelete('CASCADE');
      });

      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      
      expect(createQuery).toContain('REFERENCES');
      expect(createQuery).toContain('users');
      expect(createQuery).toContain('ON DELETE CASCADE');
    });

    it('should support indexes', async () => {
      await schemaBuilder.createTable('users', (table) => {
        table.increments('id');
        table.string('email');
        table.index('email');
        table.uniqueIndex(['email'], 'unique_email');
      });

      const indexQuery = mockAdapter.queries.find(q => q.includes('CREATE INDEX'));
      const uniqueIndexQuery = mockAdapter.queries.find(q => q.includes('UNIQUE INDEX'));
      
      expect(indexQuery).toBeDefined();
      expect(uniqueIndexQuery).toBeDefined();
    });
  });

  describe('dropTable', () => {
    it('should generate DROP TABLE SQL', async () => {
      await schemaBuilder.dropTable('users');

      expect(mockAdapter.queries).toContain('DROP TABLE IF EXISTS `users`');
    });
  });

  describe('alterTable', () => {
    it('should add new columns', async () => {
      await schemaBuilder.alterTable('users', (table) => {
        table.string('phone');
        table.text('bio');
      });

      const alterQueries = mockAdapter.queries.filter(q => q.includes('ALTER TABLE'));
      
      expect(alterQueries.length).toBe(2);
      expect(alterQueries[0]).toContain('ADD COLUMN');
      expect(alterQueries[0]).toContain('phone');
    });

    it('should drop columns', async () => {
      await schemaBuilder.alterTable('users', (table) => {
        table.dropColumn('old_field');
      });

      const alterQuery = mockAdapter.queries.find(q => q.includes('DROP COLUMN'));
      
      expect(alterQuery).toBeDefined();
      expect(alterQuery).toContain('old_field');
    });
  });

  describe('softDeletes', () => {
    it('should add deleted_at column', async () => {
      await schemaBuilder.createTable('posts', (table) => {
        table.increments('id');
        table.softDeletes();
      });

      const createQuery = mockAdapter.queries.find(q => q.includes('CREATE TABLE'));
      
      expect(createQuery).toContain('deleted_at');
    });
  });
});
