// ============================================
// SDBC - Schema Class
// Mongoose-compatible Schema definition
// ============================================

import type {
  SchemaDefinition,
  SchemaOptions,
  SchemaField,
  SchemaFieldDefinition,
  ISchema,
  HookEvent,
  HookFunction,
  VirtualDefinition,
  VirtualBuilder,
  IndexOptions,
  Document
} from './types';

export class Schema implements ISchema {
  public definition: SchemaDefinition;
  public options: SchemaOptions;
  public methods: Record<string, Function> = {};
  public statics: Record<string, Function> = {};
  public virtuals: Map<string, VirtualDefinition> = new Map();
  public indexes: Array<{ fields: Record<string, 1 | -1>; options?: IndexOptions }> = [];
  public hooks: {
    pre: Map<string, HookFunction[]>;
    post: Map<string, HookFunction[]>;
  } = {
    pre: new Map(),
    post: new Map()
  };

  // ObjectId type reference (Mongoose uyumluluğu için)
  static Types = {
    ObjectId: 'ObjectId' as const,
    Mixed: 'Mixed' as const
  };

  constructor(definition: SchemaDefinition, options: SchemaOptions = {}) {
    this.definition = this.normalizeDefinition(definition);
    this.options = {
      timestamps: false,
      strict: true,
      versionKey: '__v',
      ...options
    };

    // timestamps aktifse createdAt ve updatedAt alanlarını ekle
    if (this.options.timestamps) {
      this.definition.createdAt = { type: Date, default: () => new Date() };
      this.definition.updatedAt = { type: Date, default: () => new Date() };
    }
  }

  /**
   * Schema tanımını normalize et
   * Kısa sözdizimini (type: String) uzun forma çevir
   */
  private normalizeDefinition(definition: SchemaDefinition): SchemaDefinition {
    const normalized: SchemaDefinition = {};

    for (const [key, value] of Object.entries(definition)) {
      if (this.isSchemaType(value)) {
        // Kısa sözdizimi: name: String
        normalized[key] = { type: value } as SchemaFieldDefinition;
      } else {
        // Uzun sözdizimi: name: { type: String, required: true }
        normalized[key] = value;
      }
    }

    return normalized;
  }

  /**
   * Değerin bir Schema tipi olup olmadığını kontrol et
   */
  private isSchemaType(value: SchemaField): boolean {
    return (
      value === String ||
      value === Number ||
      value === Boolean ||
      value === Date ||
      value === Buffer ||
      value === Array ||
      value === Object ||
      value === 'ObjectId' ||
      value === 'Mixed'
    );
  }

  /**
   * Pre-hook ekle
   */
  pre(event: HookEvent, fn: HookFunction): void {
    if (!this.hooks.pre.has(event)) {
      this.hooks.pre.set(event, []);
    }
    this.hooks.pre.get(event)!.push(fn);
  }

  /**
   * Post-hook ekle
   */
  post(event: HookEvent, fn: HookFunction): void {
    if (!this.hooks.post.has(event)) {
      this.hooks.post.set(event, []);
    }
    this.hooks.post.get(event)!.push(fn);
  }

  /**
   * Virtual field tanımla
   */
  virtual(name: string): VirtualBuilder {
    const virtualDef: VirtualDefinition = {};
    this.virtuals.set(name, virtualDef);

    const builder: VirtualBuilder = {
      get: (fn: () => unknown) => {
        virtualDef.get = fn;
        return builder;
      },
      set: (fn: (value: unknown) => void) => {
        virtualDef.set = fn;
        return builder;
      }
    };

    return builder;
  }

  /**
   * Index tanımla
   */
  index(fields: Record<string, 1 | -1>, options?: IndexOptions): void {
    this.indexes.push({ fields, options });
  }

  /**
   * Belirli bir alan için tanımı getir
   */
  path(fieldPath: string): SchemaFieldDefinition | undefined {
    return this.definition[fieldPath] as SchemaFieldDefinition;
  }

  /**
   * Yeni alan ekle
   */
  add(definition: SchemaDefinition): void {
    const normalized = this.normalizeDefinition(definition);
    Object.assign(this.definition, normalized);
  }

  /**
   * Hook'ları çalıştır
   */
  async runHooks(type: 'pre' | 'post', event: HookEvent, doc: Document): Promise<void> {
    const hooks = this.hooks[type].get(event) || [];
    
    for (const hook of hooks) {
      await new Promise<void>((resolve, reject) => {
        try {
          const result = hook.call(doc, resolve);
          // Eğer Promise dönüyorsa bekle
          if (result instanceof Promise) {
            result.then(() => resolve()).catch(reject);
          } else if (hooks.length === 1 || hook.length === 0) {
            // next() çağrılmadıysa otomatik devam et
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      });
    }
  }

  /**
   * Varsayılan değerleri uygula
   */
  applyDefaults(doc: Record<string, unknown>): Record<string, unknown> {
    const result = { ...doc };

    for (const [key, fieldDef] of Object.entries(this.definition)) {
      if (result[key] === undefined) {
        const def = fieldDef as SchemaFieldDefinition;
        if (def.default !== undefined) {
          result[key] = typeof def.default === 'function' 
            ? def.default() 
            : def.default;
        }
      }
    }

    return result;
  }

  /**
   * Doğrulama yap
   */
  async validate(doc: Record<string, unknown>): Promise<void> {
    const errors: string[] = [];

    for (const [key, fieldDef] of Object.entries(this.definition)) {
      const def = fieldDef as SchemaFieldDefinition;
      const value = doc[key];

      // Required kontrolü
      if (def.required && (value === undefined || value === null)) {
        errors.push(`Field '${key}' is required`);
        continue;
      }

      // Değer yoksa diğer validasyonları atla
      if (value === undefined || value === null) continue;

      // Type kontrolü
      if (!this.validateType(value, def.type)) {
        errors.push(`Field '${key}' has invalid type`);
      }

      // Enum kontrolü
      if (def.enum && !def.enum.includes(value)) {
        errors.push(`Field '${key}' must be one of: ${def.enum.join(', ')}`);
      }

      // Min/Max kontrolü
      if (typeof value === 'number') {
        if (def.min !== undefined && value < def.min) {
          errors.push(`Field '${key}' must be at least ${def.min}`);
        }
        if (def.max !== undefined && value > def.max) {
          errors.push(`Field '${key}' must be at most ${def.max}`);
        }
      }

      // String uzunluk kontrolü
      if (typeof value === 'string') {
        if (def.minlength !== undefined && value.length < def.minlength) {
          errors.push(`Field '${key}' must be at least ${def.minlength} characters`);
        }
        if (def.maxlength !== undefined && value.length > def.maxlength) {
          errors.push(`Field '${key}' must be at most ${def.maxlength} characters`);
        }
        if (def.match && !def.match.test(value)) {
          errors.push(`Field '${key}' does not match the required pattern`);
        }
      }

      // Custom validate
      if (def.validate) {
        const isValid = await def.validate(value);
        if (!isValid) {
          errors.push(`Field '${key}' failed custom validation`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Tip doğrulama
   */
  private validateType(value: unknown, type: SchemaFieldDefinition['type']): boolean {
    switch (type) {
      case String:
        return typeof value === 'string';
      case Number:
        return typeof value === 'number' && !isNaN(value);
      case Boolean:
        return typeof value === 'boolean';
      case Date:
        return value instanceof Date || !isNaN(Date.parse(value as string));
      case Array:
        return Array.isArray(value);
      case Object:
      case 'Mixed':
        return typeof value === 'object';
      case 'ObjectId':
        return typeof value === 'string' || (typeof value === 'object' && value !== null);
      default:
        return true;
    }
  }

  /**
   * SQL tablo şeması oluştur (CREATE TABLE SQL)
   */
  toSQLStatement(tableName: string): string {
    const columns: string[] = ['_id VARCHAR(36) PRIMARY KEY'];

    for (const [key, fieldDef] of Object.entries(this.definition)) {
      if (key === '_id') continue;
      
      const def = fieldDef as SchemaFieldDefinition;
      const sqlType = this.typeToSQL(def.type);
      let column = `${key} ${sqlType}`;

      if (def.required) column += ' NOT NULL';
      if (def.unique) column += ' UNIQUE';
      if (def.default !== undefined && typeof def.default !== 'function') {
        column += ` DEFAULT ${this.defaultToSQL(def.default)}`;
      }

      columns.push(column);
    }

    return `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
  }

  /**
   * SQL schema objesini döndür (her alan için tip bilgisi)
   */
  toSQLSchema(): Record<string, { type: string; required?: boolean; unique?: boolean; default?: unknown }> {
    const schema: Record<string, { type: string; required?: boolean; unique?: boolean; default?: unknown }> = {};

    for (const [key, fieldDef] of Object.entries(this.definition)) {
      const def = fieldDef as SchemaFieldDefinition;
      schema[key] = {
        type: this.typeToSQL(def.type),
        required: def.required,
        unique: def.unique,
        default: typeof def.default === 'function' ? undefined : def.default
      };
    }

    return schema;
  }

  /**
   * JavaScript tipini SQL tipine çevir
   */
  private typeToSQL(type: SchemaFieldDefinition['type']): string {
    switch (type) {
      case String:
      case 'ObjectId':
        return 'VARCHAR(255)';
      case Number:
        return 'INT';
      case Boolean:
        return 'BOOLEAN';
      case Date:
        return 'DATETIME';
      case Array:
      case Object:
      case 'Mixed':
        return 'JSON';
      default:
        return 'TEXT';
    }
  }

  /**
   * Default değeri SQL formatına çevir
   */
  private defaultToSQL(value: unknown): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    return String(value);
  }
}
