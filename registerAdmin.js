const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017'; // MongoDBの接続URI
const client = new MongoClient(uri);
const dbName = 'staff'; // データベース名
const collectionName = 'default'; // コレクション名

// アカウント登録関数
async function registerAccount(name, email, password, type) {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // コレクションのemailフィールドにユニークインデックスを作成
        await collection.createIndex({ email: 1 }, { unique: true });

        // パスワードをbcryptでハッシュ化
        const hashedPassword = await bcrypt.hash(password, 10);

        // 登録データ
        const account = {
            name,
            email,
            password: hashedPassword,
            created_at: new Date(),
            type: type.toString() // 資格の値を文字列として保存
        };

        // アカウントをデータベースに挿入
        const result = await collection.insertOne(account);
        console.log('アカウントが登録されました:', result.insertedId);
    } catch (error) {
        console.error('アカウント登録中にエラーが発生しました:', error);
    } finally {
        await client.close();
    }
}

// サンプルデータでアカウント登録
registerAccount('admin', 'admin@dsheet', 'admin', 100);

