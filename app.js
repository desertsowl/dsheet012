// 必要なモジュールと設定
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const expressLayouts = require('express-ejs-layouts');
const MongoStore = require('connect-mongo');

require('dotenv').config();
if (!process.env.SECRET_KEY) {
    console.error('SECRET_KEY is not defined in .env file');
    process.exit(1); // 環境変数がない場合はアプリを終了
}

const app = express();
const PORT = 5000;

// プロジェクトディレクトリ
const PROJECT_ROOT = path.join(__dirname);

// MongoDBに接続
mongoose.connect('mongodb://localhost/admin', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SECRET_KEY || 'default_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }, // 1時間の有効期限
    store: MongoStore.create({
        mongoUrl: 'mongodb://localhost/admin',
        collectionName: 'sessions' // セッション情報を保存するコレクション名
    })
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
    job: { db: 'job', collection: 'job' },
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

// コレクションが存在するかチェックする関数
const collectionExists = async (database, collectionName) => {
    try {
        const collections = await database.db.listCollections({ name: collectionName }).toArray();
        return collections.length > 0;
    } catch (err) {
        console.error('Error checking collection existence:', err);
        return false;
    }
};

// ミドルウェア: ユーザーの役割を設定
app.use((req, res, next) => {
    if (req.session.userId && req.session.userRole) {
        res.locals.userRole = req.session.userRole;
    } else {
        res.locals.userRole = 'guest';
    }
    next();
});

// ホームページをログインページにリダイレクト
app.get('/', (req, res) => {
    res.redirect('/login');
});

// DB作成
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

        await database.createCollection(config.collection);
        renderMessage(res, '成功', `コレクション "${config.collection}" を新規作成しました`);
    } catch (err) {
        console.error('Detailed error during collection creation:', err);
        renderMessage(res, 'エラー', `エラー: コレクションの構築に失敗しました。詳細: ${err.message}`);
    }
});

// DB削除確認ページ
app.get('/admin/:db/delete', (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです');
    }

    res.render('delete_confirm', {
        title: '削除確認',
        dbName: db
    });
});

// DB削除処理
app.post('/admin/:db/delete', async (req, res) => {
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

// DBコレクション一覧
app.get('/manager/:db/list', async (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないデータベースです', '/manager');
    }

    try {
        const database = mongoose.connection.useDb(config.db);
        const collections = await database.db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);

        res.render('list', { title: `${db}データベースのコレクション一覧`, collectionNames, db });
    } catch (err) {
        console.error('Error fetching collections:', err);
        renderMessage(res, 'エラー', `コレクション一覧の取得に失敗しました。詳細: ${err.message}`, '/manager');
    }
});

// DBドキュメント・ダンプ
app.get('/manager/:db/view/:collection', async (req, res) => {
    const { db, collection } = req.params;
    const config = getCollectionConfig(db);

    if (!config || config.collection !== collection) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです', `/manager/${db}/list`);
    }

    try {
        const database = mongoose.connection.useDb(config.db);
        const documents = await database.collection(collection).find().toArray();

        res.render('view', {
            title: `${collection}のドキュメント一覧`,
            documents,
            collectionName: collection,
            db // 追加: db変数を渡す
        });
    } catch (err) {
        console.error('Error fetching documents:', err);
        renderMessage(res, 'エラー', `ドキュメント一覧の取得に失敗しました。詳細: ${err.message}`, `/manager/${db}/list`);
    }
});

// DBドキュメント表形式
app.get('/manager/:db/:collection/read', async (req, res) => {
    const { db, collection } = req.params;
    const config = getCollectionConfig(db);

    if (!config || config.collection !== collection) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです', `/manager/${db}/list`);
    }

    try {
        const database = mongoose.connection.useDb(config.db);
        const documents = await database.collection(collection).find().toArray();

        res.render('read', {
            title: `${collection}のドキュメント一覧`,
            documents,
            collectionName: collection,
            db
        });
    } catch (err) {
        console.error('Error fetching documents:', err);
        renderMessage(res, 'エラー', `ドキュメント一覧の取得に失敗しました。詳細: ${err.message}`, `/manager/${db}/list`);
    }
});

// Jobモデルの定義（スキーマ名を変更）
const jobDb = mongoose.connection.useDb('job', { useCache: true });
const JobSchema = new mongoose.Schema({
    案件名: { type: String, required: true, unique: true },
    略称: { type: String, required: true, unique: true },
    スタッフ: { type: String, required: true },
    開始日: Date,
    終了日: Date,
    作成日: { type: Date, default: Date.now }
});
const Job = jobDb.model('Job', JobSchema, 'job');

// 案件情報ページ
app.get('/manager/job/:id/info', async (req, res) => {
    const { id } = req.params;
    try {
        const job = await Job.findById(id);
        res.render('info', { title: '案件情報', job });
    } catch (err) {
        console.error('Error fetching job info:', err);
        res.status(500).send('案件情報の取得に失敗しました');
    }
});

// 新規案件ページ
app.get('/manager/job/new', async (req, res) => {
    try {
        const database = mongoose.connection.useDb('staff');
        const collections = await database.db.listCollections().toArray();
        const staffCollections = collections.map(col => col.name);
        staffCollections.unshift('everyone');

        res.render('newjob', {
            title: '新規案件',
            staffCollections
        });
    } catch (err) {
        console.error('Error fetching staff collections:', err);
        res.status(500).send('スタッフ情報の取得に失敗しました');
    }
});

// 新規案件ページ(保存)
app.post('/manager/job/new', async (req, res) => {
    const { 案件名, 略称, スタッフ, 開始日, 終了日 } = req.body;

    if (!案件名 || !略称 || !スタッフ) {
        return res.status(400).send('必須項目が入力されていません');
    }

    try {
        const newJob = new Job({
            案件名,
            略称,
            スタッフ,
            開始日: 開始日 ? new Date(開始日) : null,
            終了日: 終了日 ? new Date(終了日) : null
        });
        await newJob.save();
        res.redirect('/manager/job/list');
    } catch (err) {
        console.error('Error saving job:', err);
        res.status(500).send('新規案件の保存に失敗しました');
    }
});

// 案件編集ページ
app.get('/manager/job/:id/edit', async (req, res) => {
    const { id } = req.params;
    try {
        const job = await Job.findById(id);
        const database = mongoose.connection.useDb('staff');
        const collections = await database.db.listCollections().toArray();
        const staffCollections = collections.map(col => col.name);
        staffCollections.unshift('everyone');

        res.render('edit', { title: '案件編集', job, staffCollections });
    } catch (err) {
        console.error('Error fetching job or staff collections:', err);
        res.status(500).send('案件情報の取得に失敗しました');
    }
});

// 案件編集ページ(保存)
app.post('/manager/job/:id/edit', async (req, res) => {
    const { id } = req.params;
    const { 案件名, 略称, スタッフ, 開始日, 終了日 } = req.body;

    try {
        await Job.findByIdAndUpdate(id, {
            案件名,
            略称,
            スタッフ,
            開始日: 開始日 ? new Date(開始日) : null,
            終了日: 終了日 ? new Date(終了日) : null
        });
        res.redirect('/manager');
    } catch (err) {
        console.error('Error updating job:', err);
        res.status(500).send('案件の更新に失敗しました');
    }
});

// ソースコード一覧
app.get('/admin/src', (req, res) => {
    function getDirectoryTree(dirPath) {
        const files = fs.readdirSync(dirPath);
        return files
            .filter(file => file !== '.git' && file !== 'node_modules') // 除外条件を追加
            .map(file => {
                const fullPath = path.join(dirPath, file);
                const isDirectory = fs.statSync(fullPath).isDirectory();
                return {
                    name: file,
                    path: fullPath.replace(PROJECT_ROOT, ''), // 相対パスに変換
                    isDirectory,
                    children: isDirectory ? getDirectoryTree(fullPath) : null
                };
            });
    }

    const tree = getDirectoryTree(PROJECT_ROOT);
    res.render('src', { title: 'ソースコード一覧', tree });
});

// ソースコードビューア
app.get('/admin/src/view', (req, res) => {
    const filePath = path.join(PROJECT_ROOT, req.query.file);
    if (!filePath.startsWith(PROJECT_ROOT)) {
        return res.status(400).send('無効なファイルパスです');
    }
    fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
            return res.status(500).send('ファイルの読み込みに失敗しました');
        }
        res.render('file', { title: req.query.file, content });
    });
});

// ログイン処理
app.get('/login', (req, res) => {
    res.render('login', { title: 'ログイン' });
});

// ログイン処理(POST)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Received username:', username);

    try {
        const user = await User.findOne({ username: username.toLowerCase() });
if (!user || !user.group) {
    console.error('User not found or group is missing');
    return res.status(400).send('ユーザー情報が不正です');
}
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).send('パスワードが間違っています');
        }

        // ログイン成功
        req.session.userId = user._id;
        req.session.userRole = user.group === 8 ? 'admin' : user.group === 4 ? 'manager' : user.group === 2 ? 'worker' : 'guest';

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
app.get('/manager', async (req, res) => {
    try {
        const jobs = await Job.find();
        res.render('manager', { title: '監督者ページ', jobs });
    } catch (err) {
        console.error('Error fetching jobs:', err);
        res.status(500).send('案件の取得に失敗しました');
    }
});

// 作業者ページ
app.get('/worker', (req, res) => {
    res.render('worker', { title: '作業者ページ' });
});

// システムステータスページ
app.get('/status/system', async (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? '接続中' : '未接続';
        const databases = ['job', 'device', 'kitting', 'staff', 'systemlog'];

        // 各データベースのコレクション一覧を取得
        const collectionInfo = {};
        for (const dbName of databases) {
            const db = mongoose.connection.useDb(dbName);
            const collections = await db.db.listCollections().toArray();
            collectionInfo[dbName] = collections.map(col => col.name);
        }

        const systemStatus = {
            serverTime: new Date(),
            dbStatus: dbStatus,
            dbName: mongoose.connection.name,
            collections: collectionInfo
        };

        res.render('status_system', {
            title: 'システムステータス',
            status: systemStatus
        });
    } catch (err) {
        console.error('Error fetching system status:', err);
        res.render('result', {
            title: 'エラー',
            message: `システムステータスの取得に失敗しました。詳細: ${err.message}`,
            backLink: '/admin'
        });
    }
});

// ログアウト処理
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

