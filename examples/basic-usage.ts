// ============================================
// SDBC - Usage Examples
// ============================================

import { Schema, model, connect, disconnect } from 'sdbc';

// 1. Veritabanına bağlan
// ----------------------

// MongoDB
await connect({
  provider: 'mongodb',
  uri: 'mongodb://localhost:27017/myapp',
  options: {
    maxPoolSize: 10
  }
});

// PostgreSQL
// await connect({
//   provider: 'postgres',
//   uri: 'postgres://user:pass@localhost:5432/myapp'
// });

// MySQL
// await connect({
//   provider: 'mysql',
//   uri: 'mysql://user:pass@localhost:3306/myapp'
// });

// SQLite
// await connect({
//   provider: 'sqlite',
//   uri: 'sqlite:./database.db'
// });


// 2. Schema tanımla
// -----------------

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  age: { type: Number, default: 18 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  profile: { type: Object },  // JSON/Object field
  tags: { type: Array }       // Array field
}, {
  timestamps: true  // createdAt ve updatedAt otomatik eklenir
});

// Pre-save hook
UserSchema.pre('save', function() {
  console.log('Saving user:', this.name);
});

// Instance method
UserSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

// Virtual field
UserSchema.virtual('displayName').get(function() {
  return `${this.name} (${this.email})`;
});


// 3. Model oluştur
// ----------------

const User = model('User', UserSchema);


// 4. CRUD İşlemleri
// -----------------

// CREATE
const user = await User.create({
  name: 'Ali',
  email: 'ali@example.com',
  age: 25
});
console.log('Created:', user);

// Çoklu insert
const users = await User.create([
  { name: 'Veli', email: 'veli@example.com' },
  { name: 'Ayşe', email: 'ayse@example.com' }
]);


// READ
// Tüm kullanıcıları bul
const allUsers = await User.find();

// Filtreleme
const adults = await User.find({ age: { $gte: 18 } });

// Tek kullanıcı bul
const foundUser = await User.findOne({ email: 'ali@example.com' });

// ID ile bul
const userById = await User.findById(user._id);

// Zincirleme sorgu
const sortedUsers = await User.find({ age: { $gte: 18 } })
  .sort({ name: 1 })
  .limit(10)
  .skip(0)
  .select('name email age');

// Sayım
const count = await User.countDocuments({ role: 'user' });

// Var mı kontrolü
const exists = await User.exists({ email: 'ali@example.com' });


// UPDATE
// Tek kayıt güncelle
await User.updateOne(
  { email: 'ali@example.com' },
  { $set: { age: 26 } }
);

// Çoklu güncelleme
await User.updateMany(
  { role: 'user' },
  { $set: { verified: true } }
);

// Bul ve güncelle (güncellenmiş kaydı döndür)
const updated = await User.findOneAndUpdate(
  { email: 'ali@example.com' },
  { $inc: { age: 1 } },  // Yaşı 1 artır
  { new: true }          // Güncellenmiş kaydı döndür
);

// ID ile bul ve güncelle
await User.findByIdAndUpdate(user._id, { name: 'Ali Yılmaz' });


// DELETE
// Tek kayıt sil
await User.deleteOne({ email: 'test@example.com' });

// Çoklu silme
await User.deleteMany({ role: 'guest' });

// Bul ve sil
const deleted = await User.findOneAndDelete({ email: 'old@example.com' });


// 5. Document Methods
// -------------------

const doc = await User.findOne({ email: 'ali@example.com' });
if (doc) {
  // Instance method kullan
  console.log('Is admin?', doc.isAdmin());
  
  // Dokümanı güncelle ve kaydet
  doc.age = 27;
  await doc.save();
  
  // JSON'a çevir
  const json = doc.toJSON();
  console.log(json);
}


// 6. Query Operators
// ------------------

// Karşılaştırma
await User.find({ age: { $gt: 18 } });      // Büyük
await User.find({ age: { $gte: 18 } });     // Büyük eşit
await User.find({ age: { $lt: 65 } });      // Küçük
await User.find({ age: { $lte: 65 } });     // Küçük eşit
await User.find({ age: { $ne: 18 } });      // Eşit değil

// Array operatörleri
await User.find({ role: { $in: ['admin', 'moderator'] } });
await User.find({ role: { $nin: ['banned', 'deleted'] } });

// Regex
await User.find({ name: { $regex: 'ali' } });

// Logical
await User.find({
  $or: [
    { role: 'admin' },
    { age: { $gte: 21 } }
  ]
});


// 7. Bağlantıyı kapat
// -------------------

await disconnect();
