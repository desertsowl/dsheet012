const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    group: { type: Number, required: true },
    status: { type: Number, required: true },
    email: { type: String, unique: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    unique: { type: Number, unique: true }
}, {
    collection: 'everyone' // コレクション名を明示的に指定
});

// パスワードを保存前にハッシュ化する
userSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    this.updated_at = Date.now();
    next();
});

module.exports = mongoose.model('User', userSchema);

