const express = require('express');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const expressLayouts = require('express-ejs-layouts');
const User = require('./models/User');

const app = express();
const PORT = 5000;

// MongoDBに接続
mongoose.connect('mongodb://localhost/staff')
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true
}));

// express-ejs-layouts の設定
app.use(expressLayouts);
app.set('layout', 'layouts/base'); // レイアウトを指定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ルート設定
app.get('/', (req, res) => {
    res.render('login', { title: 'ログイン' });
});

app.get('/dashboard', (req, res) => {
    res.render('dashboard', { title: 'ダッシュボード' });
});

app.get('/admin', (req, res) => {
    res.render('admin', { title: '管理者ページ' });
});

app.get('/manager', (req, res) => {
    res.render('manager', { title: '監督者ページ' });
});

app.get('/worker', (req, res) => {
    res.render('worker', { title: '作業者ページ' });
});

// POST /login のルート
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Received username:', username); // デバッグ用ログ

    try {
        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) {
            console.log('User not found'); // デバッグ用ログ
            return res.status(400).send('ユーザーが見つかりません');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).send('パスワードが間違っています');
        }

        // ログイン成功
        req.session.userId = user._id;

        // 資格に基づいてリダイレクト
        if (user.group === 8) {
            res.redirect('/admin');
        } else if (user.group === 4) {
            res.redirect('/manager');
        } else if (user.group === 2) {
            res.redirect('/worker');
        } else {
            res.status(403).send('権限がありません');
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラー');
    }
});

// 管理者ページの新規作成リンクのルート
const allowedDatabases = ['job', 'device', 'kitting', 'staff', 'systemlog'];

app.get('/admin/:db/new', async (req, res) => {
    const dbName = req.params.db;

    if (!allowedDatabases.includes(dbName)) {
        return res.render('result', {
            title: 'エラー',
            message: 'エラー: 許可されていないデータベース名です',
            backLink: '/admin'
        });
    }

    try {
        const dbAdmin = mongoose.connection.db.admin();
        const existingDatabases = await dbAdmin.listDatabases();
        const databaseNames = existingDatabases.databases.map(db => db.name);

        if (databaseNames.includes(dbName)) {
            return res.render('result', {
                title: 'エラー',
                message: 'すでに同名のデータベースが存在するため、構築できませんでした',
                backLink: '/admin'
            });
        }

        await mongoose.connection.db.createCollection(dbName);
        res.render('result', {
            title: '成功',
            message: `データベース "${dbName}" の構築に成功しました`,
            backLink: '/admin'
        });
    } catch (err) {
        console.error(err);
        res.render('result', {
            title: 'エラー',
            message: 'エラー: データベースの作成に失敗しました',
            backLink: '/admin'
        });
    }
});

// 監督者ページの新規作成リンクのルート
app.get('/manager/job/new', (req, res) => {
    res.render('result', {
        title: '案件カード新規作成',
        message: '案件カード新規作成ページです。',
        backLink: '/manager'
    });
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});