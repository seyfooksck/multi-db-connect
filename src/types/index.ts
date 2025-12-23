// ============================================
// SDBC - Multi Database Connect
// Type Definitions
// ============================================

// Schema Types
export type SchemaFieldType = 
  | typeof String 
  | typeof Number 
  | typeof Boolean 
  | typeof Date 
  | typeof Buffer
  | typeof Array
  | typeof Object
  | 'ObjectId'
  | 'Mixed';

export interface SchemaFieldDefinition {
  type: SchemaFieldType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  ref?: string;
  index?: boolean;
  enum?: unknown[];
  min?: number;
  max?: number;
  minlength?: number;
  maxlength?: number;
  match?: RegExp;
  validate?: (value: unknown) => boolean | Promise<boolean>;
}

export type SchemaField = SchemaFieldType | SchemaFieldDefinition;

export interface SchemaDefinition {
  [key: string]: SchemaField;
}

export interface SchemaOptions {
  timestamps?: boolean;
  collection?: string;
  strict?: boolean;
  versionKey?: boolean | string;
}

// Query Operators
export interface QueryOperators<T = unknown> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $regex?: string | RegExp;
  $exists?: boolean;
  $or?: QueryFilter[];
  $and?: QueryFilter[];
}

export type QueryCondition<T = unknown> = T | QueryOperators<T>;

export interface QueryFilter {
  [key: string]: QueryCondition;
}

export interface QueryOptions {
  limit?: number;
  skip?: number;
  sort?: Record<string, 1 | -1>;
  select?: string | string[] | Record<string, 0 | 1>;
  populate?: string | PopulateOptions | (string | PopulateOptions)[];
}

export interface PopulateOptions {
  path: string;
  select?: string | string[];
  model?: string;
  match?: QueryFilter;
}

// Update Operations
export interface UpdateOperators {
  $set?: Record<string, unknown>;
  $unset?: Record<string, 1 | ''>;
  $inc?: Record<string, number>;
  $push?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
  $addToSet?: Record<string, unknown>;
}

export type UpdateFilter = UpdateOperators | Record<string, unknown>;

// Connection
export type DatabaseProvider = 'mongodb' | 'postgres' | 'mysql' | 'sqlite';

export interface ConnectionOptions {
  provider: DatabaseProvider;
  uri: string;
  options?: Record<string, unknown>;
}

export interface DatabaseCapabilities {
  joins: boolean;
  json: boolean;
  transactions: boolean;
  aggregation: boolean;
  changeStreams: boolean;
  fullTextSearch: boolean;
}

// Document
export interface DocumentMethods {
  save(): Promise<Document>;
  remove(): Promise<void>;
  toJSON(): Record<string, unknown>;
  toObject(): Record<string, unknown>;
}

export interface Document extends DocumentMethods {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

// Sync Options
export interface SyncOptions {
  /** Tabloyu zorla yeniden oluştur (DİKKAT: veri kaybı!) */
  force?: boolean;
  /** Yeni alanları ekle, eskilerini koru */
  alter?: boolean;
}

export interface SyncResult {
  created: boolean;
  altered: boolean;
  changes: string[];
}

// Model
export interface Model<T extends Document = Document> {
  modelName: string;
  schema: ISchema;
  
  // Sync - Tabloyu schema ile senkronize et
  sync(options?: SyncOptions): Promise<SyncResult>;
  
  // Create
  create(doc: Partial<T>): Promise<T>;
  create(docs: Partial<T>[]): Promise<T[]>;
  create(docOrDocs: Partial<T> | Partial<T>[]): Promise<T | T[]>;
  insertMany(docs: Partial<T>[]): Promise<T[]>;
  
  // Read
  find(filter?: QueryFilter, options?: QueryOptions): QueryBuilder<T[]>;
  findOne(filter?: QueryFilter, options?: QueryOptions): QueryBuilder<T | null>;
  findById(id: string, options?: QueryOptions): QueryBuilder<T | null>;
  countDocuments(filter?: QueryFilter): Promise<number>;
  exists(filter: QueryFilter): Promise<boolean>;
  
  // Update
  updateOne(filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;
  updateMany(filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;
  findOneAndUpdate(filter: QueryFilter, update: UpdateFilter, options?: FindOneAndUpdateOptions): Promise<T | null>;
  findByIdAndUpdate(id: string, update: UpdateFilter, options?: FindOneAndUpdateOptions): Promise<T | null>;
  
  // Delete
  deleteOne(filter: QueryFilter): Promise<DeleteResult>;
  deleteMany(filter: QueryFilter): Promise<DeleteResult>;
  findOneAndDelete(filter: QueryFilter): Promise<T | null>;
  findByIdAndDelete(id: string): Promise<T | null>;
}

export interface QueryBuilder<T> extends Promise<T> {
  select(fields: string | string[] | Record<string, 0 | 1>): QueryBuilder<T>;
  sort(sort: Record<string, 1 | -1> | string): QueryBuilder<T>;
  limit(n: number): QueryBuilder<T>;
  skip(n: number): QueryBuilder<T>;
  populate(options: string | PopulateOptions | (string | PopulateOptions)[]): QueryBuilder<T>;
  lean(): QueryBuilder<T>;
  exec(): Promise<T>;
}

export interface UpdateResult {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId?: string;
}

export interface DeleteResult {
  acknowledged: boolean;
  deletedCount: number;
}

export interface FindOneAndUpdateOptions {
  new?: boolean;
  upsert?: boolean;
  runValidators?: boolean;
}

// Schema Interface
export interface ISchema {
  definition: SchemaDefinition;
  options: SchemaOptions;
  methods: Record<string, Function>;
  statics: Record<string, Function>;
  virtuals: Map<string, VirtualDefinition>;
  hooks: {
    pre: Map<string, HookFunction[]>;
    post: Map<string, HookFunction[]>;
  };
  
  pre(event: HookEvent, fn: HookFunction): void;
  post(event: HookEvent, fn: HookFunction): void;
  virtual(name: string): VirtualBuilder;
  index(fields: Record<string, 1 | -1>, options?: IndexOptions): void;
}

export type HookEvent = 'save' | 'remove' | 'validate' | 'find' | 'findOne' | 'updateOne' | 'deleteOne';
export type HookFunction = (this: Document, next?: () => void) => void | Promise<void>;

export interface VirtualDefinition {
  get?: () => unknown;
  set?: (value: unknown) => void;
}

export interface VirtualBuilder {
  get(fn: () => unknown): VirtualBuilder;
  set(fn: (value: unknown) => void): VirtualBuilder;
}

export interface IndexOptions {
  unique?: boolean;
  sparse?: boolean;
  background?: boolean;
  name?: string;
}

// Adapter Interface
export interface DatabaseAdapter {
  name: DatabaseProvider;
  capabilities: DatabaseCapabilities;
  
  connect(uri: string, options?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Table/Collection management
  createCollection(name: string, schema: ISchema): Promise<void>;
  dropCollection(name: string): Promise<void>;
  
  // CRUD
  insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>>;
  insertMany(collection: string, docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  
  find(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown>[]>;
  findOne(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown> | null>;
  
  updateOne(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;
  updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult>;
  
  deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult>;
  deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult>;
  
  countDocuments(collection: string, filter: QueryFilter): Promise<number>;
}

// Connection Manager
export interface ConnectionManager {
  adapter: DatabaseAdapter | null;
  isConnected: boolean;
  connect(options: ConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  getAdapter(): DatabaseAdapter;
}
