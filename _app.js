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
mongoose.connect('mongodb://localhost/admin', { useNewUrlParser: true, useUnifiedTopology: true })
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

// データベースとコレクションのマッピング
const dbCollectionMapping = {
    job: 'default',
    device: 'default',
    kitting: 'default',
    staff: 'everyone',
    systemlog: 'default'
};

// 新規作成リンク
app.get('/admin/:db/new', async (req, res) => {
    const { db } = req.params;
    const collectionName = dbCollectionMapping[db];

    if (!collectionName) {
        return res.render('result', {
            title: 'エラー',
            message: 'エラー: 許可されていないデータベースです',
            backLink: '/admin'
        });
    }

    try {
        const database = mongoose.connection.useDb(db, { useCache: true });
        const existingCollections = await database.db.listCollections().toArray();

        if (!existingCollections.find(col => col.name === collectionName)) {
            await database.createCollection(collectionName);
            return res.render('result', {
                title: '成功',
                message: `データベース "${db}" にコレクション "${collectionName}" を構築しました`,
                backLink: '/admin'
            });
        } else {
            return res.render('result', {
                title: '情報',
                message: `データベース "${db}" にコレクション "${collectionName}" はすでに存在します`,
                backLink: '/admin'
            });
        }
    } catch (err) {
        console.error('Detailed error:', err);
        return res.render('result', {
            title: 'エラー',
            message: `エラー: データベースの構築に失敗しました。詳細: ${err.message}`,
            backLink: '/admin'
        });
    }
});

// 削除リンク
app.get('/admin/:db/delete', async (req, res) => {
    const { db } = req.params;

    if (!dbCollectionMapping.hasOwnProperty(db)) {
        return res.render('result', {
            title: 'エラー',
            message: 'エラー: 許可されていないデータベースです',
            backLink: '/admin'
        });
    }

    try {
        const database = mongoose.connection.useDb(db, { useCache: true });
        const existingCollections = await database.db.listCollections().toArray();

        if (existingCollections.length > 0) {
            return res.render('result', {
                title: 'エラー',
                message: `エラー: データベース "${db}" にはコレクションが存在するため削除できません`,
                backLink: '/admin'
            });
        }

        // 空のデータベースを削除
        await database.db.dropDatabase();
        return res.render('result', {
            title: '成功',
            message: `データベース "${db}" の削除に成功しました`,
            backLink: '/admin'
        });
    } catch (err) {
        console.error('Detailed error:', err);
        return res.render('result', {
            title: 'エラー',
            message: `エラー: データベースの削除に失敗しました。詳細: ${err.message}`,
            backLink: '/admin'
        });
    }
});

// POST /login のルート
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Received username:', username); // デバッグ用ログ

    try {
        const user = await User.findOne({ username: username.toLowerCase() });
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
        console.error('Detailed error:', err);
        res.status(500).send('サーバーエラー');
    }
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
