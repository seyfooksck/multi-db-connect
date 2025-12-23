// ============================================
// SDBC - Multi Database Connect
// Main entry point
// ============================================

// Core exports
export { Schema } from './Schema';
export { model, getModel, getModels, clearModels, syncAll } from './Model';
export { connect, disconnect, getCapabilities, connectionManager } from './connection';
export { SchemaSyncManager } from './sync';

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
export const version = '1.0.0';

// Default export
import { Schema } from './Schema';
import { model, syncAll } from './Model';
import { connect, disconnect, getCapabilities } from './connection';

export default {
  Schema,
  model,
  connect,
  disconnect,
  getCapabilities,
  syncAll,
  version
};
