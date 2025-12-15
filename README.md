Tabii 👍
Aşağıda **tek parça**, **kopyala–yapıştır hazır**, **tam bir `README.md` dosyası** var.
Başka hiçbir şeye bölünmemiştir.

---

````md
# Universal Mongoose

> **Mongoose tarzı tek API ile birden fazla veritabanı kullanın.**

**Universal Mongoose**, Mongoose’un `Schema`, `model` ve `connect` kullanım şeklini koruyarak  
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
- 📦 TypeScript desteği

---

## 🚀 Kurulum

```bash
npm install universal-mongoose
````

---

## 🔌 Veritabanına Bağlanma

### MongoDB

```ts
import { connect } from "universal-mongoose";

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

> `options` alanı doğrudan ilgili veritabanı driver’ına iletilir.

---

## 🧱 Schema Tanımlama (Mongoose Gibi)

```ts
import { Schema, model } from "universal-mongoose";

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  age: { type: Number, default: 18 }
}, {
  timestamps: true
});
```

---

## 🧠 Hooks ve Methods

```ts
UserSchema.pre("save", function () {
  console.log("Saving user...");
});

UserSchema.methods.isAdult = function () {
  return this.age >= 18;
};
```

---

## 📦 Model Oluşturma

```ts
const User = model("User", UserSchema);
```

---

## 🔄 CRUD İşlemleri

```ts
await User.create({
  name: "Ali",
  email: "ali@test.com"
});

const users = await User.find({
  age: { $gte: 18 }
});

const user = await User.findOne({
  email: "ali@test.com"
});
```

---

## 🔍 Query Syntax

Desteklenen temel operatörler:

| Operator | Açıklama     |
| -------- | ------------ |
| `$eq`    | Eşit         |
| `$ne`    | Eşit değil   |
| `$gt`    | Büyük        |
| `$gte`   | Büyük eşit   |
| `$lt`    | Küçük        |
| `$lte`   | Küçük eşit   |
| `$in`    | İçinde       |
| `$nin`   | İçinde değil |
| `$regex` | Metin arama  |

```ts
User.find({
  age: { $gte: 18 },
  name: { $regex: "ali" }
});
```

---

## 🔗 İlişkiler (Relations)

```ts
const PostSchema = new Schema({
  title: String,
  userId: { type: Schema.Types.ObjectId, ref: "User" }
});
```

* MongoDB → `ObjectId ref`
* SQL → `FOREIGN KEY`

---

## ⚠️ Desteklenmeyen / Sınırlı Özellikler

Tüm veritabanları aynı yeteneklere sahip değildir.

Aşağıdaki Mongoose özellikleri **sınırlı veya desteklenmez**:

* `aggregate()`
* `mapReduce()`
* `change streams`
* Gelişmiş `populate()` senaryoları

Destek durumu kullanılan veritabanına göre değişir.

---

## 🧠 Capability Sistemi

```ts
db.capabilities
```

Örnek:

```ts
{
  joins: true,
  json: true,
  transactions: true,
  aggregation: false
}
```

---

## 🏗 Mimari

```
Schema (Mongoose API)
      ↓
Model Factory
      ↓
Query Parser
      ↓
Adapter Layer
      ↓
Native Driver
```

---

## 🧪 Desteklenen Veritabanları

| Veritabanı      | Durum          |
| --------------- | -------------- |
| MongoDB         | ✅ Tam destek   |
| PostgreSQL      | ✅ Tam destek   |
| MySQL / MariaDB | ✅ Tam destek   |
| SQLite          | ✅ Temel destek |
| MSSQL           | 🔜 Planlanıyor |

---

## 🛣 Yol Haritası

* [ ] Migration sistemi
* [ ] Gelişmiş populate
* [ ] Transaction API
* [ ] Plugin sistemi
* [ ] GraphQL / REST otomatik üretim
* [ ] CLI aracı

---

## 🤝 Katkı

Pull request’ler ve öneriler memnuniyetle karşılanır.

```bash
git clone https://github.com/yourname/universal-mongoose
cd universal-mongoose
npm install
npm run dev
```

---

## 📄 Lisans

MIT License

```

---

İstersen bir sonraki adımda:
- 📁 **proje klasör yapısını**
- 🧠 **design decisions (neden böyle?)**
- 🔌 **örnek Mongo + Postgres adapter kodlarını**
- 📦 **npm publish öncesi son düzenlemeleri**

hazırlayabilirim.
```
