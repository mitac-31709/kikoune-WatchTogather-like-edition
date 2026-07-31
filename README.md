# Kikoune

Discordのアクティビティで動く、Kiite Cafe風にニコニコ動画を同時再生するアプリ。

## セットアップ

Node.js 22.6.0 と pnpm 9 が必要です。

```bash
# Node（nvm の例）
nvm install
nvm use

# pnpm
corepack enable
corepack prepare pnpm@9.11.0 --activate

# 依存関係インストール
pnpm install
```

## コマンド

```bash
# Redis起動
docker compose -f docker-compose.dev.yml up -d redis

# 開発サーバー起動（依存パッケージの build を先に実行する）
pnpm dev

# ビルド
pnpm build

# チェック
pnpm lint
pnpm typecheck
```

## URLマッピング

| Prefix                                                  | URL                                       |
| ------------------------------------------------------- | ----------------------------------------- |
| `/external/{subsubsub}--{subsub}--{sub}--{main}--{tld}` | `{subsubsub}.{subsub}.{sub}.{main}.{tld}` |
| `/external/{subsub}--{sub}--{main}--{tld}`              | `{subsub}.{sub}.{main}.{tld}`             |
| `/external/{sub}--{main}--{tld}`                        | `{sub}.{main}.{tld}`                      |
| `/`                                                     | `your-domain.example.com`                 |

## ライセンス

MIT Licenseで公開されています。詳しくは[LICENSE](LICENSE)を参照してください。
