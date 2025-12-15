# Universal Mongoose

> **Mongoose benzeri tek API ile birden fazla veritabanı kullanın.**

**Universal Mongoose**, Mongoose tarzı `Schema`, `model` ve `connect` API’sini koruyarak  
aynı model tanımıyla **MongoDB, PostgreSQL, MySQL, SQLite** gibi farklı veritabanlarını  
kullanabilmenizi sağlar.

Veritabanı seçimi **sadece bağlantı aşamasında** yapılır.

---

## ✨ Özellikler

- ✅ Mongoose ile birebir uyumlu **Schema & Model API**
- 🔌 Tek `connect()` ile veritabanı seçimi
- 🧩 MongoDB, PostgreSQL, MySQL, SQLite desteği
- 🔁 Adapter Pattern mimarisi
- 🧠 Mongoose query syntax (`$gt`, `$in`, `$regex`...)
- ⏱ `timestamps`, `default`, `required`, `unique`
- 🪝 `pre / post` hooks (Mongo native, SQL emülasyon)
- 🔒 DB’ye özel bağlantı opsiyonları
- 📦 TypeScript destekli

---

## 🚀 Kurulum

```bash
npm install universal-mongoose
