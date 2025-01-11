const mongoose = require('mongoose');

const SheetSchema = new mongoose.Schema({
    項番: { type: Number, required: true, unique: true },
    項目: { type: String, required: true },
    内容: { type: String, required: true },
    詳細: { type: String, required: true },
    画像: { type: [String], default: [] }, // 画像フィールドを配列に変更
});

module.exports = (dbName, collectionName) => {
    const db = mongoose.connection.useDb(dbName);
    return db.model(collectionName, SheetSchema, collectionName);
};

