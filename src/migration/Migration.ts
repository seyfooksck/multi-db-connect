// ============================================
// SDBC - Migration System
// Enterprise-grade database migrations
// ============================================

import type { BaseAdapter } from '../adapters/base';

export interface MigrationFile {
  name: string;
  timestamp: number;
  up: (adapter: BaseAdapter) => Promise<void>;
  down: (adapter: BaseAdapter) => Promise<void>;
}

export interface MigrationRecord {
  id: string;
  name: string;
  timestamp: number;
  executedAt: Date;
  batch: number;
}

export interface MigrationOptions {
  /** Migration dosyalarının bulunduğu klasör */
  migrationsPath?: string;
  /** Migration history tablosu adı */
  tableName?: string;
  /** Hata durumunda rollback yap */
  rollbackOnError?: boolean;
}

export interface MigrationResult {
  success: boolean;
  executed: string[];
  rolled_back: string[];
  pending: string[];
  error?: string;
}

/**
 * SDBC Migration Manager
 * Prisma/Sequelize tarzı migration sistemi
 */
export class MigrationManager {
  private adapter: BaseAdapter;
  private tableName: string;
  private migrations: MigrationFile[] = [];
  
  constructor(adapter: BaseAdapter, options: MigrationOptions = {}) {
    this.adapter = adapter;
    this.tableName = options.tableName || '_sdbc_migrations';
  }

  /**
   * Migration dosyası ekle
   */
  addMigration(migration: MigrationFile): void {
    this.migrations.push(migration);
    // Timestamp'e göre sırala
    this.migrations.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Birden fazla migration ekle
   */
  addMigrations(migrations: MigrationFile[]): void {
    migrations.forEach(m => this.addMigration(m));
  }

  /**
   * Migration history tablosunu oluştur
   */
  async ensureMigrationTable(): Promise<void> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      // MongoDB için collection oluştur
      await this.adapter.createCollection(this.tableName, {} as any);
      return;
    }

    // SQL veritabanları için tablo oluştur
    const createTableSQL = this.getCreateTableSQL();
    if (createTableSQL) {
      try {
        await (this.adapter as any).query(createTableSQL, []);
      } catch (error: any) {
        // Tablo zaten varsa hata vermez
        if (!error.message?.includes('already exists')) {
          throw error;
        }
      }
    }
  }

  /**
   * Migration tablosu CREATE SQL
   */
  private getCreateTableSQL(): string | null {
    const adapterName = this.adapter.name;
    
    switch (adapterName) {
      case 'postgres':
        return `
          CREATE TABLE IF NOT EXISTS "${this.tableName}" (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            timestamp BIGINT NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            batch INT NOT NULL
          )
        `;
      case 'mysql':
        return `
          CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            timestamp BIGINT NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            batch INT NOT NULL
          )
        `;
      case 'sqlite':
        return `
          CREATE TABLE IF NOT EXISTS "${this.tableName}" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            timestamp INTEGER NOT NULL,
            executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            batch INTEGER NOT NULL
          )
        `;
      default:
        return null;
    }
  }

  /**
   * Çalıştırılmış migration'ları getir
   */
  async getExecutedMigrations(): Promise<MigrationRecord[]> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      return await this.adapter.find(this.tableName, {}, {}) as unknown as MigrationRecord[];
    }

    try {
      const result = await (this.adapter as any).query(
        `SELECT * FROM ${this.quoteName(this.tableName)} ORDER BY timestamp ASC`,
        []
      );
      return result || [];
    } catch {
      return [];
    }
  }

  /**
   * Bekleyen migration'ları getir
   */
  async getPendingMigrations(): Promise<MigrationFile[]> {
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map(m => m.name));
    
    return this.migrations.filter(m => !executedNames.has(m.name));
  }

  /**
   * Tüm bekleyen migration'ları çalıştır
   */
  async migrate(): Promise<MigrationResult> {
    await this.ensureMigrationTable();
    
    const pending = await this.getPendingMigrations();
    const executed: string[] = [];
    const batch = await this.getNextBatch();
    
    const result: MigrationResult = {
      success: true,
      executed: [],
      rolled_back: [],
      pending: pending.map(m => m.name)
    };

    if (pending.length === 0) {
      return result;
    }

    for (const migration of pending) {
      try {
        console.log(`⏳ Running migration: ${migration.name}`);
        
        // Up fonksiyonunu çalıştır
        await migration.up(this.adapter);
        
        // Migration kaydını ekle
        await this.recordMigration(migration, batch);
        
        executed.push(migration.name);
        console.log(`✅ Completed: ${migration.name}`);
        
      } catch (error: any) {
        result.success = false;
        result.error = `Migration failed: ${migration.name} - ${error.message}`;
        console.error(`❌ Failed: ${migration.name}`, error.message);
        break;
      }
    }

    result.executed = executed;
    result.pending = pending.filter(m => !executed.includes(m.name)).map(m => m.name);
    
    return result;
  }

  /**
   * Son batch'i geri al
   */
  async rollback(): Promise<MigrationResult> {
    await this.ensureMigrationTable();
    
    const result: MigrationResult = {
      success: true,
      executed: [],
      rolled_back: [],
      pending: []
    };

    const lastBatch = await this.getLastBatch();
    if (lastBatch === 0) {
      console.log('📭 Nothing to rollback');
      return result;
    }

    const migrationsToRollback = await this.getMigrationsByBatch(lastBatch);
    
    // Ters sırada rollback yap
    for (const record of migrationsToRollback.reverse()) {
      const migration = this.migrations.find(m => m.name === record.name);
      
      if (!migration) {
        console.warn(`⚠️ Migration not found: ${record.name}`);
        continue;
      }

      try {
        console.log(`⏳ Rolling back: ${migration.name}`);
        
        // Down fonksiyonunu çalıştır
        await migration.down(this.adapter);
        
        // Migration kaydını sil
        await this.removeMigration(migration.name);
        
        result.rolled_back.push(migration.name);
        console.log(`✅ Rolled back: ${migration.name}`);
        
      } catch (error: any) {
        result.success = false;
        result.error = `Rollback failed: ${migration.name} - ${error.message}`;
        console.error(`❌ Rollback failed: ${migration.name}`, error.message);
        break;
      }
    }

    return result;
  }

  /**
   * Belirli bir migration'a kadar geri al
   */
  async rollbackTo(targetName: string): Promise<MigrationResult> {
    await this.ensureMigrationTable();
    
    const result: MigrationResult = {
      success: true,
      executed: [],
      rolled_back: [],
      pending: []
    };

    const executed = await this.getExecutedMigrations();
    const targetIndex = executed.findIndex(m => m.name === targetName);
    
    if (targetIndex === -1) {
      result.success = false;
      result.error = `Migration not found: ${targetName}`;
      return result;
    }

    // Target'tan sonraki tüm migration'ları geri al
    const toRollback = executed.slice(targetIndex + 1).reverse();
    
    for (const record of toRollback) {
      const migration = this.migrations.find(m => m.name === record.name);
      
      if (!migration) continue;

      try {
        console.log(`⏳ Rolling back: ${migration.name}`);
        await migration.down(this.adapter);
        await this.removeMigration(migration.name);
        result.rolled_back.push(migration.name);
        console.log(`✅ Rolled back: ${migration.name}`);
      } catch (error: any) {
        result.success = false;
        result.error = `Rollback failed: ${migration.name} - ${error.message}`;
        break;
      }
    }

    return result;
  }

  /**
   * Tüm migration'ları sıfırla
   */
  async reset(): Promise<MigrationResult> {
    await this.ensureMigrationTable();
    
    const result: MigrationResult = {
      success: true,
      executed: [],
      rolled_back: [],
      pending: []
    };

    const executed = await this.getExecutedMigrations();
    
    // Ters sırada tümünü geri al
    for (const record of [...executed].reverse()) {
      const migration = this.migrations.find(m => m.name === record.name);
      
      if (!migration) continue;

      try {
        console.log(`⏳ Rolling back: ${migration.name}`);
        await migration.down(this.adapter);
        await this.removeMigration(migration.name);
        result.rolled_back.push(migration.name);
        console.log(`✅ Rolled back: ${migration.name}`);
      } catch (error: any) {
        result.success = false;
        result.error = `Reset failed: ${migration.name} - ${error.message}`;
        break;
      }
    }

    return result;
  }

  /**
   * Reset + Migrate (fresh start)
   */
  async fresh(): Promise<MigrationResult> {
    console.log('🔄 Fresh migration starting...');
    
    const resetResult = await this.reset();
    if (!resetResult.success) {
      return resetResult;
    }

    const migrateResult = await this.migrate();
    migrateResult.rolled_back = resetResult.rolled_back;
    
    return migrateResult;
  }

  /**
   * Migration durumunu göster
   */
  async status(): Promise<{
    executed: MigrationRecord[];
    pending: MigrationFile[];
  }> {
    await this.ensureMigrationTable();
    
    return {
      executed: await this.getExecutedMigrations(),
      pending: await this.getPendingMigrations()
    };
  }

  // ============================================
  // Private helper methods
  // ============================================

  private async recordMigration(migration: MigrationFile, batch: number): Promise<void> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      await this.adapter.insertOne(this.tableName, {
        name: migration.name,
        timestamp: migration.timestamp,
        executedAt: new Date(),
        batch
      });
      return;
    }

    await (this.adapter as any).query(
      `INSERT INTO ${this.quoteName(this.tableName)} (name, timestamp, batch) VALUES (?, ?, ?)`,
      [migration.name, migration.timestamp, batch]
    );
  }

  private async removeMigration(name: string): Promise<void> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      await this.adapter.deleteMany(this.tableName, { name });
      return;
    }

    await (this.adapter as any).query(
      `DELETE FROM ${this.quoteName(this.tableName)} WHERE name = ?`,
      [name]
    );
  }

  private async getNextBatch(): Promise<number> {
    const lastBatch = await this.getLastBatch();
    return lastBatch + 1;
  }

  private async getLastBatch(): Promise<number> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      const records = await this.adapter.find(this.tableName, {}, { sort: { batch: -1 }, limit: 1 });
      return (records[0] as any)?.batch || 0;
    }

    try {
      const result = await (this.adapter as any).query(
        `SELECT MAX(batch) as max_batch FROM ${this.quoteName(this.tableName)}`,
        []
      );
      return result?.[0]?.max_batch || 0;
    } catch {
      return 0;
    }
  }

  private async getMigrationsByBatch(batch: number): Promise<MigrationRecord[]> {
    const adapterName = this.adapter.name;
    
    if (adapterName === 'mongodb') {
      return await this.adapter.find(this.tableName, { batch }, {}) as unknown as MigrationRecord[];
    }

    return await (this.adapter as any).query(
      `SELECT * FROM ${this.quoteName(this.tableName)} WHERE batch = ? ORDER BY timestamp ASC`,
      [batch]
    );
  }

  private quoteName(name: string): string {
    const adapterName = this.adapter.name;
    if (adapterName === 'mysql') return `\`${name}\``;
    return `"${name}"`;
  }
}

// ============================================
// Migration Helper Functions
// ============================================

/**
 * Migration dosyası oluştur
 */
export function defineMigration(config: {
  name: string;
  up: (adapter: BaseAdapter) => Promise<void>;
  down: (adapter: BaseAdapter) => Promise<void>;
}): MigrationFile {
  return {
    name: config.name,
    timestamp: Date.now(),
    up: config.up,
    down: config.down
  };
}

/**
 * Timestamp ile migration adı oluştur
 */
export function createMigrationName(description: string): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .split('.')[0];
  
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  
  return `${timestamp}_${slug}`;
}
