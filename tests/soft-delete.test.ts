// ============================================
// SDBC - Soft Delete Tests
// ============================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SoftDeleteManager,
  SoftDeleteScope,
  createSoftDeleteMethods,
  softDeleteMiddleware,
  addSoftDeleteToDocument,
  softDeleteFields,
  softDeleteIndexes
} from '../src/soft-delete';

describe('Soft Delete', () => {
  describe('SoftDeleteManager', () => {
    it('should create with default options', () => {
      const manager = new SoftDeleteManager();
      
      expect(manager.deletedAtColumn).toBe('deletedAt');
      expect(manager.deletedByColumn).toBe('deletedBy');
      expect(manager.isParanoid).toBe(true);
    });

    it('should create with custom options', () => {
      const manager = new SoftDeleteManager({
        deletedAtColumn: 'removed_at',
        deletedByColumn: 'removed_by',
        paranoid: false
      });
      
      expect(manager.deletedAtColumn).toBe('removed_at');
      expect(manager.deletedByColumn).toBe('removed_by');
      expect(manager.isParanoid).toBe(false);
    });

    it('should extend schema with soft delete fields', () => {
      const manager = new SoftDeleteManager();
      const schema = { name: { type: 'string' } };
      
      const extended = manager.extendSchema(schema);
      
      expect(extended).toHaveProperty('name');
      expect(extended).toHaveProperty('deletedAt');
      expect(extended).toHaveProperty('deletedBy');
    });

    it('should build exclude deleted filter', () => {
      const manager = new SoftDeleteManager();
      
      const filter = manager.excludeDeletedFilter();
      
      expect(filter).toEqual({ deletedAt: null });
    });

    it('should build only deleted filter', () => {
      const manager = new SoftDeleteManager();
      
      const filter = manager.onlyDeletedFilter();
      
      expect(filter).toEqual({ deletedAt: { $ne: null } });
    });

    it('should build soft delete update', () => {
      const manager = new SoftDeleteManager();
      
      const update = manager.softDeleteUpdate('user123');
      
      expect(update).toHaveProperty('deletedAt');
      expect(update.deletedAt).toBeInstanceOf(Date);
      expect(update.deletedBy).toBe('user123');
    });

    it('should build restore update', () => {
      const manager = new SoftDeleteManager();
      
      const update = manager.restoreUpdate();
      
      expect(update).toEqual({ deletedAt: null, deletedBy: null });
    });

    it('should check if document is soft deleted', () => {
      const manager = new SoftDeleteManager();
      
      const deletedDoc = { deletedAt: new Date() };
      const activeDoc = { deletedAt: null };
      
      expect(manager.isSoftDeleted(deletedDoc)).toBe(true);
      expect(manager.isSoftDeleted(activeDoc)).toBe(false);
    });

    it('should get deletion info', () => {
      const manager = new SoftDeleteManager();
      const now = new Date();
      
      const info = manager.getDeletionInfo({
        deletedAt: now,
        deletedBy: 'admin'
      });
      
      expect(info.deletedAt).toBe(now);
      expect(info.deletedBy).toBe('admin');
    });

    it('should return empty filter when paranoid is false', () => {
      const manager = new SoftDeleteManager({ paranoid: false });
      
      const filter = manager.excludeDeletedFilter();
      
      expect(filter).toEqual({});
    });
  });

  describe('SoftDeleteScope', () => {
    it('should exclude deleted by default', () => {
      const scope = new SoftDeleteScope();
      
      const filter = scope.applyToFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test', deletedAt: null });
    });

    it('should include deleted with withTrashed', () => {
      const scope = new SoftDeleteScope();
      
      const filter = scope.withTrashed().applyToFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test' });
    });

    it('should only get deleted with onlyTrashed', () => {
      const scope = new SoftDeleteScope();
      
      const filter = scope.onlyTrashed().applyToFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test', deletedAt: { $ne: null } });
    });

    it('should reset scope', () => {
      const scope = new SoftDeleteScope();
      
      scope.withTrashed().reset();
      const filter = scope.applyToFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test', deletedAt: null });
    });

    it('should chain scope methods', () => {
      const scope = new SoftDeleteScope();
      
      const filter = scope.withTrashed().withoutTrashed().applyToFilter({});
      
      expect(filter).toHaveProperty('deletedAt', null);
    });
  });

  describe('createSoftDeleteMethods', () => {
    let mockAdapter: any;
    let methods: any;

    beforeEach(() => {
      mockAdapter = {
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 5 }),
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 3 }),
        find: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }])
      };
      
      methods = createSoftDeleteMethods(mockAdapter, 'users');
    });

    it('should soft delete documents', async () => {
      const result = await methods.softDelete({ status: 'inactive' }, 'admin');
      
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(result.deletedBy).toBe('admin');
      expect(result.deletedAt).toBeInstanceOf(Date);
      
      expect(mockAdapter.updateMany).toHaveBeenCalledWith(
        'users',
        { status: 'inactive' },
        expect.objectContaining({ $set: expect.any(Object) })
      );
    });

    it('should restore documents', async () => {
      const result = await methods.restore({ id: 1 });
      
      expect(result.success).toBe(true);
      expect(result.restoredCount).toBe(5);
      
      expect(mockAdapter.updateMany).toHaveBeenCalledWith(
        'users',
        { id: 1, deletedAt: { $ne: null } },
        { $set: { deletedAt: null, deletedBy: null } }
      );
    });

    it('should force delete documents', async () => {
      const result = await methods.forceDelete({ id: 1 });
      
      expect(result.deletedCount).toBe(3);
      expect(mockAdapter.deleteMany).toHaveBeenCalledWith('users', { id: 1 });
    });

    it('should find with deleted', async () => {
      const docs = await methods.findWithDeleted({ status: 'any' });
      
      expect(docs).toHaveLength(2);
      expect(mockAdapter.find).toHaveBeenCalledWith('users', { status: 'any' }, {});
    });

    it('should find only deleted', async () => {
      await methods.findOnlyDeleted({ name: 'test' });
      
      expect(mockAdapter.find).toHaveBeenCalledWith(
        'users',
        { name: 'test', deletedAt: { $ne: null } },
        {}
      );
    });

    it('should check if document is soft deleted', () => {
      const deleted = { deletedAt: new Date() };
      const active = { deletedAt: null };
      
      expect(methods.isSoftDeleted(deleted)).toBe(true);
      expect(methods.isSoftDeleted(active)).toBe(false);
    });
  });

  describe('softDeleteMiddleware', () => {
    it('should transform find filter', () => {
      const manager = new SoftDeleteManager();
      const middleware = softDeleteMiddleware(manager);
      
      const filter = middleware.transformFindFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test', deletedAt: null });
    });

    it('should not transform when paranoid is false', () => {
      const manager = new SoftDeleteManager({ paranoid: false });
      const middleware = softDeleteMiddleware(manager);
      
      const filter = middleware.transformFindFilter({ name: 'test' });
      
      expect(filter).toEqual({ name: 'test' });
    });

    it('should transform delete to soft delete', () => {
      const manager = new SoftDeleteManager();
      const middleware = softDeleteMiddleware(manager);
      
      const { filter, update } = middleware.transformDelete({ id: 1 });
      
      expect(filter).toEqual({ id: 1 });
      expect(update.$set).toHaveProperty('deletedAt');
    });
  });

  describe('addSoftDeleteToDocument', () => {
    let mockAdapter: any;

    beforeEach(() => {
      mockAdapter = {
        updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 })
      };
    });

    it('should add soft delete methods to document', () => {
      const doc = { _id: '123', name: 'test' };
      const softDoc = addSoftDeleteToDocument(doc, mockAdapter, 'users');
      
      expect(softDoc).toHaveProperty('softDelete');
      expect(softDoc).toHaveProperty('restore');
      expect(softDoc).toHaveProperty('forceDelete');
      expect(softDoc).toHaveProperty('trashed');
    });

    it('should soft delete document', async () => {
      const doc = { _id: '123', name: 'test' };
      const softDoc = addSoftDeleteToDocument(doc, mockAdapter, 'users');
      
      await softDoc.softDelete('admin');
      
      expect(mockAdapter.updateMany).toHaveBeenCalled();
      expect(softDoc.deletedAt).toBeInstanceOf(Date);
      expect(softDoc.deletedBy).toBe('admin');
    });

    it('should restore document', async () => {
      const doc = { _id: '123', name: 'test', deletedAt: new Date() };
      const softDoc = addSoftDeleteToDocument(doc, mockAdapter, 'users');
      
      await softDoc.restore();
      
      expect(mockAdapter.updateMany).toHaveBeenCalled();
      expect(softDoc.deletedAt).toBeNull();
      expect(softDoc.deletedBy).toBeNull();
    });

    it('should force delete document', async () => {
      const doc = { _id: '123', name: 'test' };
      const softDoc = addSoftDeleteToDocument(doc, mockAdapter, 'users');
      
      await softDoc.forceDelete();
      
      expect(mockAdapter.deleteMany).toHaveBeenCalledWith('users', { _id: '123' });
    });

    it('should check if trashed', () => {
      const deletedDoc = { _id: '1', deletedAt: new Date() };
      const activeDoc = { _id: '2', deletedAt: null };
      
      const soft1 = addSoftDeleteToDocument(deletedDoc, mockAdapter, 'users');
      const soft2 = addSoftDeleteToDocument(activeDoc, mockAdapter, 'users');
      
      expect(soft1.trashed()).toBe(true);
      expect(soft2.trashed()).toBe(false);
    });
  });

  describe('Helper Functions', () => {
    it('should create soft delete fields', () => {
      const fields = softDeleteFields();
      
      expect(fields).toHaveProperty('deletedAt');
      expect(fields).toHaveProperty('deletedBy');
      expect((fields.deletedAt as any).type).toBe('date');
      expect((fields.deletedAt as any).index).toBe(true);
    });

    it('should create soft delete fields with custom names', () => {
      const fields = softDeleteFields({
        deletedAtColumn: 'removed_at',
        deletedByColumn: 'removed_by'
      });
      
      expect(fields).toHaveProperty('removed_at');
      expect(fields).toHaveProperty('removed_by');
    });

    it('should create soft delete indexes', () => {
      const indexes = softDeleteIndexes();
      
      expect(indexes).toHaveLength(1);
      expect(indexes[0].fields).toHaveProperty('deletedAt');
      expect(indexes[0].options?.sparse).toBe(true);
    });
  });
});
