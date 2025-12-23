// ============================================
// SDBC - ID Generator
// Cross-database compatible ID generation
// ============================================

/**
 * UUID v4 benzeri unique ID oluştur
 * MongoDB ObjectId formatı yerine tüm veritabanlarında çalışan format
 */
export function generateId(): string {
  // crypto.randomUUID varsa kullan (Node.js 19+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }

  // Fallback: Manuel UUID oluştur
  const hexChars = '0123456789abcdef';
  let id = '';
  
  for (let i = 0; i < 32; i++) {
    id += hexChars[Math.floor(Math.random() * 16)];
  }
  
  return id;
}

/**
 * Timestamp tabanlı sıralı ID oluştur (MongoDB ObjectId benzeri)
 */
export function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const machineId = Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0');
  const processId = Math.floor(Math.random() * 65536).toString(16).padStart(4, '0');
  const counter = Math.floor(Math.random() * 16777216).toString(16).padStart(6, '0');
  
  return timestamp + machineId + processId + counter;
}

/**
 * ID'nin geçerli formatta olup olmadığını kontrol et
 */
export function isValidId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  
  // 24 karakter hex (MongoDB ObjectId)
  if (/^[0-9a-f]{24}$/i.test(id)) return true;
  
  // 32 karakter hex (UUID without dashes)
  if (/^[0-9a-f]{32}$/i.test(id)) return true;
  
  // Standard UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
  
  return false;
}
