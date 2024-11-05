const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const app = express();
const PORT = 5000;

// 使用するミドルウェア
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// express-ejs-layouts の設定
app.use(expressLayouts);
app.set('layout', 'layouts/main'); // デフォルトのレイアウトファイル
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ルート設定
app.get('/', (req, res) => {
    res.render('login', { title: 'Login' });
});

// サーバーの起動
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

