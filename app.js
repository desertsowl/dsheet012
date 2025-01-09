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
const { Jimp } = require("jimp");

require('dotenv').config();
if (!process.env.SECRET_KEY) {
    console.error('SECRET_KEY is not defined in .env file');
    process.exit(1); // 環境変数がない場合はアプリを終了
}

// Multerのストレージ設定
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/img/'); // 画像の保存先ディレクトリ
    },
    filename: (req, file, cb) => {
        const fileExtension = path.extname(file.originalname); // 拡張子を取得
        const uniqueName = `${Date.now()}${fileExtension}`; // 一意の名前を生成
        cb(null, uniqueName); // ファイル名を設定
    }
});

// ファイルアップロード設定
const uploadImg = multer({ storage });	// Multerインスタンスを更新
const uploadCsv = multer({ dest: 'csv/' });

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
app.use(express.json());
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
app.post('/manager/device/:dbName_device/device_import', uploadCsv.single('csvfile'), async (req, res) => {
    const { dbName_device } = req.params;
    const filePath = req.file.path;

    try {
        const database = mongoose.connection.useDb('device');
        const devicesCollection = database.collection(dbName_device);

        const records = [];
        let headers = null; // ヘッダー行を格納

        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('headers', (headerRow) => {
                    headers = headerRow; // ヘッダー行を取得
                })
                .on('data', (row) => {
                    records.push(row); // データ行を格納
                })
                .on('end', async () => {
                    try {
                        // データを挿入
                        await devicesCollection.insertMany(records);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                })
                .on('error', (err) => {
                    reject(err);
                });
        });

        fs.unlinkSync(filePath); // 一時ファイルを削除

        // データ挿入後にリダイレクト
        res.redirect(`/manager/device/${dbName_device}/read`);
    } catch (err) {
        console.error('Error importing devices:', err);
        fs.unlinkSync(filePath); // エラーが発生した場合も一時ファイルを削除
        res.render('result', {
            title: 'エラー',
            message: `データのインポート中にエラーが発生しました。詳細: ${err.message}`,
            backLink: `/manager/device/${dbName_device}/device_import`
        });
    }
});

// 機器コレクション読出
//───────────────────────────────────
app.get('/manager/device/:dbName_device/read', async (req, res) => {
    const { dbName_device } = req.params;
    const { query = '', field = '' } = req.query;
    const currentPage = parseInt(req.query.page, 10) || 1;
    const limit = 10;

    try {
        const database = mongoose.connection.useDb('device');
        const devicesCollection = database.collection(dbName_device);

        const filter = query && field ? { [field]: { $regex: query, $options: 'i' } } : {};
        const totalDocuments = await devicesCollection.countDocuments(filter);
        const lastPage = Math.ceil(totalDocuments / limit);

        const documents = await devicesCollection.find(filter)
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .toArray();

        const fields = documents.length > 0 ? Object.keys(documents[0]).filter(f => f !== '_id') : [];
        const jobId = dbName_device.replace(/_device$/, '');
        const job = await Job.findById(jobId);
        const jobName = job ? job.案件名 : '案件名不明';

        res.render('device_list', {
            title: `機器台帳 - ${jobName}`,
            documents,
            fields,
            dbName_device,
            currentPage,
            lastPage,
            groupStart: Math.max(1, currentPage - ((currentPage - 1) % 5)),
            query,
            selectedField: field,
            isSearch: !!query,
            backLink: `/manager/job/${jobId}/info`,
            jobName
        });
    } catch (err) {
        console.error('Error loading device list:', err.message);
        res.render('result', {
            title: 'エラー',
            message: 'デバイス一覧の読み込み中にエラーが発生しました。',
            backLink: '/manager',
        });
    }
});


// 機器コレクション全削除
//───────────────────────────────────
app.post('/manager/device/:dbName_device/deleteAll', async (req, res) => {
    const { dbName_device } = req.params;

    try {
        const database = mongoose.connection.useDb('device');
        const devicesCollection = database.collection(dbName_device);

        // コレクション内のすべてのデータを削除
        await devicesCollection.deleteMany({});

        // 全削除後にデバイス一覧ページにリダイレクト
        res.redirect(`/manager/device/${dbName_device}/read`);
    } catch (err) {
        console.error('Error deleting all devices:', err);
        res.render('result', {
            title: 'エラー',
            message: `データの全削除中にエラーが発生しました。詳細: ${err.message}`,
            backLink: `/manager/device/${dbName_device}/read`
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
    const { 案件名, スタッフ, 開始日, 終了日 } = req.body;

    try {
        const newJob = new Job({
            案件名,
            スタッフ,
            開始日: 開始日 ? new Date(開始日) : null,
            終了日: 終了日 ? new Date(終了日) : null
        });

        await newJob.save();
        res.redirect('/manager');
    } catch (err) {
        console.error('Error creating job:', err);
        res.status(500).render('result', {
            title: 'エラー',
            message: '案件作成中にエラーが発生しました。',
            backLink: '/manager'
        });
    }
});

// 案件編集ページ
//───────────────────────────────────
app.get('/manager/job/:id/edit', async (req, res) => {
    const { id } = req.params;

    try {
        const job = await Job.findById(id); // 案件IDに基づいてデータを取得
        if (!job) {
            return res.render('result', {
                title: 'エラー',
                message: '指定された案件が見つかりません。',
                backLink: '/manager' // 戻り先を設定
            });
        }

        // スタッフデータを取得（必要に応じて）
        const database = mongoose.connection.useDb('staff');
        const collections = await database.db.listCollections().toArray();
        const staffCollections = collections.map(col => col.name);
        staffCollections.unshift('everyone');

        res.render('edit', {
            title: '案件編集',
            job,
            staffCollections,
            backLink: `/manager/job/${id}/info` // 戻りリンクをテンプレートに渡す
        });
    } catch (err) {
        console.error('Error fetching job for edit:', err);
        res.render('result', {
            title: 'エラー',
            message: '編集ページを読み込めませんでした。',
            backLink: '/manager' // 戻り先を設定
        });
    }
});

// 案件編集ページ(保存)
//───────────────────────────────────
app.post('/manager/job/:id/edit', async (req, res) => {
    const { id } = req.params;
    const { 案件名, スタッフ, 開始日, 終了日 } = req.body;

    try {
        await Job.findByIdAndUpdate(id, {
            案件名,
            スタッフ,
            開始日: 開始日 ? new Date(開始日) : null,
            終了日: 終了日 ? new Date(終了日) : null
        });

        res.redirect(`/manager/job/${id}/info`);
    } catch (err) {
        console.error('Error updating job:', err);
        res.status(500).render('result', {
            title: 'エラー',
            message: '案件編集中にエラーが発生しました。',
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
        const databases = ['job', 'device', 'sheet', 'kitting', 'staff', 'systemlog'];

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

// チェックシート読込ページ
//──────────────────────────────
app.get('/manager/sheet/:id_sheet/read', async (req, res) => {
    const { id_sheet } = req.params;

    try {
        const database = mongoose.connection.useDb('sheet');
        const SheetModel = require('./models/Sheet');
        const Sheet = SheetModel('sheet', id_sheet);

        // ドキュメントを項番の昇順で取得
        const documents = await Sheet.find().sort({ 項番: 1 }).lean();
        const isEmpty = documents.length === 0;

        // 案件名を取得
        const jobId = id_sheet.replace(/_sheet$/, '');
        const job = await Job.findById(jobId); // Jobモデルを使って案件名を取得

        res.render('sheet_read', {
            title: `チェックシート設計: ${job ? job.案件名 : '案件名不明'}`,
            documents,
            id_sheet,
            isEmpty,
            backLink: `/manager/job/${jobId}/info`
        });
    } catch (err) {
        console.error('Error fetching sheet:', err);

        const jobId = id_sheet.replace(/_sheet$/, '');
        res.render('result', {
            title: 'エラー',
            message: 'チェックシートを読み込めませんでした。',
            backLink: `/manager/job/${jobId}/info`
        });
    }
});

// チェックシート編集ページ
//──────────────────────────────
app.get('/manager/sheet/:id_sheet/edit', async (req, res) => {
    const { id_sheet } = req.params;
    const { id } = req.query; // クエリでObjectIdを取得
    const dbName = 'sheet';

    try {
        const database = mongoose.connection.useDb(dbName);
        const SheetModel = require('./models/Sheet');
        const Sheet = SheetModel(dbName, id_sheet);

        let document = null;

        // 項番が指定されている場合、そのドキュメントを取得
        if (id) {
            document = await Sheet.findById(id).lean();
        }

        // すべての項番を取得し、最大値を計算
        const allDocuments = await Sheet.find().lean();
        const itemNumbers = allDocuments.map(doc => doc.項番).sort((a, b) => a - b);
        const nextItemNumber = itemNumbers.length > 0 ? Math.max(...itemNumbers) + 1 : 1;

        res.render('sheet_edit', {
            title: id ? `編集: 項番 ${document.項番}` : `新規項目の追加`,
            id_sheet,
            document,
            itemNumbers,
            nextItemNumber,
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    } catch (err) {
        console.error('Error loading edit page:', err);
        res.render('result', {
            title: 'エラー',
            message: '編集ページを読み込めませんでした。',
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    }
});

// チェックシート保存|削除
//───────────────────────────────────
app.post('/manager/sheet/:id_sheet/save_or_delete', uploadImg.single('item_image'), async (req, res) => {
    const { id_sheet } = req.params;
    const { id, action, item_number, item_name, item_content, item_details } = req.body;

    try {
        const database = mongoose.connection.useDb('sheet');
        const SheetModel = require('./models/Sheet');
        const Sheet = SheetModel(database.name, id_sheet);

        let item_image = '';

        // アップロードされた画像が存在する場合
        if (req.file) {
            const filePath = `public/img/${req.file.filename}`;

            // jimpを利用した画像処理
			Jimp.read(filePath)
				.then(image => {
					// 画像のピクセル数を計算
					const pixelCount = image.bitmap.width * image.bitmap.height;

					// 10万ピクセルを超える場合はリサイズ
					if (pixelCount > 100000) {
						const scaleFactor = Math.sqrt(100000 / pixelCount);
						const newWidth = Math.floor(image.bitmap.width * scaleFactor);
						const newHeight = Math.floor(image.bitmap.height * scaleFactor);
						return image
						  .resize({ width: newWidth, height: newHeight })
						  .writeAsync(filePath);
					}
				})

				.catch(err => {
					console.error('Error processing image:', err);
					throw new Error('画像処理中にエラーが発生しました。');
				});

            item_image = `img/${req.file.filename}`;
        }

        if (action === 'save') {
            const itemNumber = parseInt(item_number, 10);

			// 項番の重複チェック
			const duplicateDocument = await Sheet.findOne({ 項番: itemNumber, _id: { $ne: id } });
			if (duplicateDocument) {
				// 重複が発生した場合、以降の項番をシフト
				await shiftItemNumbers(Sheet, itemNumber);
			}

            if (id) {
                // 更新処理
                await Sheet.findByIdAndUpdate(id, {
                    項番: itemNumber,
                    項目: item_name,
                    内容: item_content,
                    詳細: item_details,
                    ...(item_image && { 画像: item_image })
                });
            } else {
                // 新規作成
                await Sheet.create({
                    項番: itemNumber,
                    項目: item_name,
                    内容: item_content,
                    詳細: item_details,
                    画像: item_image
                });
            }
            res.redirect(`/manager/sheet/${id_sheet}/read`);
        } else if (action === 'delete') {
            // 削除処理
            if (!id) {
                throw new Error('削除対象のIDが指定されていません。');
            }
            await Sheet.findByIdAndDelete(id);
            res.redirect(`/manager/sheet/${id_sheet}/read`);
        } else {
            throw new Error('無効なアクションが指定されました。');
        }
    } catch (err) {
        console.error('Error handling save or delete:', err.message);
        res.render('result', {
            title: 'エラー',
            message: `処理中にエラーが発生しました。詳細: ${err.message}`,
            backLink: `/manager/sheet/${id_sheet}/edit`
        });
    }
});

// 項番の重複解消処理
async function shiftItemNumbers(Sheet, startNumber) {
    try {
        const collection = Sheet.collection;

        // 1. ユニークインデックスを一時的に解除
        await collection.dropIndex('項番_1');

        // 項番がstartNumber以上のドキュメントを取得
        const documents = await Sheet.find({ 項番: { $gte: startNumber } }).sort({ 項番: 1 }).lean();

        if (documents.length === 0) {
            // インデックスを再作成して終了
            await collection.createIndex({ 項番: 1 }, { unique: true });
            return;
        }

        // 一時的に項番を大きな値にシフト
        const tempShift = 1000;
        const tempOperations = documents.map(doc => ({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { 項番: doc.項番 + tempShift } }
            }
        }));
        await Sheet.bulkWrite(tempOperations);

        // 正しい項番に戻す
        const finalOperations = documents.map(doc => ({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { 項番: doc.項番 + 1 } }
            }
        }));
        await Sheet.bulkWrite(finalOperations);

        // 2. ユニークインデックスを再作成
        await collection.createIndex({ 項番: 1 }, { unique: true });
    } catch (err) {
        console.error('Error shifting item numbers with bulkWrite:', err.message);
        throw new Error('項番の重複解消中にエラーが発生しました。');
    }
}

// チェックシート再付番
//───────────────────────────────────
// 再付番処理
app.post('/manager/sheet/:id_sheet/renumber', async (req, res) => {
    const { id_sheet } = req.params;

    try {
        const database = mongoose.connection.useDb('sheet');
        const SheetModel = require('./models/Sheet');
        const Sheet = SheetModel('sheet', id_sheet);

        // ドキュメントを項番の昇順で取得
        const documents = await Sheet.find().sort({ 項番: 1 }).lean();
        if (documents.length === 0) {
            return res.render('result', {
                title: '情報',
                message: 'データが存在しません。',
                backLink: `/manager/sheet/${id_sheet}/read`
            });
        }

        // 再付番
        let hasGap = false;
        let expectedNumber = 1;

        for (const doc of documents) {
            if (doc.項番 !== expectedNumber) {
                hasGap = true;
                await Sheet.findByIdAndUpdate(doc._id, { 項番: expectedNumber });
            }
            expectedNumber++;
        }

        const message = hasGap
            ? `再付番を行いました(${documents[0].項番}〜${documents[documents.length - 1].項番})`
            : `空き番号はありませんでした(${documents[0].項番}〜${documents[documents.length - 1].項番})`;

        res.render('result', {
            title: '再付番完了',
            message,
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    } catch (err) {
        console.error('Error during renumbering:', err.message);
        res.render('result', {
            title: 'エラー',
            message: '再付番中にエラーが発生しました。',
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    }
});



// チェックシート画像削除
//───────────────────────────────────
app.get('/manager/sheet/:id_sheet/delete_image', async (req, res) => {
    const { id_sheet } = req.params;
    const { id } = req.query;

    try {
        const database = mongoose.connection.useDb('sheet');
        const SheetModel = require('./models/Sheet');
        const Sheet = SheetModel(database.name, id_sheet);

        const document = await Sheet.findById(id);

        if (!document) {
            throw new Error('指定されたドキュメントが見つかりません。');
        }

        // ファイルを削除
        if (document.画像) {
            const filePath = `public/${document.画像}`;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath); // ファイルを物理的に削除
            }
        }

        // ドキュメントの画像フィールドをクリア
        document.画像 = '';
        await document.save();

        res.redirect(`/manager/sheet/${id_sheet}/edit?id=${id}`);
    } catch (err) {
        console.error('Error deleting image:', err.message);
        res.render('result', {
            title: 'エラー',
            message: '画像削除中にエラーが発生しました。',
            backLink: `/manager/sheet/${id_sheet}/edit?id=${id}`
        });
    }
});

// チェックシート読込(CSV)
//───────────────────────────────────
app.post('/manager/sheet/:id_sheet/import', uploadCsv.single('csvfile'), async (req, res) => {
    const { id_sheet } = req.params;
    const filePath = req.file.path;

    try {
        const database = mongoose.connection.useDb('sheet');
        const Sheet = require('./models/Sheet')('sheet', id_sheet);

        // スキーマに基づく必須フィールド
        const requiredFields = ['項番', '項目', '内容', '詳細'];

        const records = [];
        let isHeaderValid = false;

        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (!isHeaderValid) {
                        // ヘッダー行の検証
                        const headers = Object.keys(row);
                        isHeaderValid = requiredFields.every(field => headers.includes(field));

                        if (!isHeaderValid) {
                            reject(new Error(`CSVファイルのヘッダーが不正です。必要なフィールド: ${requiredFields.join(', ')}`));
                            return;
                        }
                    }
                    records.push(row);
                })
                .on('end', async () => {
                    try {
                        // データ挿入
                        await Sheet.insertMany(records);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                })
                .on('error', (err) => {
                    reject(err);
                });
        });

        fs.unlinkSync(filePath); // 一時ファイルを削除
        res.redirect(`/manager/sheet/${id_sheet}/read`);
    } catch (err) {
        console.error('Error importing CSV:', err.message);
        fs.unlinkSync(filePath); // エラーが発生した場合も一時ファイルを削除
        res.render('result', {
            title: 'エラー',
            message: `CSVのインポートに失敗しました。詳細: ${err.message}`,
            backLink: `/manager/sheet/${id_sheet}/import`
        });
    }
});

// チェックシート保存(CSV)
//───────────────────────────────────
app.get('/manager/sheet/:id_sheet/export', async (req, res) => {
    const { id_sheet } = req.params;

    try {
        const database = mongoose.connection.useDb('sheet');
        const Sheet = require('./models/Sheet')('sheet', id_sheet);
        const documents = await Sheet.find().lean();

        // CSV生成
        let csvContent = '項番,項目,内容,詳細\n';
        documents.forEach(doc => {
            csvContent += `"${doc.項番}","${doc.項目}","${doc.内容}","${doc.詳細}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${id_sheet}.csv`);
        res.send(csvContent);
    } catch (err) {
        console.error('Error exporting CSV:', err);
        res.render('result', {
            title: 'エラー',
            message: 'CSVのエクスポートに失敗しました。',
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    }
});

// チェックシート全削除
//───────────────────────────────────
app.post('/manager/sheet/:id_sheet/deleteAll', async (req, res) => {
    const { id_sheet } = req.params;

    try {
        const database = mongoose.connection.useDb('sheet');
        const Sheet = require('./models/Sheet')('sheet', id_sheet);

        await Sheet.deleteMany({});
        res.redirect(`/manager/sheet/${id_sheet}/read`);
    } catch (err) {
        console.error('Error deleting all documents:', err);
        res.render('result', {
            title: 'エラー',
            message: '全削除に失敗しました。',
            backLink: `/manager/sheet/${id_sheet}/read`
        });
    }
});

// チェックシート読込(csv)
//───────────────────────────────────
// デバイス登録ページを表示
app.get('/manager/device/:dbName_device/device_import', async (req, res) => {
    const { dbName_device } = req.params;

    try {
        // 必要に応じてデバイスの情報や案件名を取得
        const jobId = dbName_device.replace(/_device$/, '');
        const job = await Job.findById(jobId);

        res.render('device_import', {
            title: `${job ? job.案件名 : '案件名不明'} - 機器登録`,
            dbName_device,
            backLink: `/manager/device/${dbName_device}/read`
        });
    } catch (err) {
        console.error('Error loading device import page:', err.message);
        res.render('result', {
            title: 'エラー',
            message: 'デバイス登録ページの読み込み中にエラーが発生しました。',
            backLink: `/manager/device/${dbName_device}/read`
        });
    }
});

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

  // プレースホルダの値を検証して不正な値を除外
    if (!/^[a-zA-Z0-9_]+$/.test(db) || !/^[a-zA-Z0-9_]+$/.test(collection)) {
        return res.status(400).send('無効なデータベースまたはコレクション名です');
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

// ダウンローダ
//───────────────────────────────────
app.get('/admin/src/download', (req, res) => {
    const { file } = req.query;

    try {
        // ファイルパスを安全に生成
        const filePath = path.join(__dirname, file);

        // ファイルの存在を確認
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('ファイルが見つかりません。');
        }

        // ファイル名に .txt を追加
        const baseName = path.basename(file);
        const downloadName = baseName.endsWith('.txt') ? baseName : `${baseName}.txt`;

        // 適切なContent-TypeとContent-Dispositionヘッダーを設定
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

        // ファイルを送信
        fs.createReadStream(filePath)
            .on('error', (err) => {
                console.error('ファイル送信エラー:', err);
                res.status(500).send('ファイル送信中にエラーが発生しました。');
            })
            .pipe(res);
    } catch (err) {
        console.error('ダウンロードエラー:', err);
        res.status(500).send('ダウンロード中にエラーが発生しました。');
    }
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
