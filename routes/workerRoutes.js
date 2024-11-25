const express = require('express');
const { authorize } = require('../middleware/authorize');
const router = express.Router();

router.get('/', authorize([8, 4, 2]), (req, res) => {
    res.render('worker', { title: '作業者ページ' });
});

module.exports = router;
