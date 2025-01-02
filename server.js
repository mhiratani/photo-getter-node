/**
 * 画像サーバーアプリケーション
 * 指定されたディレクトリから画像ファイルを提供するExpressサーバー
 */

// 必要なモジュールのインポート
const ExifReader = require('exifreader');
const sharp = require('sharp');
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

// メタデータを取得する関数
async function getImageMetadata(filePath) {
    try {
        // ファイル拡張子チェック
        const ext = path.extname(filePath).toLowerCase();
        if (!['.jpg', '.jpeg', '.tiff', '.png'].includes(ext)) {
            return null;
        }

        // ファイルの存在確認
        const stats = await fsPromises.stat(filePath);
        if (!stats.isFile()) {
            throw new Error('Not a file');
        }

        // ファイルをバッファとして読み込み
        const buffer = await fsPromises.readFile(filePath);

        // メタデータの読み取り
        const tags = await ExifReader.load(buffer, {
            expanded: true,  // 拡張情報も取得
        });

        // 必要なメタデータを抽出
        return {
            fileName: path.basename(filePath),
            fileSize: stats.size,
            dateTime: tags.exif?.DateTimeOriginal?.description || 
                     tags.exif?.DateTime?.description || 
                     stats.mtime.toISOString(),
            make: tags.exif?.Make?.description || null,
            model: tags.exif?.Model?.description || null,
            orientation: tags.exif?.Orientation?.value || 1,
            width: tags.exif?.ImageWidth?.value || null,
            height: tags.exif?.ImageHeight?.value || null,
            gps: tags.gps ? {
                latitude: tags.gps?.Latitude,
                longitude: tags.gps?.Longitude
            } : null
        };

    } catch (error) {
        console.error(`Metadata extraction failed for ${filePath}:`, error);
        // 基本的なファイル情報だけでも返す
        return {
            fileName: path.basename(filePath),
            fileSize: (await fsPromises.stat(filePath)).size,
            dateTime: (await fsPromises.stat(filePath)).mtime.toISOString(),
            error: error.message
        };
    }
}

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
                    // メタデータを取得
                    const metadata = await getImageMetadata(fullPath);
                    images.push({
                        path: relativePath,
                        metadata: metadata || {},
                        filename: item.name
                    });
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

        const imageFiles = await getImagesRecursively(targetDir);
        console.log(`Found ${imageFiles.length} images in ${targetDir}`);

        // レスポンスの形式が変更されている点に注意
        // 以前: { images: ['path1', 'path2', ...] }
        // 現在: { images: [{ path: 'path1', metadata: {...}, filename: 'name1' }, ...] }
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

        // 基本的なバリデーションチェック
        await validateRequest(fullPath);

        // クエリパラメータの取得
        const options = {
            width: parseInt(req.query.w) || 1280,
            quality: parseInt(req.query.q) || 80,
            format: req.query.format || 'auto',
            acceptsWebP: req.headers.accept?.includes('image/webp')
        };

        try {
            // 画像処理を試みる
            console.log('画像処理を試みる:', fullPath);
            await processAndStreamImage(fullPath, options, res);
        } catch (processingError) {
            console.error('Image processing failed, falling back to original file:', processingError);
            try {
                // 画像処理に失敗した場合、元のファイルを送信
                await streamOriginalFile(fullPath, res);
            } catch (streamingError) {
                console.error('Failed to stream original file:', streamingError);
                // 必要に応じて、ここでクライアントにエラーレスポンスを送信
                res.status(500).send('Internal Server Error');
            }
        }

    } catch (error) {
        handleError(error, res);
        console.log('handleError');
    }
});

// リクエストの検証
async function validateRequest(fullPath) {
    if (!isPathSafe(fullPath)) {
        throw new Error('FORBIDDEN_PATH');
    }

    try {
        await fsPromises.access(fullPath, fs.constants.R_OK);
        const stats = await fsPromises.stat(fullPath);
        if (!stats.isFile()) {
            throw new Error('NOT_A_FILE');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('FILE_NOT_FOUND');
        }
        throw error;
    }
}

// 画像処理とストリーミング
async function processAndStreamImage(fullPath, options, res) {
    const { width, quality, format, acceptsWebP } = options;
    const ext = path.extname(fullPath).toLowerCase();

    // 画像処理パイプラインの作成
    let imageProcessor = sharp(fullPath);

    // リサイズの適用
    if (width) {
        imageProcessor = imageProcessor.resize(width, null, {
            withoutEnlargement: true,
            fit: 'inside'
        });
    }

    // フォーマット設定
    if (format === 'webp' || (format === 'auto' && acceptsWebP)) {
        imageProcessor = imageProcessor.webp({ quality });
        res.setHeader('Content-Type', 'image/webp');
    } else {
        applyOriginalFormat(imageProcessor, ext, quality, res);
    }

    // キャッシュヘッダーの設定
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    // メタデータチェック（破損チェック）
    await imageProcessor.metadata();

    // ストリーミング
    return new Promise((resolve, reject) => {
        imageProcessor
            .pipe(res)
            .on('error', reject)
            .on('finish', resolve);
    });
}

// 元のファイルをストリーミング
async function streamOriginalFile(fullPath, res) {
    const ext = path.extname(fullPath).toLowerCase();
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('X-Served-Original', 'true');

    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
        stream.on('error', reject);
        stream.on('end', resolve);
    });
}

// 元の形式を適用
function applyOriginalFormat(imageProcessor, ext, quality, res) {
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            imageProcessor = imageProcessor.jpeg({ quality });
            res.setHeader('Content-Type', 'image/jpeg');
            break;
        case '.png':
            imageProcessor = imageProcessor.png({ quality });
            res.setHeader('Content-Type', 'image/png');
            break;
        default:
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    }
    return imageProcessor;
}

// エラーハンドリング
function handleError(error, res) {
    console.error('Error handling request:', error);

    if (res.headersSent) return;
    switch (error.message) {
        case 'FORBIDDEN_PATH':
            res.status(403).send('Forbidden');
            break;
        case 'FILE_NOT_FOUND':
            res.status(404).send('File not found');
            break;
        case 'NOT_A_FILE':
            res.status(400).send('Not a file');
            break;
        default:
            res.status(500).send('Internal server error');
    }
}

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
