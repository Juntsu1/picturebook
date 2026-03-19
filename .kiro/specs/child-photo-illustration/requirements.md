# 要件ドキュメント

## はじめに

親が子供の写真を1枚アップロードすると、その子供の外見的特徴を反映したイラストで絵本を生成できる機能。現在のテキストプロンプトのみによるイラスト生成を拡張し、gpt-image-1.5 の `/v1/images/edits` エンドポイントを活用して、アップロードされた写真を参照画像として使用する。これにより、子供が自分自身を主人公として認識できるパーソナライズされた絵本体験を提供する。

## 用語集

- **Photo_Upload_Service**: 子供の写真のアップロード、バリデーション、Firebase Storage への保存を担当するバックエンドサービス
- **Illustration_Engine**: gpt-image-1.5 API を使用してイラストを生成するバックエンドサービス（既存の `illustration-engine.ts` を拡張）
- **Profile_Service**: 子供プロフィールの管理を担当するバックエンドサービス（既存の `profile-service.ts` を拡張）
- **Photo_Upload_Form**: 写真アップロード用のフロントエンドUIコンポーネント
- **Content_Filter**: アップロードされた画像の安全性を検証するサービス
- **参照画像**: イラスト生成時に gpt-image-1.5 の images.edits API に入力として渡す子供の写真
- **Firebase_Storage**: 画像ファイルの保存先ストレージサービス

## 要件

### 要件 1: 写真アップロード

**ユーザーストーリー:** 親として、子供の写真を1枚アップロードしたい。それにより、子供に似た登場人物が描かれた絵本を作成できるようにするため。

#### 受け入れ基準

1. WHEN 親が写真をアップロードする, THE Photo_Upload_Form SHALL JPEG、PNG、WebP 形式のファイルを受け付ける
2. WHEN 親が写真をアップロードする, THE Photo_Upload_Service SHALL ファイルサイズが 10MB 以下であることを検証する
3. IF アップロードされたファイルが許可されていない形式である, THEN THE Photo_Upload_Service SHALL 「対応していないファイル形式です。JPEG、PNG、WebP のいずれかをアップロードしてください」というエラーメッセージを返す
4. IF アップロードされたファイルが 10MB を超える, THEN THE Photo_Upload_Service SHALL 「ファイルサイズが大きすぎます。10MB以下の画像をアップロードしてください」というエラーメッセージを返す
5. WHEN 写真のバリデーションが成功する, THE Photo_Upload_Service SHALL 写真を Firebase_Storage の `users/{userId}/profiles/{profileId}/photo.png` パスに PNG 形式で保存する
6. WHEN 写真の保存が完了する, THE Profile_Service SHALL プロフィールドキュメントの `photoUrl` フィールドに Firebase_Storage の URL を記録する

### 要件 2: 写真アップロードUI

**ユーザーストーリー:** 親として、プロフィール作成画面で直感的に写真をアップロードしたい。それにより、簡単に子供の写真を登録できるようにするため。

#### 受け入れ基準

1. THE Photo_Upload_Form SHALL プロフィール作成フォーム内に写真アップロード領域を表示する
2. WHEN 親がファイルを選択する, THE Photo_Upload_Form SHALL 選択された画像のプレビューを表示する
3. WHEN 写真がアップロード済みである, THE Photo_Upload_Form SHALL 写真を削除するボタンを表示する
4. THE Photo_Upload_Form SHALL 写真のアップロードを任意項目として扱う（写真なしでもプロフィール作成を許可する）
5. WHILE 写真のアップロード処理中である, THE Photo_Upload_Form SHALL アップロード中であることを示すインジケーターを表示する

### 要件 3: 写真を参照したイラスト生成

**ユーザーストーリー:** 親として、アップロードした子供の写真に基づいたイラストが生成されてほしい。それにより、子供が自分自身を絵本の主人公として認識できるようにするため。

#### 受け入れ基準

1. WHEN プロフィールに写真が登録されている, THE Illustration_Engine SHALL gpt-image-1.5 の images.edits エンドポイントを使用し、写真を参照画像として渡してイラストを生成する
2. WHEN プロフィールに写真が登録されていない, THE Illustration_Engine SHALL 従来どおり images.generate エンドポイントを使用してテキストプロンプトのみでイラストを生成する
3. THE Illustration_Engine SHALL 参照画像を使用する場合、プロンプトに「参照画像の子供の外見的特徴を反映した絵本スタイルのキャラクターとして描く」旨の指示を含める
4. THE Illustration_Engine SHALL 絵本の全ページで同一の参照画像を使用し、キャラクターの外見的一貫性を維持する
5. IF images.edits API の呼び出しが失敗する, THEN THE Illustration_Engine SHALL 最大3回までリトライする
6. IF リトライ後も images.edits API の呼び出しが失敗する, THEN THE Illustration_Engine SHALL images.generate エンドポイントにフォールバックしてテキストプロンプトのみでイラストを生成する

### 要件 4: 写真のコンテンツ安全性検証

**ユーザーストーリー:** サービス運営者として、アップロードされた写真が適切な内容であることを確認したい。それにより、不適切な画像がシステムに保存されることを防ぐため。

#### 受け入れ基準

1. WHEN 写真がアップロードされる, THE Content_Filter SHALL アップロードされた画像の安全性を検証する
2. IF アップロードされた画像が不適切と判定される, THEN THE Photo_Upload_Service SHALL 「アップロードされた画像は使用できません。別の画像をお試しください」というエラーメッセージを返し、画像を保存しない
3. THE Content_Filter SHALL 子供の通常の写真（顔写真、全身写真、日常の写真）を適切と判定する

### 要件 5: 写真データの管理

**ユーザーストーリー:** 親として、アップロードした写真を管理したい。それにより、写真の差し替えや削除ができるようにするため。

#### 受け入れ基準

1. WHEN 親がプロフィールの写真を差し替える, THE Photo_Upload_Service SHALL 既存の写真を Firebase_Storage から削除し、新しい写真を保存する
2. WHEN 親がプロフィールの写真を削除する, THE Photo_Upload_Service SHALL Firebase_Storage から写真を削除し、プロフィールドキュメントの `photoUrl` フィールドをクリアする
3. WHEN 親がプロフィール自体を削除する, THE Profile_Service SHALL 関連する写真も Firebase_Storage から削除する
4. THE Photo_Upload_Service SHALL 認証済みユーザーのみが自身のプロフィールに紐づく写真にアクセスできるようにする
