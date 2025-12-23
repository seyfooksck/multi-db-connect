// ============================================
// SDBC - Soft Delete
// Enterprise-grade soft delete functionality
// ============================================

export interface SoftDeleteOptions {
  /** Column name for deleted timestamp (default: deletedAt) */
  deletedAtColumn?: string;
  /** Column name for deleted by user (optional) */
  deletedByColumn?: string;
  /** Enable paranoid mode - exclude soft deleted by default */
  paranoid?: boolean;
  /** Restore related models on restore */
  cascade?: boolean;
}

export interface SoftDeleteResult {
  success: boolean;
  deletedCount: number;
  deletedAt: Date;
  deletedBy?: string;
}

export interface RestoreResult {
  success: boolean;
  restoredCount: number;
}

const DEFAULT_OPTIONS: Required<SoftDeleteOptions> = {
  deletedAtColumn: 'deletedAt',
  deletedByColumn: 'deletedBy',
  paranoid: true,
  cascade: false
};

/**
 * Soft Delete Manager
 * Manages soft delete operations for models
 */
export class SoftDeleteManager {
  private options: Required<SoftDeleteOptions>;

  constructor(options: SoftDeleteOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get the deleted at column name
   */
  get deletedAtColumn(): string {
    return this.options.deletedAtColumn;
  }

  /**
   * Get the deleted by column name
   */
  get deletedByColumn(): string {
    return this.options.deletedByColumn;
  }

  /**
   * Check if paranoid mode is enabled
   */
  get isParanoid(): boolean {
    return this.options.paranoid;
  }

  /**
   * Add soft delete fields to schema definition
   */
  extendSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return {
      ...schema,
      [this.options.deletedAtColumn]: {
        type: 'date',
        default: null,
        index: true
      },
      [this.options.deletedByColumn]: {
        type: 'string',
        default: null
      }
    };
  }

  /**
   * Build filter to exclude soft deleted records
   */
  excludeDeletedFilter(): Record<string, unknown> {
    if (!this.options.paranoid) {
      return {};
    }
    
    return {
      [this.options.deletedAtColumn]: null
    };
  }

  /**
   * Build filter to only include soft deleted records
   */
  onlyDeletedFilter(): Record<string, unknown> {
    return {
      [this.options.deletedAtColumn]: { $ne: null }
    };
  }

  /**
   * Build soft delete update
   */
  softDeleteUpdate(deletedBy?: string): Record<string, unknown> {
    const update: Record<string, unknown> = {
      [this.options.deletedAtColumn]: new Date()
    };

    if (deletedBy) {
      update[this.options.deletedByColumn] = deletedBy;
    }

    return update;
  }

  /**
   * Build restore update
   */
  restoreUpdate(): Record<string, unknown> {
    return {
      [this.options.deletedAtColumn]: null,
      [this.options.deletedByColumn]: null
    };
  }

  /**
   * Check if a document is soft deleted
   */
  isSoftDeleted(doc: Record<string, unknown>): boolean {
    return doc[this.options.deletedAtColumn] != null;
  }

  /**
   * Get deletion info from document
   */
  getDeletionInfo(doc: Record<string, unknown>): { deletedAt: Date | null; deletedBy: string | null } {
    return {
      deletedAt: doc[this.options.deletedAtColumn] as Date | null,
      deletedBy: doc[this.options.deletedByColumn] as string | null
    };
  }
}

/**
 * Soft Delete Mixin
 * Adds soft delete methods to a model
 */
export interface SoftDeleteMixin {
  /** Soft delete document(s) */
  softDelete(filter: Record<string, unknown>, deletedBy?: string): Promise<SoftDeleteResult>;
  
  /** Restore soft deleted document(s) */
  restore(filter: Record<string, unknown>): Promise<RestoreResult>;
  
  /** Permanently delete document(s) - force delete */
  forceDelete(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  
  /** Find including soft deleted */
  findWithDeleted(filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  
  /** Find only soft deleted */
  findOnlyDeleted(filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  
  /** Check if document is soft deleted */
  isSoftDeleted(doc: Record<string, unknown>): boolean;
}

/**
 * Create soft delete methods for adapter
 */
export function createSoftDeleteMethods(
  adapter: any,
  collection: string,
  options: SoftDeleteOptions = {}
): SoftDeleteMixin {
  const manager = new SoftDeleteManager(options);

  return {
    async softDelete(filter: Record<string, unknown>, deletedBy?: string): Promise<SoftDeleteResult> {
      const update = manager.softDeleteUpdate(deletedBy);
      const now = new Date();
      
      const result = await adapter.updateMany(collection, filter, { $set: update });
      
      return {
        success: true,
        deletedCount: result.modifiedCount || 0,
        deletedAt: now,
        deletedBy
      };
    },

    async restore(filter: Record<string, unknown>): Promise<RestoreResult> {
      // Only restore soft deleted documents
      const deletedFilter = {
        ...filter,
        ...manager.onlyDeletedFilter()
      };
      
      const update = manager.restoreUpdate();
      const result = await adapter.updateMany(collection, deletedFilter, { $set: update });
      
      return {
        success: true,
        restoredCount: result.modifiedCount || 0
      };
    },

    async forceDelete(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
      const result = await adapter.deleteMany(collection, filter);
      return { deletedCount: result.deletedCount || 0 };
    },

    async findWithDeleted(filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
      // Find all including soft deleted
      return adapter.find(collection, filter, {});
    },

    async findOnlyDeleted(filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
      const deletedFilter = {
        ...filter,
        ...manager.onlyDeletedFilter()
      };
      return adapter.find(collection, deletedFilter, {});
    },

    isSoftDeleted(doc: Record<string, unknown>): boolean {
      return manager.isSoftDeleted(doc);
    }
  };
}

/**
 * Middleware to auto-exclude soft deleted records
 */
export function softDeleteMiddleware(manager: SoftDeleteManager) {
  return {
    /**
     * Transform find filter to exclude soft deleted
     */
    transformFindFilter(filter: Record<string, unknown>): Record<string, unknown> {
      if (!manager.isParanoid) {
        return filter;
      }
      
      return {
        ...filter,
        ...manager.excludeDeletedFilter()
      };
    },

    /**
     * Transform delete to soft delete
     */
    transformDelete(filter: Record<string, unknown>): {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    } {
      return {
        filter,
        update: { $set: manager.softDeleteUpdate() }
      };
    }
  };
}

/**
 * Query scope helpers
 */
export class SoftDeleteScope {
  private manager: SoftDeleteManager;
  private _withTrashed: boolean = false;
  private _onlyTrashed: boolean = false;

  constructor(options: SoftDeleteOptions = {}) {
    this.manager = new SoftDeleteManager(options);
  }

  /**
   * Include soft deleted records in query
   */
  withTrashed(): this {
    this._withTrashed = true;
    this._onlyTrashed = false;
    return this;
  }

  /**
   * Only get soft deleted records
   */
  onlyTrashed(): this {
    this._onlyTrashed = true;
    this._withTrashed = false;
    return this;
  }

  /**
   * Exclude soft deleted records (default)
   */
  withoutTrashed(): this {
    this._withTrashed = false;
    this._onlyTrashed = false;
    return this;
  }

  /**
   * Apply scope to filter
   */
  applyToFilter(filter: Record<string, unknown>): Record<string, unknown> {
    if (this._withTrashed) {
      // Include all - no filter modification
      return filter;
    }
    
    if (this._onlyTrashed) {
      return {
        ...filter,
        ...this.manager.onlyDeletedFilter()
      };
    }
    
    // Default: exclude deleted
    if (this.manager.isParanoid) {
      return {
        ...filter,
        ...this.manager.excludeDeletedFilter()
      };
    }
    
    return filter;
  }

  /**
   * Reset scope
   */
  reset(): this {
    this._withTrashed = false;
    this._onlyTrashed = false;
    return this;
  }
}

// ============================================
// Document-level soft delete
// ============================================

export interface SoftDeletableDocument {
  deletedAt?: Date | null;
  deletedBy?: string | null;
  
  /** Soft delete this document */
  softDelete(deletedBy?: string): Promise<void>;
  
  /** Restore this document */
  restore(): Promise<void>;
  
  /** Permanently delete this document */
  forceDelete(): Promise<void>;
  
  /** Check if document is trashed */
  trashed(): boolean;
}

/**
 * Add soft delete methods to document
 */
export function addSoftDeleteToDocument(
  doc: Record<string, unknown>,
  adapter: any,
  collection: string,
  idField: string = '_id',
  options: SoftDeleteOptions = {}
): SoftDeletableDocument {
  const manager = new SoftDeleteManager(options);

  const softDeletable: SoftDeletableDocument = {
    deletedAt: doc[manager.deletedAtColumn] as Date | null,
    deletedBy: doc[manager.deletedByColumn] as string | null,

    async softDelete(deletedBy?: string): Promise<void> {
      const update = manager.softDeleteUpdate(deletedBy);
      await adapter.updateMany(collection, { [idField]: doc[idField] }, { $set: update });
      (this as any).deletedAt = new Date();
      if (deletedBy) {
        (this as any).deletedBy = deletedBy;
      }
    },

    async restore(): Promise<void> {
      const update = manager.restoreUpdate();
      await adapter.updateMany(collection, { [idField]: doc[idField] }, { $set: update });
      (this as any).deletedAt = null;
      (this as any).deletedBy = null;
    },

    async forceDelete(): Promise<void> {
      await adapter.deleteMany(collection, { [idField]: doc[idField] });
    },

    trashed(): boolean {
      return this.deletedAt != null;
    }
  };

  return { ...doc, ...softDeletable } as SoftDeletableDocument;
}

// ============================================
// Schema helper for soft delete
// ============================================

/**
 * Create schema fields for soft delete
 */
export function softDeleteFields(options: SoftDeleteOptions = {}): Record<string, unknown> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return {
    [opts.deletedAtColumn]: {
      type: 'date',
      default: null,
      index: true,
      sparse: true
    },
    [opts.deletedByColumn]: {
      type: 'string',
      default: null
    }
  };
}

/**
 * Create indexes for soft delete
 */
export function softDeleteIndexes(options: SoftDeleteOptions = {}): Array<{ fields: Record<string, number>; options?: Record<string, unknown> }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return [
    {
      fields: { [opts.deletedAtColumn]: 1 },
      options: { sparse: true }
    }
  ];
}
