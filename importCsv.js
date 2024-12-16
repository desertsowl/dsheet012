const fs = require('fs');
const { MongoClient } = require('mongodb');
const csvParser = require('csv-parser');

// MongoDB接続設定
const uri = 'mongodb://localhost:27017'; // MongoDBの接続URI
const dbName = 'device'; // データベース名
const collectionName = '2024_shikaku_device'; // コレクション名

// CSVファイルのパス
const filePath = './csv/data001.csv';

// MongoDBにデータを登録する関数
async function importCsvToMongoDB() {
    const client = new MongoClient(uri);

    try {
        // MongoDBに接続
        await client.connect();
        console.log('MongoDBに接続しました。');

        const database = client.db(dbName);
        const collection = database.collection(collectionName);

        // CSVファイルを読み込み
        const records = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => {
                records.push(row); // 各行をrecordsに追加
            })
            .on('end', async () => {
                try {
                    // データをMongoDBに挿入
                    const result = await collection.insertMany(records);
                    console.log(`${result.insertedCount}件のドキュメントを登録しました。`);
                } catch (err) {
                    console.error('データ登録中にエラーが発生しました:', err);
                } finally {
                    // MongoDB接続を閉じる
                    await client.close();
                    console.log('MongoDBとの接続を閉じました。');
                }
            })
            .on('error', (err) => {
                console.error('CSV読み込み中にエラーが発生しました:', err);
            });
    } catch (err) {
        console.error('MongoDB接続中にエラーが発生しました:', err);
        if (client) {
            await client.close();
        }
    }
}

// 実行
importCsvToMongoDB();

