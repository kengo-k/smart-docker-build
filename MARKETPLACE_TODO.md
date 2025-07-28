# GitHub Marketplace 出品準備チェックリスト

## 🎯 MVP (v1.0) - マーケットプレイス出品の最小構成

### 必須機能（出品のため）
- [ ] **DockerHub対応追加** - 現在GHCR のみ → GHCR + DockerHub 両対応
- [ ] **action.yaml完成** - author, branding（アイコン・色）, 詳細description
- [ ] **README.md充実** - 使用例、詳細説明、GitHub Actions バッジ
- [ ] **LICENSEファイル追加** - MIT推奨

### 差別化のための最小機能
- [ ] **基本マルチプラットフォーム** - linux/amd64, linux/arm64 のみ対応
- [ ] **改善されたタグ戦略** - より柔軟で実用的なタグ生成

---

## 🔄 後回し項目（v1.1以降）

### レジストリ拡張
- [ ] AWS ECR 対応
- [ ] Azure Container Registry (ACR) 対応  
- [ ] Google Container Registry (GCR) 対応
- [ ] **複数レジストリ同時プッシュ**

### 高度な機能
- [ ] **ビルドキャッシュ機能** - ローカル・リモートキャッシュ
- [ ] **BuildKit/Buildx 高度統合**
- [ ] **OCI準拠とメタデータ** - SBOM, 署名等
- [ ] **Pull Request用プレビュータグ**

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

## 📋 詳細実装項目（MVP用）

### MVP - 必須機能の詳細
- [ ] **DockerHub認証設定** - docker/login-action との統合
- [ ] **レジストリ選択オプション** - GHCR/DockerHub/両方の選択機能
- [ ] **action.yaml author追加** - 作者情報
- [ ] **action.yaml branding追加** - アイコン（docker）・色（blue）
- [ ] **action.yaml description改善** - より詳細で魅力的な説明
- [ ] **README使用例追加** - DockerHub/GHCR両方の例
- [ ] **README バッジ追加** - GitHub Actions status badge
- [ ] **LICENSE ファイル** - MIT ライセンス

### MVP - 差別化機能の詳細  
- [ ] **Buildx setup統合** - docker/setup-buildx-action使用
- [ ] **QEMU setup統合** - docker/setup-qemu-action使用
- [ ] **platforms設定** - linux/amd64,linux/arm64 対応
- [ ] **タグ戦略改善** - branch-timestamp-sha から選択可能に

## 📋 後回し項目（v1.1以降）の詳細

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
**MVP (v1.0) 目標:** マーケットプレイス出品可能レベル
- 必須機能: 4項目（DockerHub対応、action.yaml、README、LICENSE）
- 差別化機能: 2項目（マルチプラットフォーム、タグ戦略）
- **予想工数:** 1-2週間

**v1.1以降:** ユーザーフィードバック反映 + 高度機能追加

---
*最終更新: 2025-07-28*
*進捗状況: MVP計画完了*