// ============================================
// SDBC - Basic Usage Tests
// ============================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Schema, model, connect, disconnect } from '../src';

describe('SDBC Basic Usage', () => {
  describe('Schema', () => {
    it('should create a schema with field definitions', () => {
      const UserSchema = new Schema({
        name: { type: String, required: true },
        email: { type: String, unique: true },
        age: { type: Number, default: 18 }
      });

      expect(UserSchema.definition.name).toBeDefined();
      expect(UserSchema.definition.email).toBeDefined();
      expect(UserSchema.definition.age).toBeDefined();
    });

    it('should normalize short syntax', () => {
      const schema = new Schema({
        name: String,
        count: Number
      });

      expect((schema.definition.name as any).type).toBe(String);
      expect((schema.definition.count as any).type).toBe(Number);
    });

    it('should add timestamps when enabled', () => {
      const schema = new Schema({ name: String }, { timestamps: true });

      expect(schema.definition.createdAt).toBeDefined();
      expect(schema.definition.updatedAt).toBeDefined();
    });

    it('should support pre hooks', () => {
      const schema = new Schema({ name: String });
      const hookFn = function() { console.log('pre save'); };
      
      schema.pre('save', hookFn);
      
      expect(schema.hooks.pre.get('save')).toContain(hookFn);
    });

    it('should support post hooks', () => {
      const schema = new Schema({ name: String });
      const hookFn = function() { console.log('post save'); };
      
      schema.post('save', hookFn);
      
      expect(schema.hooks.post.get('save')).toContain(hookFn);
    });

    it('should support instance methods', () => {
      const schema = new Schema({ age: Number });
      
      schema.methods.isAdult = function() {
        return this.age >= 18;
      };
      
      expect(schema.methods.isAdult).toBeDefined();
    });

    it('should support virtuals', () => {
      const schema = new Schema({
        firstName: String,
        lastName: String
      });

      schema.virtual('fullName')
        .get(function() {
          return `${this.firstName} ${this.lastName}`;
        });

      expect(schema.virtuals.has('fullName')).toBe(true);
    });

    it('should apply defaults', () => {
      const schema = new Schema({
        name: { type: String, default: 'Anonymous' },
        count: { type: Number, default: 0 }
      });

      const doc = schema.applyDefaults({});
      
      expect(doc.name).toBe('Anonymous');
      expect(doc.count).toBe(0);
    });

    it('should validate required fields', async () => {
      const schema = new Schema({
        name: { type: String, required: true }
      });

      await expect(schema.validate({})).rejects.toThrow(/required/);
    });

    it('should validate types', async () => {
      const schema = new Schema({
        age: { type: Number }
      });

      await expect(schema.validate({ age: 'not a number' })).rejects.toThrow(/invalid type/);
    });

    it('should generate SQL schema', () => {
      const schema = new Schema({
        name: { type: String, required: true },
        age: { type: Number }
      });

      // toSQLSchema() artık obje döndürüyor
      const sqlSchema = schema.toSQLSchema();
      expect(sqlSchema).toHaveProperty('name');
      expect(sqlSchema.name.type).toBe('VARCHAR(255)');
      expect(sqlSchema.name.required).toBe(true);
      expect(sqlSchema).toHaveProperty('age');
      expect(sqlSchema.age.type).toBe('INT');
      
      // toSQLStatement() CREATE TABLE SQL döndürüyor
      const sql = schema.toSQLStatement('users');
      expect(sql).toContain('CREATE TABLE');
      expect(sql).toContain('users');
      expect(sql).toContain('name');
      expect(sql).toContain('NOT NULL');
    });
  });

  describe('Schema.Types', () => {
    it('should have ObjectId type', () => {
      expect(Schema.Types.ObjectId).toBe('ObjectId');
    });

    it('should have Mixed type', () => {
      expect(Schema.Types.Mixed).toBe('Mixed');
    });
  });
});

describe('Query Parser', () => {
  it('should parse simple equality', async () => {
    const { parseQueryFilter } = await import('../src/utils/query-parser');
    
    const conditions = parseQueryFilter({ name: 'Ali' });
    
    expect(conditions).toHaveLength(1);
    expect(conditions[0].field).toBe('name');
    expect(conditions[0].operator).toBe('$eq');
    expect(conditions[0].value).toBe('Ali');
  });

  it('should parse comparison operators', async () => {
    const { parseQueryFilter } = await import('../src/utils/query-parser');
    
    const conditions = parseQueryFilter({ age: { $gte: 18, $lt: 65 } });
    
    expect(conditions).toHaveLength(2);
    expect(conditions.find(c => c.operator === '$gte')?.value).toBe(18);
    expect(conditions.find(c => c.operator === '$lt')?.value).toBe(65);
  });

  it('should parse $in operator', async () => {
    const { parseQueryFilter } = await import('../src/utils/query-parser');
    
    const conditions = parseQueryFilter({ status: { $in: ['active', 'pending'] } });
    
    expect(conditions[0].operator).toBe('$in');
    expect(conditions[0].value).toEqual(['active', 'pending']);
  });

  it('should parse $or operator', async () => {
    const { parseQueryFilter } = await import('../src/utils/query-parser');
    
    const conditions = parseQueryFilter({
      $or: [{ name: 'Ali' }, { name: 'Veli' }]
    });
    
    expect(conditions[0].operator).toBe('$or');
    expect(conditions[0].value).toHaveLength(2);
  });
});

describe('ID Generator', () => {
  it('should generate unique IDs', async () => {
    const { generateId } = await import('../src/utils/id-generator');
    
    const id1 = generateId();
    const id2 = generateId();
    
    expect(id1).not.toBe(id2);
    expect(id1).toHaveLength(32);
  });

  it('should generate valid ObjectIds', async () => {
    const { generateObjectId, isValidId } = await import('../src/utils/id-generator');
    
    const id = generateObjectId();
    
    expect(id).toHaveLength(24);
    expect(isValidId(id)).toBe(true);
  });

  it('should validate ID formats', async () => {
    const { isValidId } = await import('../src/utils/id-generator');
    
    expect(isValidId('507f1f77bcf86cd799439011')).toBe(true); // 24 char hex
    expect(isValidId('a'.repeat(32))).toBe(true); // 32 char hex
    expect(isValidId('invalid')).toBe(false);
    expect(isValidId(123)).toBe(false);
  });
});
