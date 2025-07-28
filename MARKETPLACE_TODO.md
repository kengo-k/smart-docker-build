# GitHub Marketplace 出品準備チェックリスト

## 🎯 MVP (v1.0) - マーケットプレイス出品の最小構成

### 必須機能（出品のため）
- [ ] **M1. DockerHub対応追加** - 現在GHCR のみ → GHCR + DockerHub 両対応
- [x] **M2. action.yaml完成** - author, branding（アイコン・色）, 詳細description
- [ ] **M3. README.md充実** - 使用例、詳細説明、GitHub Actions バッジ
- [x] **M4. LICENSEファイル追加** - MIT推奨
- [x] **M8. バリデーションとエラーログ追加** - 入力値検証とエラーハンドリング強化

### 差別化のための最小機能
- [ ] **M5. 基本マルチプラットフォーム** - linux/amd64, linux/arm64 のみ対応
- [ ] **M6. 改善されたタグ戦略** - より柔軟で実用的なタグ生成

### 品質保証
- [ ] **M7. テスト拡充** - MVP機能の動作確認テスト整備

---

## 🚀 v1.1 - 基本機能拡張（需要高・実装容易）

### 高需要・実装容易
- [ ] **V1-1. ビルドキャッシュ機能** - GitHub Actions Cache統合
- [ ] **V1-2. Pull Request用プレビュータグ** - PR番号ベースのタグ生成
- [ ] **V1-3. AWS ECR 対応** - 最大シェアのクラウドレジストリ

## ⚡ v1.2 - 高度機能（実装複雑・差別化）

### 技術的高度・差別化要素
- [ ] **V2-1. BuildKit/Buildx 高度統合** - シークレット管理、SSH forwarding
- [ ] **V2-2. Azure Container Registry (ACR) 対応**
- [ ] **V2-3. Google Container Registry (GCR) 対応**

## 🏢 v2.0 - エンタープライズ対応（セキュリティ・ガバナンス）

⚠️ **注意: v2.0は実装検討中**
- **需要が不明確** - GitHub Actions利用者は中小企業・個人開発者が中心
- **エンタープライズ** - 独自CI/CD環境を持ち、GitHub Actionsは補助的利用
- **実装判断** - v1.2完了後のユーザーフィードバック次第で決定
- **優先度** - v1.0-v1.2の品質向上を優先、v2.0は後回し・削除候補

### エンタープライズ特化機能（要検討）
- [ ] **V3-1. OCI準拠とメタデータ** - 標準ラベル自動生成
- [ ] **V3-2. SBOM (Software Bill of Materials) 対応**
- [ ] **V3-3. イメージ署名・検証機能**

---

## 🚨 機能面の重大な不足 (参考：フル機能版)

### 1. レジストリ対応の拡張 
- [ ] **DockerHub 対応** - 現在 GHCR のみ → 最低限 DockerHub 対応が必要
- [ ] **複数レジストリ同時プッシュ** - DockerHub + GHCR 等への同時プッシュ
- [ ] **AWS ECR 対応** - エンタープライズ利用のため
- [ ] **Azure Container Registry (ACR) 対応**
- [ ] **Google Container Registry (GCR) 対応**

### 2. マルチプラットフォームビルド
- [ ] **linux/amd64, linux/arm64 対応** - 必須機能
- [ ] **QEMU/Buildx 統合** - マルチプラットフォームビルドのため
- [ ] **プラットフォーム指定オプション** - ユーザーが選択可能に

### 3. ビルドキャッシュ機能
- [ ] **ローカルキャッシュ対応** - ビルド高速化のため
- [ ] **リモートキャッシュ対応** - GitHub Actions Cache等
- [ ] **レイヤーキャッシュ最適化**

### 4. 高度なタグ戦略
- [ ] **セマンティックバージョニング対応** (v1.2.3形式)
- [ ] **Git tag ベースの自動タグ生成**
- [ ] **Pull Request用プレビュータグ**
- [ ] **latest タグの自動管理**

### 5. BuildKit/Buildx 統合
- [ ] **BuildKit 高度機能の活用** - 現在基本的な docker build のみ
- [ ] **Buildx プラグイン統合** - マルチプラットフォーム・高速ビルドのため
- [ ] **ビルドコンテキスト最適化**
- [ ] **シークレット管理** - build secrets の安全な処理

### 6. OCI 準拠とメタデータ
- [ ] **OCI イメージスペック準拠**
- [ ] **標準メタデータ・ラベル生成** (org.opencontainers.*)
- [ ] **SBOM (Software Bill of Materials) 対応**
- [ ] **イメージ署名・検証機能**

## 📋 詳細実装項目

### v1.0 (MVP) - 必須機能の詳細
- [ ] **M1-1. DockerHub認証設定** - docker/login-action との統合
- [ ] **M1-2. レジストリ選択オプション** - GHCR/DockerHub/両方の選択機能
- [x] **M2-1. action.yaml author追加** - 作者情報
- [x] **M2-2. action.yaml branding追加** - アイコン（package）・色（blue）
- [x] **M2-3. action.yaml description改善** - より詳細で魅力的な説明
- [ ] **M3-1. README使用例追加** - DockerHub/GHCR両方の例
- [ ] **M3-2. README バッジ追加** - GitHub Actions status badge
- [x] **M4-1. LICENSE ファイル** - MIT ライセンス

### v1.0 (MVP) - 必須機能の詳細（追加）
- [x] **M8-1. 入力値バリデーション** - args, path, name等の必須項目チェック
- [x] **M8-2. Dockerfileファイル存在チェック** - ビルド前のファイル存在確認
- [x] **M8-3. エラーハンドリング強化** - 個別失敗時の継続実行とログ出力
- [x] **M8-4. ユーザーフレンドリーなエラーメッセージ** - 分かりやすいエラー説明

### v1.0 (MVP) - 差別化機能の詳細  
- [ ] **M5-1. Buildx setup統合** - docker/setup-buildx-action使用
- [ ] **M5-2. QEMU setup統合** - docker/setup-qemu-action使用
- [ ] **M5-3. platforms設定** - linux/amd64,linux/arm64 対応
- [ ] **M6-1. タグ戦略改善** - branch-timestamp-sha から選択可能に

### v1.0 (MVP) - 品質保証の詳細
- [ ] **M7-1. 基本機能テスト** - GHCR/DockerHub両方でのビルド・プッシュテスト
- [ ] **M7-2. マルチプラットフォームテスト** - linux/amd64, linux/arm64での動作確認
- [ ] **M7-3. エラーハンドリングテスト** - 認証失敗、ビルドエラー等の処理確認
- [ ] **M7-4. 実サンプルプロジェクトテスト** - 実際のDockerfileでの動作検証

## 📋 バージョン別機能詳細

### V1-1. ビルドキャッシュ機能 - 詳細説明

#### 目的
Dockerビルドの中間レイヤーをキャッシュして、次回ビルドを大幅高速化する。

#### 現在の問題
```bash
# 毎回フルビルド（例：5分）
docker build -t myapp .
```

#### 実装後の効果
```bash
# 初回：5分、2回目以降：30秒程度
docker buildx build --cache-from type=gha --cache-to type=gha -t myapp .
```

#### 実装内容
- [ ] **V1-1-1. GitHub Actions Cache統合** - `--cache-from type=gha` オプション追加
- [ ] **V1-1-2. レジストリキャッシュ対応** - `--cache-from type=registry` オプション
- [ ] **V1-1-3. キャッシュ設定の選択肢** - ユーザーがキャッシュ方式を選択可能
- [ ] **V1-1-4. キャッシュ効果の可視化** - ビルド時間改善をログ出力

#### 技術的詳細
```yaml
# GitHub Actions Cache使用例
- name: Build with cache
  run: |
    docker buildx build \
      --cache-from type=gha \
      --cache-to type=gha,mode=max \
      --platform linux/amd64,linux/arm64 \
      --push -t $image .
```

#### ユーザー設定例
```yaml
with:
  cache_enabled: true
  cache_type: "gha"  # gha, registry, disabled
```

---

### V2-1. BuildKit/Buildx 高度統合 - 詳細説明

#### なぜこの対応をするのか
現在のActionは基本的な`docker build`のみ対応しており、BuildKitの高度機能が使えない。エンタープライズ開発やプライベートリポジトリを扱う場面で制約となっている。

#### どんなメリットがあるのか
1. **セキュリティ向上** - シークレットがイメージに残らない
2. **プライベートリポジトリ対応** - SSH経由でのclone可能
3. **ビルド高速化** - 高度なキャッシュマウント
4. **エンタープライズ対応** - 企業での実用性向上

#### 現在の問題と解決

**問題1: 秘密情報の漏洩リスク**
```dockerfile
# 危険：トークンがイメージに残る
ENV NPM_TOKEN=abc123
RUN npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN
```

**V5での解決:**
```dockerfile
# 安全：トークンはビルド時のみ、イメージに残らない
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npm_token \
    npm config set //registry.npmjs.org/:_authToken=$(cat /run/secrets/npm_token)
```

**問題2: プライベートリポジトリアクセス**
```dockerfile
# 現在：SSHキーの扱いが困難
COPY ssh_key /tmp/
RUN git clone git@github.com:company/private-repo.git
```

**V5での解決:**
```dockerfile
# SSH forwarding使用
# syntax=docker/dockerfile:1
RUN --mount=type=ssh git clone git@github.com:company/private-repo.git
```

**問題3: 依存関係インストールの遅さ**
```dockerfile
# 毎回フルインストール
RUN npm install  # 5分かかる
```

**V5での解決:**
```dockerfile
# キャッシュマウント使用
# syntax=docker/dockerfile:1
RUN --mount=type=cache,target=/root/.npm \
    npm install  # 30秒に短縮
```

#### 実装内容
- [ ] **V2-1-1. シークレット管理対応** - `--secret`オプションとDockerfile構文対応
- [ ] **V2-1-2. SSH forwarding対応** - `--ssh`オプション追加
- [ ] **V2-1-3. キャッシュマウント対応** - `--mount=type=cache`の設定可能化
- [ ] **V2-1-4. BuildKit syntax自動有効化** - `# syntax=docker/dockerfile:1`の自動付与

#### ユーザー設定例
```yaml
with:
  buildkit: true
  secrets: |
    npm_token: ${{ secrets.NPM_TOKEN }}
    api_key: ${{ secrets.API_KEY }}
  ssh: true
  cache_mounts:
    - /root/.npm
    - /root/.cache
```

#### ターゲットユーザー
- **エンタープライズ開発者** - プライベートパッケージ使用
- **オープンソース開発者** - プライベート依存関係あり
- **セキュリティ重視プロジェクト** - 秘密情報の適切な管理が必要

---

### セキュリティ強化
- [ ] トークン権限の最小化文書
- [ ] セキュリティベストプラクティス追加
- [ ] 複数レジストリ用トークン管理

### 品質向上
- [ ] package.json メタデータ充実
- [ ] エラーハンドリング改善
- [ ] ログ出力最適化
- [ ] テストケース追加

### ドキュメント拡充
- [ ] CHANGELOG.md 作成
- [ ] CONTRIBUTING.md 作成
- [ ] 高度な使用例追加

### マーケティング
- [ ] 競合比較表作成
- [ ] 特徴・利点の明確化
- [ ] キーワード最適化

## 📝 実装済み
- [x] プロジェクト構造の理解
- [x] 現在のファイル構成の確認
- [x] マーケットプレイス要件の調査

## 🚀 MVP リリース準備
- [ ] MVP必須機能の完了確認
- [ ] MVP差別化機能の完了確認  
- [ ] v1.0 リリースノート作成
- [ ] v1.0 バージョンタグ作成
- [ ] マーケットプレイス出品申請

## 📊 進捗管理

### バージョン別工数見積もり
**v1.0 (MVP):** マーケットプレイス出品可能レベル
- 必須機能: 5項目（DockerHub対応、action.yaml、README、LICENSE、バリデーション）
- 差別化機能: 2項目（マルチプラットフォーム、タグ戦略）
- 品質保証: 1項目（テスト拡充）
- **予想工数:** 1-2週間

**v1.1:** 基本機能拡張
- 高需要・実装容易: 3項目（キャッシュ、PRタグ、ECR）
- **予想工数:** 2-3週間

**v1.2:** 高度機能
- 技術的高度・差別化: 3項目（BuildKit、ACR、GCR）
- **予想工数:** 3-4週間

**v2.0:** エンタープライズ対応（実装検討中）
- セキュリティ・ガバナンス: 3項目（OCI、SBOM、署名）
- **予想工数:** 4-6週間
- **⚠️ 注意:** 需要不明のため、v1.2完了後のユーザーフィードバック次第で判断

---
*最終更新: 2025-07-28*
*進捗状況: MVP計画完了*