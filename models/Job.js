// models/Jobs.js
const mongoose = require('mongoose');

// Jobデータベース接続
const jobDb = mongoose.connection.useDb('job', { useCache: true });

// Jobスキーマ定義
const JobSchema = new mongoose.Schema({
    案件名: { type: String, required: true, unique: true },
    略称: { type: String, required: true, unique: true },
    スタッフ: { type: String, required: true },
    開始日: { type: Date },
    終了日: { type: Date },
    作成日: { type: Date, default: Date.now }
});

// Jobモデルをエクスポート
module.exports = jobDb.model('Job', JobSchema, 'job');
