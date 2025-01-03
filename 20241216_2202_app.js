//===================================
// チェックシート管理アプリ dSheet
// サーバースクリプト app.js
//===================================

//───────────────────────────────────
// 1. 基本設定と初期化
// モジュール導入、環境変数・基本情報の設定
//───────────────────────────────────

const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser'); // Cookieパーサーを追加
const crypto = require('crypto'); // セッションID生成用
const multer = require('multer');
const csvParser = require('csv-parser');

require('dotenv').config();
if (!process.env.SECRET_KEY) {
    console.error('SECRET_KEY is not defined in .env file');
    process.exit(1); // 環境変数がない場合はアプリを終了
}
// ファイルアップロード設定
const upload = multer({ dest: 'csv/' });

const app = express();
const PORT = 5000;
const PROJECT_ROOT = path.join(__dirname);

const Job = require('./models/Job');
const SheetModel = require('./models/Sheet');

//───────────────────────────────────
// 2. データベース設定
// DB接続、DB関連の関数やモデルの定義
//───────────────────────────────────

// データベース接続
//───────────────────────────────────
mongoose.connect('mongodb://localhost/admin')
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));


// スタッフデータベースからUserモデルの作成
//───────────────────────────────────
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

//───────────────────────────────────
// 3. ミドルウェア設定
// HTTPリクエストを処理するためのミドルウェア
// 静的ファイルやテンプレートエンジンの設定
//───────────────────────────────────

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(expressLayouts);
app.set('layout', 'layouts/base');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cookieParser());


//───────────────────────────────────
// 4. セッション管理
// セッションの生成、検証、削除に関する関数
// ミドルウェアでセッション状態を管理
//───────────────────────────────────

// セッションデータ（簡易実装: メモリ内に保持）
const sessions = {};

// セッション有効期限（例: 1時間）
const SESSION_EXPIRY = 3600000;

// ヘルパー関数: セッションを生成
//───────────────────────────────────
function createSession(userId) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    sessions[sessionId] = {
        userId,
        createdAt: Date.now()
    };
    return sessionId;
}

// ヘルパー関数: セッションを検証
//───────────────────────────────────
function validateSession(sessionId) {
    const session = sessions[sessionId];
    if (!session) return false;

    // セッションが期限切れの場合、削除
    if (Date.now() - session.createdAt > SESSION_EXPIRY) {
        delete sessions[sessionId];
        return false;
    }

    // 有効なセッション
    return session.userId;
}

// ミドルウェア: 認証チェック
//───────────────────────────────────
app.use((req, res, next) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId && validateSession(sessionId)) {
        req.userId = sessions[sessionId].userId; // セッションが有効ならユーザーIDを設定
    } else {
        req.userId = null; // セッションが無効ならユーザーIDをnull
    }
    next();
});

// ユーザーIDをテンプレートに渡す
//───────────────────────────────────
app.use(async (req, res, next) => {
    if (req.userId) {
        try {
            const user = await User.findById(req.userId); // 現在のユーザーを取得
            if (user) {
                res.locals.user = user; // テンプレートに渡す
            } else {
                res.locals.user = null;
            }
        } catch (err) {
            console.error('Error fetching user:', err);
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});

// アクセス制御ミドルウェア
//───────────────────────────────────
function authorize(allowedGroups) {
    return async (req, res, next) => {
        if (!req.userId) {
            return res.status(401).render('result', {
                title: 'アクセス拒否',
                message: 'ログインが必要です。',
                backLink: '/login'
            });
        }

        try {
            // ユーザー情報を取得
            const user = await User.findById(req.userId);
            if (!user) {
                return res.status(403).render('result', {
                    title: 'アクセス拒否',
                    message: 'ユーザー情報を確認できません。',
                    backLink: '/login'
                });
            }

            if (!allowedGroups.includes(user.group)) {
                return res.status(403).render('result', {
                    title: 'アクセス拒否',
                    message: 'このページにアクセスする権限がありません。',
                    backLink: '/'
                });
            }

            next();
        } catch (err) {
            console.error('Error during authorization:', err);
            res.status(500).render('result', {
                title: 'エラー',
                message: '認証処理中にエラーが発生しました。',
                backLink: '/'
            });
        }
    };
}

// コレクションの設定
//───────────────────────────────────
const collectionMapping = {
    job: { db: 'job', collection: 'job' },
    device: { db: 'device', collection: 'default' },
    kitting: { db: 'kitting', collection: 'default' },
    staff: { db: 'staff', collection: 'everyone' },
	systemlog: { db: 'systemlog', collection: 'default' },
	sheet: { db: 'sheet', collection: 'default' }
};

// ヘルパー関数
//───────────────────────────────────
const getCollectionConfig = (db) => collectionMapping[db];
const renderMessage = (res, title, message, backLink = '/admin') => {
    res.render('result', { title, message, backLink });
};

// コレクションが存在するかチェックする関数
//───────────────────────────────────
const collectionExists = async (database, collectionName) => {
    try {
        const collections = await database.db.listCollections({ name: collectionName }).toArray();
        return collections.length > 0;
    } catch (err) {
        console.error('Error checking collection existence:', err);
        return false;
    }
};

// 機器データ登録ページ
app.get('/manager/device/:dbName_device/device_import', (req, res) => {
    const { dbName_device } = req.params;

    // 略称の検証
    if (!/^[a-zA-Z0-9_]+$/.test(dbName_device)) {
        return res.render('result', {
            title: 'エラー',
            message: '略称が無効です。英数字とアンダースコアのみ使用できます。',
            backLink: `/manager/info/${dbName_device}`
        });
    }

    res.render('device_import', {
        title: '機器データ登録',
        dbName_device
    });
});

// ファイルアップロード処理
app.post('/manager/device/:dbName_device/device_import', upload.single('csvfile'), async (req, res) => {
    const { dbName_device } = req.params;
    const filePath = req.file.path;

    // 略称の検証
    if (!/^[a-zA-Z0-9_]+$/.test(dbName_device)) {
        fs.unlinkSync(filePath); // 不正な略称の場合はアップロードファイルを削除
        return res.render('result', {
            title: 'エラー',
            message: '略称が無効です。英数字とアンダースコアのみ使用できます。',
            backLink: `/manager/info/${dbName_device}`
        });
    }

    const dbName = 'device'; // 固定データベース
	const collectionName = dbName_device;

    try {
        const database = mongoose.connection.useDb(dbName);
        const devicesCollection = database.collection(collectionName);

        // CSVファイルをパースしてデータを登録
        let records = [];
        let isHeader = true;
        let fieldNames = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (isHeader) {
                        fieldNames = Object.keys(row); // 最初の行をフィールド名として保存
                        isHeader = false;
                    }
                    records.push(row);
                })
                .on('end', async () => {
                    try {
                        // コレクションにデータを挿入
                        const result = await devicesCollection.insertMany(records);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                })
                .on('error', (err) => {
                    reject(err);
                });
        });

        // アップロード完了後に一時ファイルを削除
        fs.unlinkSync(filePath);

        // 登録完了ページを表示
        res.render('result', {
            title: '登録完了',
            message: `${records.length}件のデータを登録しました。`,
            backLink: `/manager/info/${dbName_device}`
        });
    } catch (err) {
        console.error('Error during CSV import:', err);
        fs.unlinkSync(filePath); // エラーが発生した場合も一時ファイルを削除
        res.render('result', {
            title: 'エラー',
            message: `データ登録中にエラーが発生しました。詳細: ${err.message}`,
            backLink: `/manager/info/${dbName_device}`
        });
    }
});

// 機器コレクション読出
//───────────────────────────────────
app.get('/manager/device/:dbName_device/read', async (req, res) => {
    const { dbName_device } = req.params;
    const dbName = 'device'; // 固定データベース名
    const devicesCollectionName = dbName_device; // コレクション名はリクエストそのまま
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    try {
        // コレクション名の検証
        if (!/^[a-zA-Z0-9_]+$/.test(devicesCollectionName)) {
            return res.render('result', {
                title: 'エラー',
                message: 'コレクション名が無効です。',
                backLink: '/manager'
            });
        }

        // データベース接続
        const database = mongoose.connection.useDb(dbName);

        // コレクションの存在確認
        const collections = await database.db.listCollections({ name: devicesCollectionName }).toArray();
        if (collections.length === 0) {
            console.log(`Collection '${devicesCollectionName}' does not exist. Creating it.`);
            await database.createCollection(devicesCollectionName); // コレクションを作成
        }

        const devicesCollection = database.collection(devicesCollectionName);

        // ドキュメントの総数を確認
        const totalDocuments = await devicesCollection.countDocuments();
        const lastPage = Math.ceil(totalDocuments / limit);
        const hasPreviousPage = page > 1;
        const hasNextPage = page < lastPage;

        // データ取得（ページング処理）
        const documents = await devicesCollection
            .find()
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

        res.render('device_list', {
            title: `${devicesCollectionName} のデバイス一覧`,
            documents, // documents をテンプレートに渡す
            currentPage: page,
            lastPage,
            hasPreviousPage,
            hasNextPage,
            previousPage: page - 1,
            nextPage: page + 1
        });
    } catch (err) {
        console.error(`Error handling collection for '${devicesCollectionName}' in '${dbName}':`, err);
        res.render('result', {
            title: 'エラー',
            message: `コレクション '${devicesCollectionName}' の処理中にエラーが発生しました。詳細: ${err.message}`,
            backLink: '/manager'
        });
    }
});


//───────────────────────────────────
// 5. ルーティング
// 各HTTPリクエストに対応するルート
// ユーザー認証、DB操作、ビューのレンダリングなどを実行
//───────────────────────────────────

// 案件資料ページ
//───────────────────────────────────
app.get('/manager/job/:id/info', async (req, res) => {
    const { id } = req.params;
    try {
        const job = await Job.findById(id); // models/Jobを利用
        res.render('info', { title: '案件資料', job });
    } catch (err) {
        console.error('Error fetching job info:', err);
        res.status(500).send('案件資料の取得に失敗しました');
    }
});

// 新規案件ページ
//───────────────────────────────────
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
//───────────────────────────────────
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
        await newJob.save(); // models/Jobを利用
        res.redirect('/manager/job/list');
    } catch (err) {
        console.error('Error saving job:', err);
        res.status(500).send('新規案件の保存に失敗しました');
    }
});

// 案件編集ページ
//───────────────────────────────────
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
        res.status(500).send('案件内容の取得に失敗しました');
    }
});

// 案件編集ページ(保存)
//───────────────────────────────────
app.post('/manager/job/:id/edit', async (req, res) => {
    const { id } = req.params;
    const { 案件名, 略称, スタッフ, 開始日, 終了日 } = req.body;

    try {
        const isValidAbbreviation = /^[a-zA-Z0-9_]+$/.test(略称);
        if (!isValidAbbreviation) {
            console.error(`Invalid abbreviation: ${略称}`);
            return res.render('result', {
                title: 'エラー',
                message: '略称が無効です。英数字とアンダースコアのみ使用できます。',
                backLink: `/manager/job/${id}/edit`
            });
        }

        await Job.findByIdAndUpdate(id, {
            案件名,
            略称,
            スタッフ,
            開始日: 開始日 ? new Date(開始日) : null,
            終了日: 終了日 ? new Date(終了日) : null
        }); // models/Jobを利用
        res.redirect('/manager');
    } catch (err) {
        console.error('Error updating job:', err);
        res.status(500).render('result', {
            title: 'エラー',
            message: '案件の更新中にエラーが発生しました。',
            backLink: `/manager/job/${id}/edit`
        });
    }
});


// 管理者専用ページ (/admin)
//───────────────────────────────────
app.get('/admin', authorize([8]), (req, res) => {
    res.render('admin', { title: '管理者ページ' });
});

// 管理者および監督者がアクセス可能なページ (/manager)
//───────────────────────────────────
app.get('/manager', authorize([8, 4]), async (req, res) => {
    try {
        const jobs = await Job.find(); // models/Jobを利用
        res.render('manager', { title: '監督者ページ', jobs });
    } catch (err) {
        console.error('Error fetching jobs:', err);
        res.status(500).send('案件の取得に失敗しました');
    }
});

// 管理者、監督者、作業者がアクセス可能なページ (/worker)
//───────────────────────────────────
app.get('/worker', authorize([8, 4, 2]), (req, res) => {
    res.render('worker', { title: '作業者ページ' });
});

// 例: 管理者と監督者がアクセス可能なリソース
app.get('/manager/resource', authorize([8, 4]), (req, res) => {
    res.send('このリソースは管理者と監督者がアクセスできます。');
});

// システムステータスページ
//───────────────────────────────────
app.get('/admin/status/system', async (req, res) => {
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

//───────────────────────────────────
// 5-1. ログイン関連
//───────────────────────────────────

// ホームページをログインページにリダイレクト
//───────────────────────────────────
app.get('/', (req, res) => {
    res.redirect('/login');
});

// ログイン処理
//───────────────────────────────────
app.get('/login', (req, res) => {
    res.render('login', { title: 'ログイン' });
});

// ログイン処理(POST)
//───────────────────────────────────
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username: username.toLowerCase() });
        if (!user || !user.group) {
            return res.render('result', {
                title: 'ログインエラー',
                message: 'ユーザー名が存在しないか、グループが未設定です。',
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

        // CookieにセッションIDを保存 (Cookieベースの場合)
        const sessionId = crypto.randomBytes(16).toString('hex'); // ランダムなセッションID生成
        sessions[sessionId] = { userId: user._id, createdAt: Date.now() }; // セッションデータに保存
        res.cookie('sessionId', sessionId, {
            httpOnly: true,
            maxAge: 3600000 // 1時間有効
        });

        // ユーザーグループに基づくリダイレクト
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
        console.error('Error during login:', err);
        res.render('result', {
            title: 'サーバーエラー',
            message: 'サーバーでエラーが発生しました。再度ログインしてください。',
            backLink: '/login'
        });
    }
});

// ログアウト処理
//───────────────────────────────────
app.get('/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        delete sessions[sessionId]; // セッションを削除
        res.clearCookie('sessionId'); // Cookieを削除
    }
    res.redirect('/login');
});

// 5-2. データベース操作
//──────────────────────────────

// DB作成
//───────────────────────────────────
app.get('/admin/:db/new', async (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです1');
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
//───────────────────────────────────
app.get('/admin/:db/delete', (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです2');
    }

    res.render('delete_confirm', {
        title: '削除確認',
        dbName: db
    });
});

// DB削除処理
//───────────────────────────────────
app.post('/admin/:db/delete', async (req, res) => {
    const { db } = req.params;
    const config = getCollectionConfig(db);

    if (!config) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです3');
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
//───────────────────────────────────
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
//───────────────────────────────────
app.get('/manager/:db/view/:collection', async (req, res) => {
    const { db, collection } = req.params;
    const config = getCollectionConfig(db);

    if (!config || config.collection !== collection) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです4', `/manager/${db}/list`);
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
//───────────────────────────────────
app.get('/manager/:db/:collection/read', async (req, res) => {
    const { db, collection } = req.params;
    const config = getCollectionConfig(db);

    if (!config || config.collection !== collection) {
        return renderMessage(res, 'エラー', 'エラー: 許可されていないコレクションです5', `/manager/${db}/list`);
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

// チェックシート編集ページ
app.get('/manager/sheet/:id_sheet/read', async (req, res) => {
    const { id_sheet } = req.params;
    const dbName = 'sheet'; // データベース名
    const collectionName = id_sheet; // コレクション名（略称 + _sheet）

    try {
        // データベース接続
        const database = mongoose.connection.useDb(dbName);

        // コレクションの存在確認
        const collections = await database.db.listCollections({ name: collectionName }).toArray();
        if (collections.length === 0) {
            console.log(`Collection '${collectionName}' does not exist. Creating it.`);
            await database.createCollection(collectionName); // コレクション作成
        }

        // モデルを取得
        const Sheet = SheetModel(dbName);

        // コレクションの内容を取得
        const documents = await Sheet.find().lean();

        if (documents.length === 0) {
            return res.render('result', {
                title: 'チェックシート編集',
                message: 'まだチェックシートの内容はありません。',
                backLink: `/manager/job/${id_sheet}/info`
            });
        }

        // チェックシート編集画面をレンダリング
        res.render('sheet_edit', {
            title: `チェックシート編集 - ${id_sheet}`,
            documents,
            id_sheet
        });
    } catch (err) {
        console.error(`Error handling collection for '${collectionName}' in '${dbName}':`, err);
        res.render('result', {
            title: 'エラー',
            message: `コレクション '${collectionName}' の処理中にエラーが発生しました。詳細: ${err.message}`,
            backLink: '/manager'
        });
    }
});


// 5-3. 管理ツール
//──────────────────────────────

// ソースコード一覧
//───────────────────────────────────
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
//───────────────────────────────────
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


//───────────────────────────────────
// 6. エラーハンドリング
// 例外やエラーをキャッチして適切にログを出力
// ユーザーにエラーメッセージを表示
//───────────────────────────────────

//───────────────────────────────────
// 7. サーバー起動
// アプリケーションを指定したポートで起動
//───────────────────────────────────

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

