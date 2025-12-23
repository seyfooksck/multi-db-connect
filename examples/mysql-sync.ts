// ============================================
// SDBC - MySQL Sync Example
// Otomatik tablo oluşturma ve güncelleme
// ============================================

import { Schema, model, connect, disconnect, syncAll } from 'sdbc';

async function main() {
  // ===========================================
  // 1. MySQL'e bağlan (sync aktif)
  // ===========================================
  
  await connect({
    provider: 'mysql',
    uri: 'mysql://root:password@localhost:3306/testdb',
    
    // Otomatik sync aktif
    sync: true,
    syncOptions: {
      alter: true  // Yeni alanları otomatik ekle
    }
  });

  console.log('✅ MySQL bağlantısı kuruldu');

  // ===========================================
  // 2. Schema tanımla
  // ===========================================
  
  const UserSchema = new Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true },
    age: { type: Number, default: 18 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    metadata: { type: Object },  // JSON alanı
    createdAt: { type: Date }
  }, {
    timestamps: true,
    collection: 'users'  // Tablo adı
  });

  // ===========================================
  // 3. Model oluştur
  // ===========================================
  
  const User = model('User', UserSchema);

  // ===========================================
  // 4. Manuel sync (opsiyonel)
  // ===========================================
  
  // Tek bir modeli sync et
  const syncResult = await User.sync({ alter: true });
  console.log('📋 Sync sonucu:', syncResult);
  // { created: true, altered: false, changes: ["Table 'users' created"] }

  // VEYA tüm modelleri sync et
  // const allResults = await syncAll({ alter: true });

  // ===========================================
  // 5. CRUD işlemleri (tablo otomatik oluşur)
  // ===========================================
  
  // Yeni kullanıcı ekle
  const user = await User.create({
    name: 'Ali Yılmaz',
    email: 'ali@example.com',
    age: 25,
    role: 'admin'
  });
  console.log('✅ Kullanıcı oluşturuldu:', user);

  // Kullanıcıları listele
  const users = await User.find({ isActive: true });
  console.log('👥 Aktif kullanıcılar:', users);

  // ===========================================
  // 6. Schema'ya yeni alan ekle
  // ===========================================
  
  // Schema'yı güncelle (yeni alan ekle)
  const UpdatedUserSchema = new Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true },
    age: { type: Number, default: 18 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    metadata: { type: Object },
    createdAt: { type: Date },
    // YENİ ALANLAR
    phone: { type: String },           // Yeni!
    address: { type: String },         // Yeni!
    lastLogin: { type: Date }          // Yeni!
  }, {
    timestamps: true,
    collection: 'users'
  });

  // Yeni model oluştur ve sync et
  const UpdatedUser = model('UpdatedUser', UpdatedUserSchema);
  
  // Alter mode ile sync - sadece yeni alanları ekler
  const alterResult = await UpdatedUser.sync({ alter: true });
  console.log('📋 Alter sonucu:', alterResult);
  // { created: false, altered: true, changes: ["Added column 'phone'", "Added column 'address'", "Added column 'lastLogin'"] }

  // ===========================================
  // 7. Force sync (DİKKAT: Veri kaybı!)
  // ===========================================
  
  // Tabloyu tamamen sil ve yeniden oluştur
  // const forceResult = await User.sync({ force: true });
  // console.log('⚠️ Force sync sonucu:', forceResult);
  // UYARI: Tüm veriler silinir!

  // ===========================================
  // 8. Bağlantıyı kapat
  // ===========================================
  
  await disconnect();
  console.log('🔌 Bağlantı kapatıldı');
}

// ===========================================
// Farklı veritabanları için örnekler
// ===========================================

async function postgresExample() {
  await connect({
    provider: 'postgres',
    uri: 'postgres://user:pass@localhost:5432/testdb',
    sync: true,
    syncOptions: { alter: true }
  });
  
  // ... model tanımla ve kullan
}

async function sqliteExample() {
  await connect({
    provider: 'sqlite',
    uri: 'sqlite:./database.db',
    sync: true,
    syncOptions: { alter: true }
  });
  
  // ... model tanımla ve kullan
}

async function mongoExample() {
  await connect({
    provider: 'mongodb',
    uri: 'mongodb://localhost:27017/testdb',
    // MongoDB schema-less olduğu için sync gerekmez
    // ama collection ve index'ler oluşturulur
  });
  
  // ... model tanımla ve kullan
}

// Çalıştır
main().catch(console.error);
