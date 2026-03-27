# Implementation Plan: イラスト一貫性向上

## 概要

ストーリー生成後にサブキャラクターの外見定義（AppearanceDefinition）とシーンの背景描写（SceneDefinition）を自動生成し、全ページのイラスト生成プロンプトに注入することで、絵本全体の視覚的一貫性を確保する。既存の generate / generate-multi フローを拡張し、Graceful Degradation により失敗時も現状と同等の動作を維持する。

## Tasks

- [x] 1. 型定義とスキーマの拡張（packages/shared）
  - [x] 1.1 AppearanceDefinition と SceneDefinition の型定義を追加
    - `packages/shared/src/types.ts` に `AppearanceDefinition` インターフェース（role, name, hairStyle, hairColor, clothing, bodyType, ageGroup, distinguishingFeatures）を追加
    - `SceneDefinition` インターフェース（sceneId, locationName, keyElements, colorPalette, lighting, atmosphere）を追加
    - `PageSceneMapping` 型（`Record<number, string>`）を追加
    - _Requirements: 5.1, 5.2, 5.5_
  - [x] 1.2 TemplateRole に characterType フィールドを追加
    - `packages/shared/src/types.ts` の `TemplateRole` インターフェースに `characterType?: 'registered' | 'auto_generated'` を追加
    - _Requirements: 5.3_
  - [x] 1.3 SSE 進捗イベント型に consistency イベントを追加
    - `ProgressEvent` と `MultiProgressEvent` に `{ type: 'consistency_generating' }` と `{ type: 'consistency_complete' }` を追加
    - _Requirements: 7.1, 7.2_
  - [x] 1.4 CreateTemplateSchema に characterType バリデーションを追加
    - `packages/shared/src/schemas.ts` に `CharacterTypeSchema = z.enum(['registered', 'auto_generated'])` を追加
    - `CreateTemplateSchema` の roles 配列内オブジェクトに `characterType: CharacterTypeSchema.optional().default('registered')` を追加
    - _Requirements: 5.4, 1.1, 1.5_
  - [ ]* 1.5 Property 1 のプロパティテスト: characterType のラウンドトリップとデフォルト値
    - **Property 1: characterType のラウンドトリップとデフォルト値**
    - ランダムな characterType 値（"registered" / "auto_generated" / undefined）でテンプレートロールを作成し、デフォルト値 "registered" が適用されること、指定値が保持されることを検証
    - **Validates: Requirements 1.1, 1.4**
  - [ ]* 1.6 Property 3 のプロパティテスト: characterType バリデーション
    - **Property 3: characterType バリデーション**
    - ランダムな文字列を characterType に指定し、"registered" / "auto_generated" 以外の値が拒否されることを検証
    - **Validates: Requirements 1.5, 5.4**

- [x] 2. Checkpoint - 型定義とスキーマの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Sub_Character_Generator の実装
  - [x] 3.1 sub-character-generator.ts の作成
    - `packages/backend/src/services/sub-character-generator.ts` を新規作成
    - `generateAppearances(input, openaiClient?)` 関数を実装: ストーリーテキストと auto_generated ロール一覧を受け取り、GPT-4o で各ロールの AppearanceDefinition を生成
    - GPT-4o に JSON 形式（response_format: json_object）で出力させ、パース処理を実装
    - ストーリーテキスト内のキャラクター描写と矛盾しない定義を生成するプロンプトを構築
    - エラー時は空の Map を返す（Graceful Degradation）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_
  - [ ]* 3.2 sub-character-generator のユニットテスト
    - `packages/backend/src/services/__tests__/sub-character-generator.test.ts` を作成
    - GPT-4o レスポンスのパース、不完全なレスポンスの処理、空ロールリストの処理をテスト
    - _Requirements: 2.1, 2.2, 2.6_
  - [ ]* 3.3 Property 4 のプロパティテスト: サブキャラクター外見定義の完全性
    - **Property 4: サブキャラクター外見定義の完全性**
    - ランダムなストーリーテキストと auto_generated ロールリストに対して、generateAppearances が各ロールの AppearanceDefinition を返し、全フィールドが非空文字列であることを検証
    - **Validates: Requirements 2.1, 2.2**

- [x] 4. Scene_Extractor の実装
  - [x] 4.1 scene-extractor.ts の作成
    - `packages/backend/src/services/scene-extractor.ts` を新規作成
    - `extractScenes(input, openaiClient?)` 関数を実装: ストーリーテキストを受け取り、ユニークなシーンを識別して SceneDefinition を生成し、pageSceneMapping を返す
    - GPT-4o に JSON 形式（response_format: json_object）で出力させ、パース処理を実装
    - 同一場所が複数ページに登場する場合、同一の sceneId を付与
    - エラー時は空の scenes 配列と空の pageSceneMapping を返す（Graceful Degradation）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 4.2 scene-extractor のユニットテスト
    - `packages/backend/src/services/__tests__/scene-extractor.test.ts` を作成
    - GPT-4o レスポンスのパース、pageSceneMapping の整合性、不完全なレスポンスの処理をテスト
    - _Requirements: 3.1, 3.2, 3.5, 3.6_
  - [ ]* 4.3 Property 6 のプロパティテスト: シーン抽出の完全性とマッピング
    - **Property 6: シーン抽出の完全性とマッピング**
    - ランダムな N ページのストーリーに対して、extractScenes が返す pageSceneMapping が 1〜N の全ページ番号をキーとして含み、各値が scenes 内の sceneId と一致し、各 SceneDefinition の全フィールドが非空文字列であることを検証
    - **Validates: Requirements 3.1, 3.2, 3.5**
  - [ ]* 4.4 Property 7 のプロパティテスト: 同一シーンのマッピング一貫性
    - **Property 7: 同一シーンのマッピング一貫性**
    - ランダムな pageSceneMapping に対して、同一 sceneId にマッピングされた複数ページが同一の SceneDefinition を使用することを検証
    - **Validates: Requirements 3.4**

- [x] 5. Checkpoint - Sub_Character_Generator と Scene_Extractor の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Illustration_Engine のプロンプト拡張
  - [x] 6.1 buildPhotoReferencePrompt に SceneDefinition 注入を追加
    - `packages/backend/src/services/illustration-engine.ts` の `buildPhotoReferencePrompt` を拡張し、`SceneDefinition` が提供された場合に "SCENE DEFINITION" セクションをプロンプトに追加
    - `generateForPage` の options に `sceneDefinition?: SceneDefinition` を追加
    - _Requirements: 4.2, 4.5_
  - [x] 6.2 buildMultiCharacterPrompt に AppearanceDefinition と SceneDefinition 注入を追加
    - `buildMultiCharacterPrompt` を拡張し、auto_generated キャラクターの AppearanceDefinition を "AUTO-GENERATED CHARACTER APPEARANCES" セクションとしてプロンプトに追加
    - SceneDefinition を "SCENE DEFINITION" セクションとしてプロンプトに追加
    - `generateForPageMultiCharacter` の options に `autoGeneratedAppearances?: Map<string, AppearanceDefinition>` と `sceneDefinition?: SceneDefinition` を追加
    - 既存の Registered_Character の処理（写真参照・キャラクターシート参照）は変更しない
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 6.3 Property 8 のプロパティテスト: イラストプロンプトへの定義注入
    - **Property 8: イラストプロンプトへの定義注入**
    - ランダムな AppearanceDefinition と SceneDefinition でプロンプトを構築し、各フィールド値がプロンプトに含まれ、"AUTO-GENERATED CHARACTER" と "SCENE DEFINITION" のヘッダーで区別されていることを検証
    - **Validates: Requirements 4.1, 4.2, 4.5**
  - [ ]* 6.4 Property 9 のプロパティテスト: 登録キャラクターと自動生成キャラクターの混在プロンプト
    - **Property 9: 登録キャラクターと自動生成キャラクターの混在プロンプト**
    - Registered_Character（写真参照あり）と Auto_Generated_Character（AppearanceDefinition あり）の両方が登場するページで、プロンプトが両方の情報を含むことを検証
    - **Validates: Requirements 4.4**
  - [ ]* 6.5 Property 5 のプロパティテスト: サブキャラクター外見定義のページ間一貫性
    - **Property 5: サブキャラクター外見定義のページ間一貫性**
    - 同一サブキャラクターが複数ページに登場する場合、全ページで同一の AppearanceDefinition がプロンプトに注入されることを検証
    - **Validates: Requirements 2.5**

- [x] 7. Checkpoint - Illustration_Engine 拡張の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Books_Router の生成フロー統合
  - [x] 8.1 generate-multi フローに Sub_Character_Generator と Scene_Extractor を統合
    - `packages/backend/src/routes/books.ts` の `generate-multi` ハンドラを拡張
    - ストーリー生成完了後、テンプレートの roles から `characterType === 'auto_generated'`（または characterType 未指定でないロール）を抽出
    - SSE: `consistency_generating` イベントを送信
    - Sub_Character_Generator と Scene_Extractor を `Promise.all` で並列実行
    - SSE: `consistency_complete` イベントを送信
    - 生成された AppearanceDefinition と SceneDefinition（+ pageSceneMapping）を後続のイラスト生成ステップに渡す
    - 失敗時はログ記録し、定義なしでイラスト生成を続行（Graceful Degradation）
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 7.3, 7.4_
  - [x] 8.2 generate フローに Scene_Extractor を統合
    - `packages/backend/src/routes/books.ts` の `generate` ハンドラを拡張
    - ストーリー生成完了後、SSE: `consistency_generating` イベントを送信
    - Scene_Extractor を実行
    - SSE: `consistency_complete` イベントを送信
    - 生成された SceneDefinition（+ pageSceneMapping）を後続のイラスト生成ステップに渡す
    - 失敗時はログ記録し、定義なしでイラスト生成を続行
    - _Requirements: 6.2, 6.3, 6.4, 6.6, 7.3, 7.4_
  - [x] 8.3 generate-multi フローの characterType に基づくキャラクター割り当てバリデーション拡張
    - `characterType === 'auto_generated'` のロールはキャラクター割り当てを要求しない
    - `characterType === 'registered'`（またはデフォルト）の必須ロールのみ割り当てを検証
    - _Requirements: 1.2, 1.3_
  - [ ]* 8.4 Property 2 のプロパティテスト: characterType に基づくキャラクター割り当て要否
    - **Property 2: characterType に基づくキャラクター割り当て要否**
    - ランダムなテンプレート（registered / auto_generated ロール混在）とキャラクター割り当てマップで、registered の必須ロール未割り当て時にエラー、auto_generated ロール未割り当て時に成功することを検証
    - **Validates: Requirements 1.2, 1.3**

- [x] 9. フロントエンドの SSE イベント対応
  - [x] 9.1 GeneratingPage に consistency イベントハンドリングを追加
    - `packages/frontend/src/pages/GeneratingPage.tsx` の `handleEvent` に `consistency_generating` と `consistency_complete` のケースを追加
    - `GeneratingState` の status に `'consistency'` を追加
    - `computePercent` と `computeLabel` を更新（consistency ステップの進捗表示）
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 9.2 MultiGeneratingPage に consistency イベントハンドリングを追加
    - `packages/frontend/src/pages/MultiGeneratingPage.tsx` の `handleEvent` に `consistency_generating` と `consistency_complete` のケースを追加
    - `GeneratingState` の status に `'consistency'` を追加
    - `computePercent` と `computeLabel` を更新
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 10. Final checkpoint - 全テスト通過の確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Sub_Character_Generator と Scene_Extractor は Graceful Degradation 設計のため、失敗しても既存フローは中断しない
- 既存の 100 テスト（10 テストファイル）が引き続きパスすることを各チェックポイントで確認する
