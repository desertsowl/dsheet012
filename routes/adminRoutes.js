const express = require('express');
const { authorize } = require('../middleware/authorize');
const router = express.Router();

router.get('/', authorize([8]), (req, res) => {
    res.render('admin', { title: '管理者ページ' });
});

router.get('/status/system', authorize([8]), async (req, res) => {
    // システムステータスを取得するロジック
    res.render('status_system', { title: 'システムステータス' });
});

module.exports = router;
