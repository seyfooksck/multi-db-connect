// ============================================
// SDBC - Multi Database Connect
// Main entry point
// ============================================

// Core exports
export { Schema } from './Schema';
export { model, getModel, getModels, clearModels, syncAll } from './Model';
export { connect, disconnect, getCapabilities, connectionManager } from './connection';
export { SchemaSyncManager } from './sync';

// Migration exports
export {
  MigrationManager,
  defineMigration,
  createMigrationName,
  SchemaBuilder,
  ColumnBuilder,
  createSchemaBuilder
} from './migration';

export type {
  MigrationFile,
  MigrationRecord,
  MigrationOptions,
  MigrationResult,
  ColumnType,
  ColumnDefinition,
  IndexDefinition
} from './migration';

// Transaction exports
export {
  Transaction,
  TransactionManager,
  getTransactionManager,
  setTransactionManager,
  withTransaction
} from './Transaction';

export type {
  TransactionOptions,
  TransactionResult
} from './Transaction';

// Pool exports
export {
  PoolManager,
  createPostgresPool,
  createMySQLPool,
  createSQLitePool,
  withRetry,
  CircuitBreaker
} from './pool';

export type {
  PoolConfig,
  PoolStats,
  PoolConnection,
  HealthCheckResult,
  RetryConfig
} from './pool';

// Soft Delete exports
export {
  SoftDeleteManager,
  SoftDeleteScope,
  createSoftDeleteMethods,
  softDeleteMiddleware,
  addSoftDeleteToDocument,
  softDeleteFields,
  softDeleteIndexes
} from './soft-delete';

export type {
  SoftDeleteOptions,
  SoftDeleteResult,
  RestoreResult,
  SoftDeleteMixin,
  SoftDeletableDocument
} from './soft-delete';

// Type exports
export type {
  // Schema types
  SchemaDefinition,
  SchemaOptions,
  SchemaFieldType,
  SchemaFieldDefinition,
  ISchema,
  
  // Query types
  QueryFilter,
  QueryOperators,
  QueryOptions,
  QueryCondition,
  QueryBuilder,
  PopulateOptions,
  
  // Update types
  UpdateFilter,
  UpdateOperators,
  UpdateResult,
  DeleteResult,
  FindOneAndUpdateOptions,
  
  // Document & Model
  Document,
  DocumentMethods,
  Model,
  
  // Sync types
  SyncOptions,
  SyncResult,
  
  // Connection
  ConnectionOptions,
  DatabaseProvider,
  DatabaseCapabilities,
  DatabaseAdapter,
  
  // Hooks
  HookEvent,
  HookFunction,
  VirtualDefinition,
  VirtualBuilder,
  IndexOptions
} from './types';

// Adapter exports (for advanced usage)
export {
  BaseAdapter,
  MongoDBAdapter,
  PostgreSQLAdapter,
  MySQLAdapter,
  SQLiteAdapter
} from './adapters';

// Utility exports
export { generateId, generateObjectId, isValidId } from './utils/id-generator';
export { parseQueryFilter, parseUpdateFilter } from './utils/query-parser';

// Version
export const version = '1.2.0';

// Default export
import { Schema } from './Schema';
import { model, syncAll } from './Model';
import { connect, disconnect, getCapabilities } from './connection';
import { MigrationManager, SchemaBuilder, createSchemaBuilder } from './migration';
import { TransactionManager, withTransaction } from './Transaction';

export default {
  Schema,
  model,
  connect,
  disconnect,
  getCapabilities,
  syncAll,
  MigrationManager,
  SchemaBuilder,
  createSchemaBuilder,
  TransactionManager,
  withTransaction,
  version
};
