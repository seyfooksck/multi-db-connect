# SDBC (Multi-DB Connect)

> **Mongoose tarzı tek API ile birden fazla veritabanı kullanın.**

**SDBC**, Mongoose'un `Schema`, `model` ve `connect` kullanım şeklini koruyarak  
aynı model tanımıyla **MongoDB, PostgreSQL, MySQL ve SQLite** gibi farklı veritabanlarını  
kullanmanızı sağlar.

Veritabanı seçimi **yalnızca bağlantı aşamasında** yapılır.

---

## ✨ Özellikler

- ✅ Mongoose ile birebir uyumlu Schema & Model API
- 🔌 Tek `connect()` ile veritabanı seçimi
- 🧩 MongoDB, PostgreSQL, MySQL, SQLite desteği
- 🔁 Adapter Pattern mimarisi
- 🧠 Mongoose query syntax (`$gt`, `$in`, `$regex`...)
- ⏱ `timestamps`, `default`, `required`, `unique`
- 🪝 `pre / post` hooks (Mongo native, SQL emülasyon)
- 🔒 Veritabanına özel bağlantı opsiyonları
- 🔄 **Otomatik tablo senkronizasyonu** (Auto Sync)
- 📦 TypeScript desteği

---

## 🚀 Kurulum

```bash
npm install sdbc
```

---

## 🔌 Veritabanına Bağlanma

### MongoDB

```ts
import { connect } from "sdbc";

await connect({
  provider: "mongodb",
  uri: "mongodb://localhost:27017/app",
  options: {
    maxPoolSize: 10
  }
});
```

### PostgreSQL

```ts
await connect({
  provider: "postgres",
  uri: "postgres://user:pass@localhost:5432/app",
  options: {
    ssl: true
  }
});
```

### MySQL (Otomatik Sync ile)

```ts
await connect({
  provider: "mysql",
  uri: "mysql://user:pass@localhost:3306/app",
  // Otomatik tablo oluşturma
  sync: true,
  syncOptions: {
    alter: true  // Yeni alanları otomatik ekle
  }
});
```

### SQLite

```ts
await connect({
  provider: "sqlite",
  uri: "sqlite:./database.db"
});
```

> `options` alanı doğrudan ilgili veritabanı driver'ına iletilir.

---

## 🧱 Schema Tanımlama (Mongoose Gibi)

```ts
import { Schema, model } from "sdbc";

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  age: { type: Number, default: 18 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  metadata: { type: Object }  // JSON alanı
}, {
  timestamps: true,
  collection: 'users'  // Tablo/Collection adı
});

const User = model('User', UserSchema);
```

---

## 🔄 Otomatik Tablo Senkronizasyonu (Auto Sync)

SDBC, schema değişikliklerini otomatik olarak veritabanına yansıtabilir:

### Connect sırasında

```ts
await connect({
  provider: "mysql",
  uri: "mysql://user:pass@localhost:3306/app",
  sync: true,
  syncOptions: {
    alter: true  // Yeni alanları ekle, eskilerini koru
  }
});
```

### Manuel sync

```ts
// Tek bir modeli sync et
const result = await User.sync({ alter: true });
console.log(result);
// { created: true, altered: false, changes: ["Table 'users' created"] }

// Tüm modelleri sync et
import { syncAll } from 'sdbc';
const allResults = await syncAll({ alter: true });
```

### Sync Seçenekleri

| Seçenek | Açıklama |
|---------|----------|
| `alter: true` | Yeni alanları ekler, mevcut verileri korur |
| `force: true` | Tabloyu siler ve yeniden oluşturur (**DİKKAT: Veri kaybı!**) |

---

## 🧠 Hooks ve Methods

```ts
UserSchema.pre("save", function () {
  console.log("Saving user...");
});

UserSchema.post("save", function () {
  console.log("User saved!");
});

UserSchema.methods.isAdult = function () {
  return this.age >= 18;
};
```

---

## 📝 Model ve CRUD İşlemleri

```ts
const User = model('User', UserSchema);

// Create
const user = await User.create({
  name: 'Ali Yılmaz',
  email: 'ali@example.com'
});

// Read
const users = await User.find({ age: { $gte: 18 } });
const user = await User.findById('123');
const admin = await User.findOne({ role: 'admin' });

// Update
await User.updateOne({ _id: '123' }, { $set: { name: 'Yeni İsim' } });
await User.updateMany({ role: 'user' }, { $set: { isActive: true } });

// Delete
await User.deleteOne({ _id: '123' });
await User.deleteMany({ isActive: false });

// Count
const count = await User.countDocuments({ role: 'admin' });
```

---

## 🔍 Query Operatörleri

SDBC, Mongoose query syntax'ını destekler:

| Operatör | Açıklama | Örnek |
|----------|----------|-------|
| `$eq` | Eşit | `{ age: { $eq: 25 } }` |
| `$ne` | Eşit değil | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Büyük | `{ age: { $gt: 18 } }` |
| `$gte` | Büyük veya eşit | `{ age: { $gte: 18 } }` |
| `$lt` | Küçük | `{ price: { $lt: 100 } }` |
| `$lte` | Küçük veya eşit | `{ price: { $lte: 100 } }` |
| `$in` | İçinde | `{ role: { $in: ['admin', 'mod'] } }` |
| `$nin` | İçinde değil | `{ status: { $nin: ['banned'] } }` |
| `$regex` | Regex eşleşme | `{ name: { $regex: /^Ali/i } }` |
| `$or` | VEYA | `{ $or: [{ age: 18 }, { role: 'admin' }] }` |
| `$and` | VE | `{ $and: [{ age: { $gte: 18 } }, { isActive: true }] }` |

---

## 📊 Tip Dönüşümleri

| JavaScript Tipi | SQL Tipi |
|-----------------|----------|
| `String` | `VARCHAR(255)` |
| `Number` | `INT` |
| `Boolean` | `BOOLEAN` |
| `Date` | `DATETIME` |
| `Object` | `JSON` |
| `Array` | `JSON` |
| `ObjectId` | `VARCHAR(255)` |

---

## 🛠 Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# Testleri çalıştır
npm test

# Build
npm run build
```

---

## 📦 Peer Dependencies

Kullandığınız veritabanına göre ilgili driver'ı yükleyin:

```bash
# MongoDB
npm install mongodb

# PostgreSQL
npm install pg

# MySQL
npm install mysql2

# SQLite
npm install better-sqlite3
```

---

## 📁 Proje Yapısı

```
sdbc/
├── src/
│   ├── index.ts           # Ana export dosyası
│   ├── Schema.ts          # Schema sınıfı
│   ├── Model.ts           # Model factory
│   ├── connection.ts      # Bağlantı yöneticisi
│   ├── sync.ts            # Schema sync manager
│   ├── types/             # TypeScript tipleri
│   ├── adapters/          # Veritabanı adaptörleri
│   │   ├── base.ts        # Base adapter
│   │   ├── mongodb.ts     # MongoDB adapter
│   │   ├── postgres.ts    # PostgreSQL adapter
│   │   ├── mysql.ts       # MySQL adapter
│   │   └── sqlite.ts      # SQLite adapter
│   └── utils/             # Yardımcı fonksiyonlar
│       ├── query-parser.ts
│       └── id-generator.ts
├── tests/                 # Test dosyaları
├── examples/              # Örnek kullanımlar
└── dist/                  # Build çıktısı
```

---

## 📄 Lisans

MIT

---

## 🗺 Yol Haritası

- [ ] Migration sistemi
- [ ] Transaction API
- [ ] Populate (ilişkili veriler)
- [ ] CLI aracı
- [ ] Connection pooling optimizasyonları
