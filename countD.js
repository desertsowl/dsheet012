const { MongoClient } = require('mongodb');

// MongoDB接続情報
const uri = "mongodb://localhost:27017"; // 必要に応じて変更
const databaseName = "device"; // 対象データベース名

async function countDocumentsInCollections() {
    const client = new MongoClient(uri);

    try {
        // データベースに接続
        await client.connect();
        console.log(`Connected to database: ${databaseName}`);

        const db = client.db(databaseName);

        // コレクション名を取得
        const collections = await db.listCollections().toArray();

        // コレクションごとにドキュメント数を取得
        for (const collection of collections) {
            const collectionName = collection.name;
            const count = await db.collection(collectionName).countDocuments();
            console.log(`Collection: ${collectionName}, Document Count: ${count}`);
        }
    } catch (error) {
        console.error("Error occurred:", error);
    } finally {
        // 接続を閉じる
        await client.close();
        console.log("Connection closed.");
    }
}

countDocumentsInCollections();
