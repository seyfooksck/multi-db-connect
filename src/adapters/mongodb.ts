// ============================================
// SDBC - MongoDB Adapter
// Native MongoDB driver implementation
// ============================================

import { BaseAdapter } from './base';
import type {
  DatabaseCapabilities,
  QueryFilter,
  QueryOptions,
  UpdateFilter,
  UpdateResult,
  DeleteResult,
  ISchema
} from '../types';
import { parseQueryFilter, toMongoFilter, parseUpdateFilter } from '../utils/query-parser';
import { generateObjectId } from '../utils/id-generator';

// MongoDB types - actual types from mongodb package
import type { MongoClient, Db, Collection } from 'mongodb';

export class MongoDBAdapter extends BaseAdapter {
  name = 'mongodb' as const;
  capabilities: DatabaseCapabilities = {
    joins: false,
    json: true,
    transactions: true,
    aggregation: true,
    changeStreams: true,
    fullTextSearch: true
  };

  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(uri: string, options?: Record<string, unknown>): Promise<void> {
    try {
      const { MongoClient } = await import('mongodb');
      
      this.client = new MongoClient(uri, options as any);
      await this.client.connect();
      
      // URI'den database adını çıkar
      const dbName = uri.split('/').pop()?.split('?')[0] || 'test';
      this.db = this.client.db(dbName);
      this.connected = true;
    } catch (error) {
      throw new Error(`MongoDB connection failed: ${(error as Error).message}`);
    }
  }


  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connected = false;
    }
  }

  private getCollection(name: string): Collection {
    this.ensureConnected();
    return this.db!.collection(name);
  }

  async createCollection(name: string, schema: ISchema): Promise<void> {
    this.ensureConnected();
    
    const collections = await this.db!.listCollections({ name }).toArray();
    if (collections.length === 0) {
      await this.db!.createCollection(name);
    }

    // Index'leri oluştur
    const collection = this.getCollection(name);
    
    // Unique field'lar için index
    for (const [field, def] of Object.entries(schema.definition)) {
      const fieldDef = def as { unique?: boolean; index?: boolean };
      if (fieldDef.unique) {
        await collection.createIndex({ [field]: 1 }, { unique: true });
      } else if (fieldDef.index) {
        await collection.createIndex({ [field]: 1 });
      }
    }

    // Schema'daki ek index tanımları
    for (const idx of (schema as any).indexes || []) {
      await collection.createIndex(idx.fields, idx.options || {});
    }
  }

  async dropCollection(name: string): Promise<void> {
    this.ensureConnected();
    try {
      await this.db!.dropCollection(name);
    } catch {
      // Collection zaten yoksa hata verme
    }
  }

  async insertOne(collection: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const coll = this.getCollection(collection);
    
    // _id yoksa oluştur
    const docWithId = {
      _id: doc._id || generateObjectId(),
      ...doc
    };
    
    const result = await coll.insertOne(docWithId as any);
    return { ...docWithId, _id: result.insertedId.toString() };
  }

  async insertMany(collection: string, docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const coll = this.getCollection(collection);
    
    const docsWithIds = docs.map(doc => ({
      _id: doc._id || generateObjectId(),
      ...doc
    }));
    
    await coll.insertMany(docsWithIds as any);
    return docsWithIds.map(d => ({ ...d, _id: d._id.toString() }));
  }

  async find(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown>[]> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    
    let cursor = coll.find(mongoFilter);
    
    if (options?.sort) {
      cursor = cursor.sort(options.sort);
    }
    if (options?.skip) {
      cursor = cursor.skip(options.skip);
    }
    if (options?.limit) {
      cursor = cursor.limit(options.limit);
    }
    if (options?.select) {
      const projection = this.buildProjection(options.select);
      cursor = cursor.project(projection);
    }
    
    const results = await cursor.toArray();
    return results.map((doc: Record<string, unknown>) => this.normalizeDocument(doc));
  }

  async findOne(collection: string, filter: QueryFilter, options?: QueryOptions): Promise<Record<string, unknown> | null> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    
    const findOptions: any = {};
    if (options?.select) {
      findOptions.projection = this.buildProjection(options.select);
    }
    
    const doc = await coll.findOne(mongoFilter, findOptions);
    return doc ? this.normalizeDocument(doc) : null;
  }

  async updateOne(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    const mongoUpdate = this.buildUpdateDocument(update);
    
    const result = await coll.updateOne(mongoFilter, mongoUpdate);
    
    return {
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId?.toString()
    };
  }

  async updateMany(collection: string, filter: QueryFilter, update: UpdateFilter): Promise<UpdateResult> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    const mongoUpdate = this.buildUpdateDocument(update);
    
    const result = await coll.updateMany(mongoFilter, mongoUpdate);
    
    return {
      acknowledged: result.acknowledged,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId?.toString()
    };
  }

  async deleteOne(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    
    const result = await coll.deleteOne(mongoFilter);
    
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount
    };
  }

  async deleteMany(collection: string, filter: QueryFilter): Promise<DeleteResult> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    
    const result = await coll.deleteMany(mongoFilter);
    
    return {
      acknowledged: result.acknowledged,
      deletedCount: result.deletedCount
    };
  }

  async countDocuments(collection: string, filter: QueryFilter): Promise<number> {
    const coll = this.getCollection(collection);
    const conditions = parseQueryFilter(filter);
    const mongoFilter = toMongoFilter(conditions);
    
    return coll.countDocuments(mongoFilter);
  }

  /**
   * Select ifadesini MongoDB projection'a çevir
   */
  private buildProjection(select: QueryOptions['select']): Record<string, 0 | 1> {
    if (typeof select === 'string') {
      const projection: Record<string, 0 | 1> = {};
      select.split(' ').forEach(field => {
        if (field.startsWith('-')) {
          projection[field.slice(1)] = 0;
        } else if (field) {
          projection[field] = 1;
        }
      });
      return projection;
    }
    
    if (Array.isArray(select)) {
      const projection: Record<string, 0 | 1> = {};
      select.forEach(field => {
        projection[field] = 1;
      });
      return projection;
    }
    
    return select as Record<string, 0 | 1>;
  }

  /**
   * Update filter'ı MongoDB update document'e çevir
   */
  private buildUpdateDocument(update: UpdateFilter): Record<string, unknown> {
    const parsed = parseUpdateFilter(update);
    const mongoUpdate: Record<string, unknown> = {};
    
    if (Object.keys(parsed.sets).length > 0) {
      mongoUpdate.$set = parsed.sets;
    }
    
    if (Object.keys(parsed.increments).length > 0) {
      mongoUpdate.$inc = parsed.increments;
    }
    
    if (parsed.unsets.length > 0) {
      mongoUpdate.$unset = parsed.unsets.reduce((acc, key) => {
        acc[key] = '';
        return acc;
      }, {} as Record<string, string>);
    }
    
    if (Object.keys(parsed.pushes).length > 0) {
      mongoUpdate.$push = parsed.pushes;
    }
    
    if (Object.keys(parsed.pulls).length > 0) {
      mongoUpdate.$pull = parsed.pulls;
    }
    
    return mongoUpdate;
  }

  /**
   * MongoDB document'i normalize et (_id string'e çevir)
   */
  private normalizeDocument(doc: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...doc };
    if (normalized._id) {
      normalized._id = normalized._id.toString();
    }
    return normalized;
  }
}
