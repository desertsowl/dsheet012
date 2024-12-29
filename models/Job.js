const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    案件名: { type: String, required: true, unique: true },
    スタッフ: { type: String, required: true },
    開始日: { type: Date },
    終了日: { type: Date },
    作成日: { type: Date, default: Date.now }
});

const jobDb = mongoose.connection.useDb('job');
module.exports = jobDb.model('Job', JobSchema, 'job');
