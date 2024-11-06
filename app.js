const express = require('express');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const expressLayouts = require('express-ejs-layouts');

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
app.set('layout', 'layouts/base');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// スタッフデータベースからUserモデルの作成
const staffDb = mongoose.connection.useDb('staff');
const UserSchema = new mongoose.Schema({
    username: String,
    password: String,
    group: Number,
    status: Number,
    email: String,
    created_at: Date,
    updated_at: Date,
    unique: Number
});
const User = staffDb.model('User', UserSchema, 'everyone');

// コレクションの設定
const collectionMapping = {
    job: { db: 'job', collection: 'default' },
    device: { db: 'device', collection: 'default' },
    kitting: { db: 'kitting', collection: 'default' },
    staff: { db: 'staff', collection: 'everyone' },
    systemlog: { db: 'systemlog', collection: 'default' }
};

// ヘルパー関数
const getCollectionConfig = (db) => collectionMapping[db];
const renderMessage = (res, title, message, backLink = '/admin') => {
    res.render('result', { title, message, backLink });
};

// コレクションが存在するかチェックする関数（タイムアウト設定を追加）
const collectionExists = async (database, collectionName) => {
    try {
        const collections = await database.db.listCollections({ name: collectionName }).toArray();
        return collections.length > 0;
    } catch (err) {
        console.error('Error checking collection existence:', err);
        return false;
    }
};

// ホームページをログインページにリダイレクト
app.get('/', (req, res) => {
    res.redirect('/login');
});

// 新規作成ルート
app.get('/admin/:db/new', async (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです');
    }

    try {
        const database = mongoose.connection.useDb(config.db);
        const collectionFound = await collectionExists(database, config.collection);

        if (collectionFound) {
            return renderMessage(res, '情報', `コレクション "${config.collection}" は既に存在します`);
        }

        // コレクションが存在しない場合、新規作成を実行
        await database.createCollection(config.collection);
        renderMessage(res, '成功', `コレクション "${config.collection}" を新規作成しました`);
    } catch (err) {
        console.error('Detailed error during collection creation:', err);
        renderMessage(res, 'エラー', `エラー: コレクションの構築に失敗しました。詳細: ${err.message}`);
    }
});

// 削除ルート
app.get('/admin/:db/delete', async (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです');
    }

    try {
        const database = mongoose.connection.useDb(config.db);
        const collectionFound = await collectionExists(database, config.collection);

        if (!collectionFound) {
            return renderMessage(res, '情報', `コレクション "${config.collection}" は存在しません`);
        }

        await database.dropCollection(config.collection);
        renderMessage(res, '成功', `コレクション "${config.collection}" の削除に成功しました`);
    } catch (err) {
        console.error('Detailed error during collection deletion:', err);
        renderMessage(res, 'エラー', `エラー: コレクションの削除に失敗しました。詳細: ${err.message}`);
    }
});

// ログインルート
app.get('/login', (req, res) => {
    res.render('login', { title: 'ログイン' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Received username:', username);

    try {
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user) {
            console.log('User not found');
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
        console.error('Detailed error during login:', err);
        res.status(500).send('サーバーエラー');
    }
});

// 管理者ページ
app.get('/admin', (req, res) => {
    res.render('admin', { title: '管理者ページ' });
});

// 監督者ページ
app.get('/manager', (req, res) => {
    res.render('manager', { title: '監督者ページ' });
});

// 作業者ページ
app.get('/worker', (req, res) => {
    res.render('worker', { title: '作業者ページ' });
});

// ログアウトルート
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('ログアウトに失敗しました');
        }
        res.redirect('/login');
    });
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
