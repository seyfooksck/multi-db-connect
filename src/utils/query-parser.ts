// ============================================
// SDBC - Query Parser
// Mongoose query syntax to native query conversion
// ============================================

import type { QueryFilter, QueryOperators, UpdateFilter, UpdateOperators } from '../types';

export interface ParsedCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface SQLQuery {
  where: string;
  params: unknown[];
}

/**
 * Mongoose query filter'ını parse et
 */
export function parseQueryFilter(filter: QueryFilter): ParsedCondition[] {
  const conditions: ParsedCondition[] = [];

  for (const [field, condition] of Object.entries(filter)) {
    // $or ve $and operatörleri
    if (field === '$or' || field === '$and') {
      conditions.push({
        field,
        operator: field,
        value: (condition as QueryFilter[]).map(f => parseQueryFilter(f))
      });
      continue;
    }

    // Basit eşitlik: { name: "Ali" }
    if (condition === null || typeof condition !== 'object' || condition instanceof Date || condition instanceof RegExp) {
      conditions.push({ field, operator: '$eq', value: condition });
      continue;
    }

    // Operatörlü koşullar: { age: { $gte: 18 } }
    const ops = condition as QueryOperators;
    for (const [op, val] of Object.entries(ops)) {
      conditions.push({ field, operator: op, value: val });
    }
  }

  return conditions;
}

/**
 * MongoDB native filter formatına çevir
 */
export function toMongoFilter(conditions: ParsedCondition[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  for (const { field, operator, value } of conditions) {
    if (operator === '$or' || operator === '$and') {
      filter[operator] = (value as ParsedCondition[][]).map(conds => toMongoFilter(conds));
      continue;
    }

    if (operator === '$eq') {
      filter[field] = value;
    } else {
      if (!filter[field]) filter[field] = {};
      (filter[field] as Record<string, unknown>)[operator] = value;
    }
  }

  return filter;
}

/**
 * SQL WHERE clause'a çevir (parameterized)
 */
export function toSQLWhere(conditions: ParsedCondition[], paramPrefix = '$'): SQLQuery {
  const params: unknown[] = [];
  let paramIndex = 1;

  function getParamPlaceholder(): string {
    return `${paramPrefix}${paramIndex++}`;
  }

  function processConditions(conds: ParsedCondition[], logicalOp = 'AND'): string {
    const parts: string[] = [];

    for (const { field, operator, value } of conds) {
      if (operator === '$or') {
        const orClauses = (value as ParsedCondition[][])
          .map(c => processConditions(c, 'AND'))
          .filter(c => c);
        if (orClauses.length) {
          parts.push(`(${orClauses.join(' OR ')})`);
        }
        continue;
      }

      if (operator === '$and') {
        const andClauses = (value as ParsedCondition[][])
          .map(c => processConditions(c, 'AND'))
          .filter(c => c);
        if (andClauses.length) {
          parts.push(`(${andClauses.join(' AND ')})`);
        }
        continue;
      }

      const placeholder = getParamPlaceholder();
      
      switch (operator) {
        case '$eq':
          if (value === null) {
            parts.push(`${field} IS NULL`);
          } else {
            parts.push(`${field} = ${placeholder}`);
            params.push(value);
          }
          break;
        case '$ne':
          if (value === null) {
            parts.push(`${field} IS NOT NULL`);
          } else {
            parts.push(`${field} != ${placeholder}`);
            params.push(value);
          }
          break;
        case '$gt':
          parts.push(`${field} > ${placeholder}`);
          params.push(value);
          break;
        case '$gte':
          parts.push(`${field} >= ${placeholder}`);
          params.push(value);
          break;
        case '$lt':
          parts.push(`${field} < ${placeholder}`);
          params.push(value);
          break;
        case '$lte':
          parts.push(`${field} <= ${placeholder}`);
          params.push(value);
          break;
        case '$in':
          if (Array.isArray(value) && value.length > 0) {
            const placeholders = value.map(() => {
              const p = getParamPlaceholder();
              return p;
            });
            // Yeni placeholder'lar için params'a değerleri ekle
            params.pop(); // Önceki placeholder'ı kaldır
            paramIndex--; // Index'i geri al
            value.forEach(v => {
              params.push(v);
              paramIndex++;
            });
            parts.push(`${field} IN (${placeholders.join(', ')})`);
          }
          break;
        case '$nin':
          if (Array.isArray(value) && value.length > 0) {
            const placeholders = value.map(() => getParamPlaceholder());
            params.pop();
            paramIndex--;
            value.forEach(v => {
              params.push(v);
              paramIndex++;
            });
            parts.push(`${field} NOT IN (${placeholders.join(', ')})`);
          }
          break;
        case '$regex':
          parts.push(`${field} LIKE ${placeholder}`);
          // Regex'i LIKE pattern'e çevir
          const pattern = value instanceof RegExp ? value.source : String(value);
          params.push(`%${pattern}%`);
          break;
        case '$exists':
          parts.push(value ? `${field} IS NOT NULL` : `${field} IS NULL`);
          break;
      }
    }

    return parts.join(` ${logicalOp} `);
  }

  const where = processConditions(conditions);
  return { where: where || '1=1', params };
}

/**
 * MySQL için placeholder formatı
 */
export function toMySQLWhere(conditions: ParsedCondition[]): SQLQuery {
  const result = toSQLWhere(conditions, '?');
  // MySQL ? placeholder kullanır, index değil
  return {
    where: result.where.replace(/\?\d+/g, '?'),
    params: result.params
  };
}

/**
 * Update operatörlerini parse et
 */
export function parseUpdateFilter(update: UpdateFilter): {
  sets: Record<string, unknown>;
  increments: Record<string, number>;
  unsets: string[];
  pushes: Record<string, unknown>;
  pulls: Record<string, unknown>;
} {
  const result = {
    sets: {} as Record<string, unknown>,
    increments: {} as Record<string, number>,
    unsets: [] as string[],
    pushes: {} as Record<string, unknown>,
    pulls: {} as Record<string, unknown>
  };

  // $set, $inc gibi operatörler var mı kontrol et
  const hasOperators = Object.keys(update).some(k => k.startsWith('$'));

  if (!hasOperators) {
    // Operatör yoksa tüm alanları $set olarak kabul et
    result.sets = update as Record<string, unknown>;
    return result;
  }

  const ops = update as UpdateOperators;

  if (ops.$set) {
    Object.assign(result.sets, ops.$set);
  }

  if (ops.$inc) {
    result.increments = ops.$inc;
  }

  if (ops.$unset) {
    result.unsets = Object.keys(ops.$unset);
  }

  if (ops.$push) {
    result.pushes = ops.$push;
  }

  if (ops.$pull) {
    result.pulls = ops.$pull;
  }

  if (ops.$addToSet) {
    // addToSet'i push gibi işle (benzersizlik kontrolü adapter'da yapılacak)
    Object.assign(result.pushes, ops.$addToSet);
  }

  return result;
}

/**
 * SQL UPDATE statement oluştur
 */
export function toSQLUpdate(
  tableName: string,
  update: UpdateFilter,
  whereClause: string,
  whereParams: unknown[],
  paramPrefix = '$'
): { sql: string; params: unknown[] } {
  const parsed = parseUpdateFilter(update);
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = whereParams.length + 1;

  // $set
  for (const [key, value] of Object.entries(parsed.sets)) {
    setClauses.push(`${key} = ${paramPrefix}${paramIndex++}`);
    params.push(value);
  }

  // $inc
  for (const [key, amount] of Object.entries(parsed.increments)) {
    setClauses.push(`${key} = ${key} + ${paramPrefix}${paramIndex++}`);
    params.push(amount);
  }

  // $unset
  for (const key of parsed.unsets) {
    setClauses.push(`${key} = NULL`);
  }

  if (setClauses.length === 0) {
    throw new Error('No fields to update');
  }

  const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${whereClause}`;
  return { sql, params: [...whereParams, ...params] };
}
