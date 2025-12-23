// ============================================
// SDBC - Model Factory
// Creates Mongoose-compatible models
// ============================================

import type {
  Model as IModel,
  Document,
  QueryFilter,
  QueryOptions,
  UpdateFilter,
  UpdateResult,
  DeleteResult,
  FindOneAndUpdateOptions,
  QueryBuilder,
  PopulateOptions,
  SyncOptions
} from './types';
import { Schema } from './Schema';
import { connectionManager } from './connection';
import { SchemaSyncManager } from './sync';

// Model registry
const models: Map<string, IModel> = new Map();

// Sync durumu takibi
const syncedModels: Set<string> = new Set();

/**
 * QueryBuilder implementasyonu
 * Zincirleme method çağrıları için
 */
function createQueryBuilder<T>(
  executor: (options: QueryOptions) => Promise<T>
): QueryBuilder<T> {
  const options: QueryOptions = {};

  const builder = {
    select(fields: string | string[] | Record<string, 0 | 1>) {
      options.select = fields;
      return builder;
    },
    sort(sort: Record<string, 1 | -1> | string) {
      if (typeof sort === 'string') {
        const sortObj: Record<string, 1 | -1> = {};
        sort.split(' ').forEach(field => {
          if (field.startsWith('-')) {
            sortObj[field.slice(1)] = -1;
          } else if (field) {
            sortObj[field] = 1;
          }
        });
        options.sort = sortObj;
      } else {
        options.sort = sort;
      }
      return builder;
    },
    limit(n: number) {
      options.limit = n;
      return builder;
    },
    skip(n: number) {
      options.skip = n;
      return builder;
    },
    populate(opts: string | PopulateOptions | (string | PopulateOptions)[]) {
      options.populate = opts;
      return builder;
    },
    lean() {
      // lean mode - returns plain objects instead of wrapped documents
      return builder;
    },
    exec() {
      return executor(options);
    },
    then(resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) {
      return executor(options).then(resolve, reject);
    },
    catch(reject: (reason: unknown) => unknown) {
      return executor(options).catch(reject);
    },
    finally(onFinally: () => void) {
      return executor(options).finally(onFinally);
    }
  } as QueryBuilder<T>;

  // Promise uyumluluğu için
  (builder as any)[Symbol.toStringTag] = 'Promise';

  return builder;
}

/**
 * Document wrapper - instance methods ve save/remove ekler
 */
function wrapDocument<T extends Document>(
  data: Record<string, unknown>,
  schema: Schema,
  collectionName: string
): T {
  const doc = { ...data } as T;

  // Instance methods ekle
  for (const [name, fn] of Object.entries(schema.methods)) {
    (doc as any)[name] = fn.bind(doc);
  }

  // Virtual getters ekle
  for (const [name, virtual] of schema.virtuals) {
    Object.defineProperty(doc, name, {
      get: virtual.get?.bind(doc),
      set: virtual.set?.bind(doc),
      enumerable: true
    });
  }

  // save() method
  (doc as any).save = async function(): Promise<T> {
    const adapter = connectionManager.getAdapter();
    
    // Pre-save hooks
    await schema.runHooks('pre', 'save', doc);
    
    // Validation
    await schema.validate(doc);
    
    // updatedAt güncelle
    if (schema.options.timestamps) {
      (doc as any).updatedAt = new Date();
    }

    if (doc._id) {
      // Update existing
      await adapter.updateOne(collectionName, { _id: doc._id }, { $set: doc });
    } else {
      // Insert new
      const result = await adapter.insertOne(collectionName, doc);
      Object.assign(doc, result);
    }
    
    // Post-save hooks
    await schema.runHooks('post', 'save', doc);
    
    return doc;
  };

  // remove() method
  (doc as any).remove = async function(): Promise<void> {
    const adapter = connectionManager.getAdapter();
    
    // Pre-remove hooks
    await schema.runHooks('pre', 'remove', doc);
    
    await adapter.deleteOne(collectionName, { _id: doc._id });
    
    // Post-remove hooks
    await schema.runHooks('post', 'remove', doc);
  };

  // toJSON() method
  (doc as any).toJSON = function(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(doc)) {
      if (typeof (doc as any)[key] !== 'function') {
        obj[key] = (doc as any)[key];
      }
    }
    return obj;
  };

  // toObject() method
  (doc as any).toObject = (doc as any).toJSON;

  return doc;
}

/**
 * Model oluştur
 * 
 * @example
 * ```ts
 * const User = model('User', UserSchema);
 * ```
 */
export function model<T extends Document = Document>(
  name: string,
  schema: Schema
): IModel<T> {
  // Zaten varsa döndür
  if (models.has(name)) {
    return models.get(name) as IModel<T>;
  }

  const collectionName = schema.options.collection || name.toLowerCase() + 's';

  // Sync manager
  const getSyncManager = () => {
    const adapter = connectionManager.getAdapter();
    return new SchemaSyncManager(adapter, collectionName, schema);
  };

  // Auto-sync helper - ilk işlemde otomatik sync
  async function ensureSynced(): Promise<void> {
    if (syncedModels.has(name)) return;
    
    if (connectionManager.syncEnabled) {
      const syncManager = getSyncManager();
      await syncManager.sync(connectionManager.syncOptions);
      syncedModels.add(name);
    }
  }

  // Helper function for single document creation
  async function createSingleDoc(doc: Partial<T>): Promise<T> {
    const adapter = connectionManager.getAdapter();
    
    // Auto-sync eğer aktifse
    await ensureSynced();
    
    // Ensure collection exists
    await adapter.createCollection(collectionName, schema);

    // Apply defaults
    const docData = schema.applyDefaults(doc as Record<string, unknown>);
    
    // Create wrapped document for hooks
    const wrappedDoc = wrapDocument<T>(docData, schema, collectionName);
    
    // Pre-save hooks
    await schema.runHooks('pre', 'save', wrappedDoc);
    
    // Validate
    await schema.validate(wrappedDoc);
    
    // Insert
    const result = await adapter.insertOne(collectionName, wrappedDoc);
    
    // Post-save hooks
    const finalDoc = wrapDocument<T>(result, schema, collectionName);
    await schema.runHooks('post', 'save', finalDoc);
    
    return finalDoc;
  }

  const Model: IModel<T> = {
    modelName: name,
    schema: schema,

    // SYNC - Tabloyu schema ile senkronize et
    async sync(options: SyncOptions = {}): Promise<{ created: boolean; altered: boolean; changes: string[] }> {
      const syncManager = getSyncManager();
      const result = await syncManager.sync(options);
      syncedModels.add(name);
      return result;
    },

    // CREATE - using type assertion to satisfy overloaded interface
    create: (async (docOrDocs: Partial<T> | Partial<T>[]): Promise<T | T[]> => {
      if (Array.isArray(docOrDocs)) {
        const results: T[] = [];
        for (const doc of docOrDocs) {
          const result = await createSingleDoc(doc);
          results.push(result);
        }
        return results;
      }
      return createSingleDoc(docOrDocs);
    }) as IModel<T>['create'],

    async insertMany(docs: Partial<T>[]): Promise<T[]> {
      const results: T[] = [];
      for (const doc of docs) {
        const result = await createSingleDoc(doc);
        results.push(result);
      }
      return results;
    },

    // READ
    find(filter: QueryFilter = {}, options?: QueryOptions): QueryBuilder<T[]> {
      return createQueryBuilder<T[]>(async (opts) => {
        const adapter = connectionManager.getAdapter();
        await adapter.createCollection(collectionName, schema);
        
        const mergedOptions = { ...options, ...opts };
        const results = await adapter.find(collectionName, filter, mergedOptions);
        
        return results.map(doc => wrapDocument<T>(doc, schema, collectionName));
      });
    },

    findOne(filter: QueryFilter = {}, options?: QueryOptions): QueryBuilder<T | null> {
      return createQueryBuilder<T | null>(async (opts) => {
        const adapter = connectionManager.getAdapter();
        await adapter.createCollection(collectionName, schema);
        
        const mergedOptions = { ...options, ...opts };
        const result = await adapter.findOne(collectionName, filter, mergedOptions);
        
        return result ? wrapDocument<T>(result, schema, collectionName) : null;
      });
    },

    findById(id: string, options?: QueryOptions): QueryBuilder<T | null> {
      return this.findOne({ _id: id }, options);
    },

    async countDocuments(filter: QueryFilter = {}): Promise<number> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      return adapter.countDocuments(collectionName, filter);
    },

    async exists(filter: QueryFilter): Promise<boolean> {
      const count = await this.countDocuments(filter);
      return count > 0;
    },

    // UPDATE
    async updateOne(filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      
      // timestamps aktifse updatedAt ekle
      if (schema.options.timestamps) {
        if (!update.$set) update.$set = {};
        (update.$set as Record<string, unknown>).updatedAt = new Date();
      }
      
      return adapter.updateOne(collectionName, filter, update);
    },

    async updateMany(filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      
      if (schema.options.timestamps) {
        if (!update.$set) update.$set = {};
        (update.$set as Record<string, unknown>).updatedAt = new Date();
      }
      
      return adapter.updateMany(collectionName, filter, update);
    },

    async findOneAndUpdate(
      filter: QueryFilter,
      update: UpdateFilter,
      options?: FindOneAndUpdateOptions
    ): Promise<T | null> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      
      // Önce mevcut dokümanı bul
      const existing = options?.new 
        ? null 
        : await adapter.findOne(collectionName, filter);
      
      if (schema.options.timestamps) {
        if (!update.$set) update.$set = {};
        (update.$set as Record<string, unknown>).updatedAt = new Date();
      }
      
      const result = await adapter.updateOne(collectionName, filter, update);
      
      if (result.matchedCount === 0) {
        if (options?.upsert) {
          // Upsert: yeni doküman oluştur
          const newDoc = await this.create(
            Object.assign({}, filter, update.$set || update) as Partial<T>
          ) as T;
          return newDoc;
        }
        return null;
      }
      
      if (options?.new) {
        // Güncellenmiş dokümanı döndür
        const updated = await adapter.findOne(collectionName, filter);
        return updated ? wrapDocument<T>(updated, schema, collectionName) : null;
      }
      
      return existing ? wrapDocument<T>(existing, schema, collectionName) : null;
    },

    async findByIdAndUpdate(
      id: string,
      update: UpdateFilter,
      options?: FindOneAndUpdateOptions
    ): Promise<T | null> {
      return this.findOneAndUpdate({ _id: id }, update, options);
    },

    // DELETE
    async deleteOne(filter: QueryFilter): Promise<DeleteResult> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      return adapter.deleteOne(collectionName, filter);
    },

    async deleteMany(filter: QueryFilter): Promise<DeleteResult> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      return adapter.deleteMany(collectionName, filter);
    },

    async findOneAndDelete(filter: QueryFilter): Promise<T | null> {
      const adapter = connectionManager.getAdapter();
      await adapter.createCollection(collectionName, schema);
      
      const existing = await adapter.findOne(collectionName, filter);
      if (!existing) return null;
      
      await adapter.deleteOne(collectionName, filter);
      return wrapDocument<T>(existing, schema, collectionName);
    },

    async findByIdAndDelete(id: string): Promise<T | null> {
      return this.findOneAndDelete({ _id: id });
    }
  };

  // Static methods ekle
  for (const [name, fn] of Object.entries(schema.statics)) {
    (Model as any)[name] = fn.bind(Model);
  }

  models.set(name, Model);
  return Model;
}

/**
 * Kayıtlı tüm modelleri getir
 */
export function getModels(): Map<string, IModel> {
  return models;
}

/**
 * Belirli bir modeli getir
 */
export function getModel<T extends Document = Document>(name: string): IModel<T> | undefined {
  return models.get(name) as IModel<T> | undefined;
}

/**
 * Model registry'yi temizle
 */
export function clearModels(): void {
  models.clear();
  syncedModels.clear();
}

/**
 * Tüm kayıtlı modelleri veritabanıyla senkronize et
 * 
 * @example
 * ```ts
 * // Tüm tabloları oluştur/güncelle
 * await syncAll();
 * 
 * // Tabloları sil ve yeniden oluştur (DİKKAT: veri kaybı!)
 * await syncAll({ force: true });
 * 
 * // Yeni alanları ekle
 * await syncAll({ alter: true });
 * ```
 */
export async function syncAll(options: SyncOptions = { alter: true }): Promise<Map<string, { created: boolean; altered: boolean; changes: string[] }>> {
  const results = new Map<string, { created: boolean; altered: boolean; changes: string[] }>();
  
  for (const [name, modelInstance] of models) {
    const result = await modelInstance.sync(options);
    results.set(name, result);
  }
  
  return results;
}
