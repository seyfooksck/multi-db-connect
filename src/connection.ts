// ============================================
// SDBC - Connection Manager
// Database connection handling
// ============================================

import type {
  ConnectionOptions,
  DatabaseProvider,
  DatabaseAdapter,
  ConnectionManager as IConnectionManager,
  DatabaseCapabilities
} from './types';
import {
  MongoDBAdapter,
  PostgreSQLAdapter,
  MySQLAdapter,
  SQLiteAdapter
} from './adapters';

export interface ExtendedConnectionOptions extends ConnectionOptions {
  /** Bağlantı sonrası tüm modelleri sync et */
  sync?: boolean;
  /** Sync seçenekleri */
  syncOptions?: {
    force?: boolean;  // Tabloları sil ve yeniden oluştur (DİKKAT: veri kaybı!)
    alter?: boolean;  // Yeni alanları ekle
  };
}

class ConnectionManagerImpl implements IConnectionManager {
  adapter: DatabaseAdapter | null = null;
  isConnected = false;
  syncEnabled = false;
  syncOptions: { force?: boolean; alter?: boolean } = {};

  async connect(options: ExtendedConnectionOptions): Promise<void> {
    if (this.isConnected) {
      await this.disconnect();
    }

    this.adapter = this.createAdapter(options.provider);
    await this.adapter.connect(options.uri, options.options);
    this.isConnected = true;
    
    // Sync ayarlarını kaydet
    this.syncEnabled = options.sync || false;
    this.syncOptions = options.syncOptions || { alter: true };
  }

  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
      this.isConnected = false;
    }
  }

  getAdapter(): DatabaseAdapter {
    if (!this.adapter) {
      throw new Error('No database connection. Call connect() first.');
    }
    return this.adapter;
  }

  get capabilities(): DatabaseCapabilities {
    return this.getAdapter().capabilities;
  }

  private createAdapter(provider: DatabaseProvider): DatabaseAdapter {
    switch (provider) {
      case 'mongodb':
        return new MongoDBAdapter();
      case 'postgres':
        return new PostgreSQLAdapter();
      case 'mysql':
        return new MySQLAdapter();
      case 'sqlite':
        return new SQLiteAdapter();
      default:
        throw new Error(`Unsupported database provider: ${provider}`);
    }
  }
}

// Singleton instance
export const connectionManager = new ConnectionManagerImpl();

/**
 * Veritabanına bağlan
 * 
 * @example
 * ```ts
 * await connect({
 *   provider: 'mongodb',
 *   uri: 'mongodb://localhost:27017/myapp'
 * });
 * ```
 */
export async function connect(options: ConnectionOptions): Promise<typeof connectionManager> {
  await connectionManager.connect(options);
  return connectionManager;
}

/**
 * Veritabanı bağlantısını kapat
 */
export async function disconnect(): Promise<void> {
  await connectionManager.disconnect();
}

/**
 * Mevcut veritabanı yeteneklerini getir
 */
export function getCapabilities(): DatabaseCapabilities {
  return connectionManager.capabilities;
}
