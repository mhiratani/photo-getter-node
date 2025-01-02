/**
 * 画像サーバーアプリケーション
 * 指定されたディレクトリから画像ファイルを提供するExpressサーバー
 */

// 必要なモジュールのインポート
const express = require('express');
const fs = require('fs');                  // 通常のfs
const fsPromises  = require('fs').promises;  // Promise版のfs
const path = require('path');    // パス操作用
const app = express();           // Expressアプリケーションの初期化

/**
 * CORS(Cross-Origin Resource Sharing)の設定
 * すべてのオリジンからのアクセスを許可
 * セキュリティ上の考慮が必要な場合は、具体的なオリジンを指定することを推奨
 */
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});
// dotenvをインポートして設定をロード
require('dotenv').config();

// EXTERNAL_IMAGE_DIRに環境変数の値を設定
const EXTERNAL_IMAGE_DIR = process.env.EXTERNAL_IMAGE_DIR;

// サーバーの設定
const PORT = process.env.PORT || 3003;                          // ポート番号の設定（環境変数またはデフォルト値）

// すべてのリクエストをログ出力
app.use((req, res, next) => {
    console.log('=== Incoming Request ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Query:', req.query);
    console.log('=======================');
    next();
});

/**
 * 指定されたパスが安全かチェックする関数
 * @param {string} targetPath - チェックするパス
 * @returns {boolean} - パスが安全な場合はtrue
 */
function isPathSafe(targetPath) {
    const normalizedPath = path.normalize(targetPath);
    const flag = normalizedPath.startsWith(EXTERNAL_IMAGE_DIR) && !normalizedPath.includes('..');
    console.log('isPathSafe:', flag);
    return flag;
}

async function getImagesRecursively(dir) {
    try {
        const items = await fsPromises.readdir(dir, { withFileTypes: true });
        let images = [];

        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                const subImages = await getImagesRecursively(fullPath);
                images = images.concat(subImages);
            } else if (item.isFile()) {
                const ext = path.extname(item.name).toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
                    // パスを正規化して相対パスに変換
                    const relativePath = path.relative(EXTERNAL_IMAGE_DIR, fullPath)
                        .split(path.sep)
                        .join('/'); // パスセパレータを/に統一
                    images.push(relativePath);
                }
            }
        }
        return images;
    } catch (error) {
        console.error('Error in getImagesRecursively:', error);
        return [];
    }
}

/**
 * 画像一覧を取得するAPIエンドポイント
 * 指定されたディレクトリ内の画像ファイルの一覧を返す
 * クエリパラメータでサブフォルダを指定可能
 */
app.get('/api/images', async (req, res) => {
    try {
        const subFolder = req.query.folder || '';
        const targetDir = path.join(EXTERNAL_IMAGE_DIR, subFolder);

        // パスの安全性チェック
        if (!isPathSafe(targetDir)) {
            return res.status(403).json({ error: 'Invalid path' });
        }

        // ディレクトリの存在確認
        try {
            await fsPromises.access(targetDir);
        } catch (error) {
            return res.status(404).json({ error: 'Directory not found' });
        }

        // ディレクトリ内のファイルを再帰的に取得
        async function getImagesRecursively(dir) {
            const items = await fsPromises.readdir(dir, { withFileTypes: true });
            let images = [];

            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    const subImages = await getImagesRecursively(fullPath);
                    images = images.concat(subImages);
                } else {
                    const ext = path.extname(item.name).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
                        const relativePath = path.relative(EXTERNAL_IMAGE_DIR, fullPath);
                        images.push(relativePath);
                    }
                }
            }
            return images;
        }

        const imageFiles = await getImagesRecursively(targetDir);
        console.log(`Found ${imageFiles.length} images in ${targetDir}`);
        res.json({ images: imageFiles });

    } catch (error) {
        console.error('Error reading directory:', error);
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

/**
 * 個別の画像ファイルを提供するエンドポイント
 * サブフォルダのパスを含む場合にも対応
 */
// 画像ストリーミングエンドポイントの修正
app.get('/stream/image/*', async (req, res) => {
    console.log('Stream endpoint called');
    console.log('Params:', req.params);
    try {
        // URLデコードしてパスを取得
        const imagePath = decodeURIComponent(req.params[0]);
        const fullPath = path.join(EXTERNAL_IMAGE_DIR, imagePath);

        console.log('Requested file path:', fullPath);

        // パスの安全性チェック
        if (!isPathSafe(fullPath)) {
            console.error('Invalid path detected:', fullPath);
            return res.status(403).send('Forbidden');
        }

        // ファイルの存在確認
        try {
            await fsPromises.access(fullPath, fs.constants.R_OK);
        } catch (error) {
            console.error('File access error:', error);
            return res.status(404).send('File not found');
        }

        // ファイルの状態確認
        const stats = await fsPromises.stat(fullPath);
        if (!stats.isFile()) {
            console.error('Not a file:', fullPath);
            return res.status(400).send('Not a file');
        }

        // Content-Typeの設定
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // キャッシュ設定

        // ファイルのストリーミング配信
        const stream = fs.createReadStream(fullPath);
        stream.on('error', (error) => {
            console.error('Stream error:', error);
            if (!res.headersSent) {
                res.status(500).send('Error reading file');
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error('Error handling request:', error);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
});

// テストエンドポイント
app.get('/test', (req, res) => {
    console.log('Test endpoint called');
    res.send('Test endpoint working');
});

/**
 * サーバーの起動
 * 指定されたポートでリッスンを開始し、設定情報をログ出力
 */
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Available routes:');
    console.log('- GET /api/images?folder=<subfolder>');
    console.log('- GET /stream/image/<filepath>');
    console.log(`Base image directory: ${EXTERNAL_IMAGE_DIR}`);
});
