const express = require('express');
const { Job } = require('../models/Job'); // モデルをインポート
const { authorize } = require('../middleware/authorize');
const router = express.Router();

// 監督者ページ
router.get('/', authorize([8, 4]), async (req, res) => {
    try {
        const jobs = await Job.find(); // Jobモデルからデータを取得
        res.render('manager', { title: '監督者ページ', jobs });
    } catch (err) {
        console.error('Error fetching jobs:', err);
        res.status(500).render('result', {
            title: 'エラー',
            message: '案件の取得に失敗しました。',
            backLink: '/'
        });
    }
});

module.exports = router;
