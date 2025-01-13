const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Sheet = require('../models/sheet');  // パスが正しいことを確認

// ... 既存のルート ...

// 画像削除のルート
router.get('/sheet/:id_sheet/delete_image/:index', async (req, res) => {
    try {
        const docId = req.query.id;
        const imageIndex = parseInt(req.params.index);
        const doc = await Sheet.findById(docId);
        
        if (doc && doc.画像) {
            const imagePath = doc.画像[imageIndex];
            doc.画像.splice(imageIndex, 1);
            await doc.save();
            
            if (imagePath) {
                fs.unlink(path.join('public', imagePath), (err) => {
                    if (err) console.error('画像ファイルの削除に失敗しました:', err);
                });
            }
        }
        
        res.redirect(`/manager/sheet/${req.params.id_sheet}/edit?id=${docId}`);
    } catch (error) {
        console.error('画像の削除中にエラーが発生しました:', error);
        res.status(500).send('エラーが発生しました');
    }
});

module.exports = router; 