1. インストール:
```Bash
npm install -g pm2
```
1. アプリケーションの起動と常駐化:
```Bash
pm2 start server.js --name photo-getter-app
```
-  server.js: 起動したいスクリプトファイル名
-  --name photo-getter-app: プロセスにわかりやすい名前をつけます（任意）

1. 状態確認:
```Bash
pm2 status
# または
pm2 list
```

1. ログ確認:
```Bash
pm2 logs photo-getter-app # アプリ名で指定
# または
pm2 logs all # すべてのアプリのログ
```

1. アプリケーションの停止:
```Bash
pm2 stop photo-getter-app
```

1. アプリケーションの再起動:
```Bash
pm2 restart photo-getter-app
```

1. アプリケーションの削除 (管理対象から外す):
```Bash
pm2 delete photo-getter-app
```

1. システムの起動時に自動起動させる設定: 現在のPM2の状態を保存し、OSの起動スクリプトを生成する
```Bash
pm2 save
pm2 startup
```
- pm2 startup を実行すると、環境に応じたコマンドが表示されるので、それをroot権限で実行。
