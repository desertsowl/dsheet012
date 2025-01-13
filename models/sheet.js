const mongoose = require('mongoose');

const sheetSchema = new mongoose.Schema({
    画像: {
        type: [String],
        default: []
    },
    // ... 他のフィールド ...
});

module.exports = mongoose.model('Sheet', sheetSchema); 