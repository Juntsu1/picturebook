# 実装計画: 子供写真によるイラスト生成

## 概要

子供の写真をアップロードし、gpt-image-1.5 の `images.edits` エンドポイントを使用して写真を参照したイラストを生成する機能を実装する。バックエンドに写真アップロードサービスとイラストエンジンの拡張を行い、フロントエンドにアップロードUIを追加する。

## タスク

- [x] 1. 共有型定義とバリデーション定数の追加
  - [x] 1.1 `packages/shared/src/constants.ts` に `PHOTO_MAX_SIZE_BYTES` と `PHOTO_ALLOWED_MIME_TYPES` を追加する
    - `PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024` (10MB)
    - `PHOTO_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']`
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 `packages/shared/src/schemas.ts` に `PhotoUploadSchema` を追加する
    - mimetype と size のバリデーション用 Zod スキーマ
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.3 `packages/shared/src/types.ts` に `ProfileResponse` の `photoUrl` フィールドを追加する
    - `photoUrl?: string` をオプショナルフィールドとして追加
    - _Requirements: 1.6_

- [x] 2. 写真アップロードサービスの実装
  - [x] 2.1 `packages/backend/src/services/photo-upload-service.ts` を新規作成する
    - `validatePhoto(file)`: MIME タイプとファイルサイズのバリデーション
    - `uploadPhoto(userId, profileId, fileBuffer, options?)`: Firebase Storage への PNG 保存
    - `deletePhoto(userId, profileId, options?)`: Firebase Storage からの写真削除
    - `downloadPhoto(storagePath, options?)`: Firebase Storage から写真バイナリ取得
    - Storage パス: `users/{userId}/profiles/{profileId}/photo.png`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1, 5.2_
  - [ ]* 2.2 写真バリデーションのプロパティテストを作成する
    - **Property 1: 写真バリデーションの正確性**
    - MIME タイプが許可リストに含まれ、かつサイズが 10MB 以下の場合のみ valid: true
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
  - [ ]* 2.3 写真アップロードラウンドトリップのプロパティテストを作成する
    - **Property 2: 写真アップロードラウンドトリップ**
    - アップロード後に Storage にファイルが存在し、プロフィールの photoUrl が非null
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 1.5, 1.6**

- [x] 3. プロフィールサービスの拡張
  - [x] 3.1 `packages/backend/src/services/profile-service.ts` の `ChildProfileDoc` に `photoUrl` と `photoStoragePath` フィールドを追加する
    - 両フィールドとも `string | null` 型、デフォルト null
    - `toProfileResponse` に `photoUrl` を含める
    - `createProfile` で `photoUrl` / `photoStoragePath` を受け取れるように拡張
    - _Requirements: 1.6, 5.2_
  - [x] 3.2 `packages/backend/src/services/profile-service.ts` に `updateProfilePhoto` と `deleteProfile` 関数を追加する
    - `updateProfilePhoto(userId, profileId, photoUrl, photoStoragePath)`: photoUrl と photoStoragePath を更新
    - `clearProfilePhoto(userId, profileId)`: photoUrl と photoStoragePath を null に設定
    - `deleteProfile(userId, profileId)`: プロフィールドキュメントを削除（写真の Storage 削除は呼び出し元で実施）
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 3.3 写真なしプロフィール作成のプロパティテストを作成する
    - **Property 3: 写真なしプロフィール作成**
    - 写真なしでプロフィール作成した場合、photoUrl が null であること
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 2.4**

- [x] 4. コンテンツフィルターとの統合
  - [x] 4.1 写真アップロードフローに `content-filter.ts` の `checkImage` を統合する
    - `photo-upload-service.ts` の `uploadPhoto` 内でアップロード前に安全性チェックを実施
    - 不適切判定時はエラーを返し、Storage に保存しない
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ]* 4.2 不適切画像の拒否と非保存のプロパティテストを作成する
    - **Property 7: 不適切画像の拒否と非保存**
    - コンテンツフィルターが不適切と判定した場合、Storage に保存されずエラーが返ること
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 4.1, 4.2**

- [x] 5. チェックポイント - バックエンドサービス層の確認
  - すべてのテストが通ることを確認し、不明点があればユーザーに質問する。

- [x] 6. イラストエンジンの拡張
  - [x] 6.1 `packages/backend/src/services/illustration-engine.ts` に写真参照イラスト生成機能を追加する
    - `generateForPage` の `options` に `photoStoragePath?: string | null` パラメータを追加
    - `generateWithPhoto(client, prompt, photoBuffer, size)`: `images.edits` を使用した生成関数を新規追加
    - `buildPhotoReferencePrompt(page, profile, theme)`: 写真参照用プロンプト構築関数を新規追加（「参照画像の子供の外見的特徴を反映した絵本スタイルのキャラクターとして描く」旨の指示を含む）
    - `photoStoragePath` がある場合は `images.edits` を使用、ない場合は従来の `images.generate` を使用
    - `images.edits` 失敗時は最大3回リトライ後、`images.generate` にフォールバック
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 6.2 写真有無による API エンドポイント選択のプロパティテストを作成する
    - **Property 4: 写真有無による API エンドポイント選択**
    - `photoStoragePath` が存在する場合は `images.edits` が呼ばれ、存在しない場合は `images.generate` が呼ばれること
    - テストファイル: `packages/backend/src/services/__tests__/illustration-engine-photo.test.ts`
    - **Validates: Requirements 3.1, 3.2**
  - [ ]* 6.3 写真参照プロンプト内容のプロパティテストを作成する
    - **Property 5: 写真参照プロンプトの内容**
    - `buildPhotoReferencePrompt` が生成するプロンプトに外見的特徴反映の指示文が含まれること
    - テストファイル: `packages/backend/src/services/__tests__/illustration-engine-photo.test.ts`
    - **Validates: Requirements 3.3**
  - [ ]* 6.4 全ページで同一参照画像使用のプロパティテストを作成する
    - **Property 6: 全ページで同一参照画像の使用**
    - N ページの絵本生成で、全 N 回の `images.edits` 呼び出しに同一の写真バッファが渡されること
    - テストファイル: `packages/backend/src/services/__tests__/illustration-engine-photo.test.ts`
    - **Validates: Requirements 3.4**
  - [ ]* 6.5 リトライとフォールバックのユニットテストを作成する
    - `images.edits` 失敗時の指数バックオフリトライ（1秒、2秒、4秒）の動作確認
    - リトライ後も失敗した場合の `images.generate` フォールバック動作確認
    - テストファイル: `packages/backend/src/services/__tests__/illustration-engine-photo.test.ts`
    - _Requirements: 3.5, 3.6_

- [x] 7. API ルートの実装
  - [x] 7.1 `multer` パッケージをバックエンドの依存関係に追加する
    - `multer` と `@types/multer` をインストール
    - メモリストレージを使用する multer インスタンスを設定
    - _Requirements: 1.1_
  - [x] 7.2 `packages/backend/src/routes/profiles.ts` の `POST /api/profiles` を `multipart/form-data` 対応に変更する
    - multer ミドルウェアで `photo` フィールドを受け取る
    - 写真がある場合: バリデーション → コンテンツチェック → Storage 保存 → プロフィール作成
    - 写真がない場合: 従来どおりプロフィール作成
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4_
  - [x] 7.3 `PUT /api/profiles/:id/photo` と `DELETE /api/profiles/:id/photo` エンドポイントを追加する
    - PUT: 写真の差し替え（旧写真削除 → 新写真アップロード）
    - DELETE: 写真の削除（Storage 削除 + プロフィール更新）
    - _Requirements: 5.1, 5.2, 5.4_
  - [x] 7.4 `packages/backend/src/routes/books.ts` の絵本生成フローで `photoStoragePath` を `generateForPage` に渡すように変更する
    - プロフィールから `photoStoragePath` を取得し、`generateForPage` の options に渡す
    - _Requirements: 3.1, 3.2, 3.4_
  - [ ]* 7.5 写真差し替え時の旧写真削除のプロパティテストを作成する
    - **Property 8: 写真差し替え時の旧写真削除**
    - 新しい写真をアップロードすると旧写真が削除され、新しい写真のみが存在すること
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 5.1**
  - [ ]* 7.6 写真削除ラウンドトリップのプロパティテストを作成する
    - **Property 9: 写真削除ラウンドトリップ**
    - 写真削除後に Storage からファイルが削除され、photoUrl と photoStoragePath が null になること
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 5.2**
  - [ ]* 7.7 プロフィール削除時の写真カスケード削除のプロパティテストを作成する
    - **Property 10: プロフィール削除時の写真カスケード削除**
    - プロフィール削除時に関連する写真も Storage から削除されること
    - テストファイル: `packages/backend/src/services/__tests__/photo-upload-service.test.ts`
    - **Validates: Requirements 5.3**

- [x] 8. チェックポイント - バックエンド全体の確認
  - すべてのテストが通ることを確認し、不明点があればユーザーに質問する。

- [x] 9. フロントエンド写真アップロードUIの実装
  - [x] 9.1 `packages/frontend/src/components/PhotoUploadArea.tsx` コンポーネントを新規作成する
    - ファイル選択領域（ドラッグ&ドロップ対応は任意）
    - 選択された画像のプレビュー表示
    - 写真削除ボタン
    - アップロード中インジケーター表示
    - エラーメッセージ表示
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x] 9.2 `packages/frontend/src/api/client.ts` に `postFormData` メソッドを追加する
    - `FormData` を `multipart/form-data` として送信するメソッド
    - `Content-Type` ヘッダーを設定しない（ブラウザが自動設定）
    - _Requirements: 1.1_
  - [x] 9.3 `packages/frontend/src/pages/ProfileFormPage.tsx` を写真アップロード対応に変更する
    - `PhotoUploadArea` コンポーネントを統合
    - `FormData` でプロフィールデータと写真を送信するように `handleSubmit` を変更
    - 写真は任意項目として扱う
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 9.4 `PhotoUploadArea` のユニットテストを作成する
    - プレビュー表示、削除ボタン表示、アップロードインジケーター表示のテスト
    - テストファイル: `packages/frontend/src/components/__tests__/PhotoUploadArea.test.tsx`
    - _Requirements: 2.2, 2.3, 2.5_

- [x] 10. 最終チェックポイント - 全体統合確認
  - すべてのテストが通ることを確認し、不明点があればユーザーに質問する。

## 備考

- `*` マーク付きのタスクはオプションであり、MVP のためにスキップ可能
- 各タスクは具体的な要件への参照を含み、トレーサビリティを確保
- チェックポイントで段階的な検証を実施
- プロパティテストは設計ドキュメントの正確性プロパティに基づいて実装
- ユニットテストは特定のエッジケースとエラー条件を検証
