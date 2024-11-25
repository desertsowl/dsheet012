const express = require('express');
const bcrypt = require('bcrypt');
const { User } = require('../models/User'); // Userモデルを正しくインポート
const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) {
            return res.render('result', {
                title: 'ログインエラー',
                message: 'ユーザーが存在しません。',
                backLink: '/login'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('result', {
                title: 'ログインエラー',
                message: 'パスワードが間違っています。',
                backLink: '/login'
            });
        }

        req.session.userId = user._id;
        const redirectUrl = user.group === 8 ? '/admin' : user.group === 4 ? '/manager' : '/worker';
        res.redirect(redirectUrl);
    } catch (err) {
        console.error('Error during login:', err);
        res.render('result', {
            title: 'エラー',
            message: 'ログイン処理中にエラーが発生しました。',
            backLink: '/login'
        });
    }
});

module.exports = router;
