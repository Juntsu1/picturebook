# Requirements Document

## Introduction

イラストの一貫性を向上させる機能。現在、ユーザーが事前登録していないサブキャラクター（友達、先生、動物など）やシーン（場所・背景）がページごとに異なる外見・描写で生成されてしまう問題を解決する。ストーリー生成後にサブキャラクターの外見定義とシーンの背景描写を自動生成し、全ページのイラスト生成プロンプトに注入することで、絵本全体の視覚的一貫性を確保する。

## Glossary

- **Story_Engine**: ストーリーテキストを生成するバックエンドサービス（story-engine.ts）
- **Illustration_Engine**: イラスト画像を生成するバックエンドサービス（illustration-engine.ts）
- **Template_Service**: ストーリーテンプレートを管理するバックエンドサービス（template-service.ts）
- **Character_Service**: ユーザー登録キャラクターを管理するバックエンドサービス（character-service.ts）
- **Books_Router**: 絵本生成フローを制御するルートハンドラ（books.ts）
- **TemplateRole**: テンプレート内のロール定義（役割名、ラベル、必須フラグを持つ）
- **Sub_Character_Generator**: ストーリー生成後にサブキャラクターの外見定義を自動生成するモジュール
- **Scene_Extractor**: ストーリーテキストからシーン（場所・背景）情報を抽出・定義するモジュール
- **Appearance_Definition**: サブキャラクターの外見を記述した構造化データ（髪型、服装、体型、特徴など）
- **Scene_Definition**: シーンの背景描写を記述した構造化データ（場所名、家具、色調、雰囲気など）
- **Registered_Character**: ユーザーが写真・キャラクターシート付きで事前登録したキャラクター
- **Auto_Generated_Character**: システムが外見定義を自動生成するサブキャラクター

## Requirements

### Requirement 1: テンプレートロールのキャラクタータイプ選択

**User Story:** As a テンプレート作成者, I want 各ロールに「ユーザー登録キャラクターを使う」か「自動生成サブキャラクターを使う」かを指定できるようにしたい, so that ストーリーに登場する全キャラクターの管理方法を明確に定義できる

#### Acceptance Criteria

1. THE Template_Service SHALL TemplateRole に characterType フィールド（"registered" または "auto_generated"）を持つ拡張されたロール定義をサポートする
2. WHEN characterType が "registered" のロールに対してキャラクター割り当てが行われる場合, THE Books_Router SHALL 既存のユーザー登録キャラクター（写真・キャラクターシート付き）を使用する
3. WHEN characterType が "auto_generated" のロールが存在する場合, THE Books_Router SHALL そのロールに対してユーザーによるキャラクター割り当てを要求しない
4. WHEN characterType が指定されていないロールが存在する場合, THE Template_Service SHALL デフォルト値として "registered" を適用する
5. THE Template_Service SHALL characterType フィールドのバリデーションを行い、"registered" または "auto_generated" 以外の値を拒否する

### Requirement 2: サブキャラクター外見定義の自動生成

**User Story:** As a 絵本生成システム, I want ストーリー生成後にサブキャラクターの外見定義を自動生成したい, so that 全ページで同じサブキャラクターが一貫した外見で描かれる

#### Acceptance Criteria

1. WHEN Story_Engine がストーリーテキストを生成完了した後, THE Sub_Character_Generator SHALL auto_generated タイプの各ロールに対して Appearance_Definition を生成する
2. THE Sub_Character_Generator SHALL 各 Appearance_Definition に髪型、髪色、服装、体型、年齢層、特徴的な外見要素を含める
3. THE Sub_Character_Generator SHALL Appearance_Definition をイラスト生成モデルが解釈しやすい英語の構造化テキストとして出力する
4. THE Sub_Character_Generator SHALL ストーリーテキスト内のキャラクター描写と矛盾しない Appearance_Definition を生成する
5. WHEN 同一のサブキャラクターが複数ページに登場する場合, THE Illustration_Engine SHALL 全ページで同一の Appearance_Definition を使用する
6. IF Sub_Character_Generator が Appearance_Definition の生成に失敗した場合, THEN THE Books_Router SHALL エラーをログに記録し、Appearance_Definition なしでイラスト生成を続行する

### Requirement 3: シーン（場所・背景）定義の自動抽出

**User Story:** As a 絵本生成システム, I want ストーリーからシーン情報を自動抽出して詳細な背景描写を定義したい, so that 同じ場所が再登場する時に一貫した背景が描かれる

#### Acceptance Criteria

1. WHEN Story_Engine がストーリーテキストを生成完了した後, THE Scene_Extractor SHALL 各ページのシーン（場所）を識別し、ユニークなシーンのリストを生成する
2. THE Scene_Extractor SHALL 各 Scene_Definition に場所名、主要な構成要素（家具、植物、建物など）、色調、照明、雰囲気を含める
3. THE Scene_Extractor SHALL Scene_Definition をイラスト生成モデルが解釈しやすい英語の構造化テキストとして出力する
4. WHEN 同一のシーンが複数ページに登場する場合, THE Scene_Extractor SHALL 同一の Scene_Definition を各ページにマッピングする
5. THE Scene_Extractor SHALL 各ページに対して使用する Scene_Definition の識別子を返す
6. IF Scene_Extractor がシーン抽出に失敗した場合, THEN THE Books_Router SHALL エラーをログに記録し、Scene_Definition なしでイラスト生成を続行する

### Requirement 4: イラスト生成プロンプトへの定義注入

**User Story:** As a 絵本生成システム, I want サブキャラクターの外見定義とシーン定義をイラスト生成プロンプトに注入したい, so that 生成されるイラストが全ページで視覚的に一貫する

#### Acceptance Criteria

1. WHEN イラスト生成プロンプトを構築する際, THE Illustration_Engine SHALL そのページに登場する auto_generated キャラクターの Appearance_Definition をプロンプトに含める
2. WHEN イラスト生成プロンプトを構築する際, THE Illustration_Engine SHALL そのページに対応する Scene_Definition をプロンプトに含める
3. THE Illustration_Engine SHALL Registered_Character の既存の処理（写真参照・キャラクターシート参照）を変更せずに維持する
4. WHEN 1ページに Registered_Character と Auto_Generated_Character の両方が登場する場合, THE Illustration_Engine SHALL 両方のキャラクター情報をプロンプトに統合する
5. THE Illustration_Engine SHALL Appearance_Definition と Scene_Definition をプロンプト内で明確に区別されたセクションとして配置する

### Requirement 5: 型定義とスキーマの拡張

**User Story:** As a 開発者, I want 新しいデータ構造の型定義とバリデーションスキーマを整備したい, so that サブキャラクター定義とシーン定義が型安全に扱える

#### Acceptance Criteria

1. THE shared types SHALL Appearance_Definition の型定義（髪型、髪色、服装、体型、年齢層、特徴を含む）を提供する
2. THE shared types SHALL Scene_Definition の型定義（場所名、構成要素、色調、照明、雰囲気を含む）を提供する
3. THE shared types SHALL TemplateRole の characterType フィールド（"registered" | "auto_generated"）を含む拡張型定義を提供する
4. THE shared schemas SHALL characterType フィールドのバリデーションルールを含む拡張された CreateTemplateSchema を提供する
5. THE shared types SHALL ページごとのシーンマッピング（pageNumber から Scene_Definition 識別子への対応）の型定義を提供する

### Requirement 6: 生成フローの統合

**User Story:** As a 絵本生成システム, I want サブキャラクター定義とシーン定義の生成を既存の絵本生成フローに統合したい, so that ユーザーが追加操作なしで一貫性のあるイラストを得られる

#### Acceptance Criteria

1. WHEN マルチキャラクター絵本生成フロー（generate-multi）が実行される場合, THE Books_Router SHALL ストーリー生成完了後かつイラスト生成開始前に Sub_Character_Generator と Scene_Extractor を実行する
2. WHEN シングルキャラクター絵本生成フロー（generate）が実行される場合, THE Books_Router SHALL ストーリー生成完了後かつイラスト生成開始前に Scene_Extractor を実行する
3. THE Books_Router SHALL サブキャラクター定義生成とシーン抽出の進捗を SSE イベントとしてクライアントに通知する
4. WHEN Sub_Character_Generator または Scene_Extractor の処理が完了した場合, THE Books_Router SHALL 生成された定義を後続のイラスト生成ステップに渡す
5. THE Books_Router SHALL サブキャラクター定義生成とシーン抽出を並列に実行する
6. IF サブキャラクター定義生成またはシーン抽出が失敗した場合, THEN THE Books_Router SHALL 絵本生成フロー全体を中断せず、定義なしでイラスト生成を続行する

### Requirement 7: SSE 進捗イベントの拡張

**User Story:** As a フロントエンドアプリケーション, I want サブキャラクター定義生成とシーン抽出の進捗を受信したい, so that ユーザーに生成プロセスの詳細な進捗を表示できる

#### Acceptance Criteria

1. THE shared types SHALL ProgressEvent と MultiProgressEvent に "consistency_generating"（サブキャラクター定義・シーン定義生成中）イベントタイプを追加する
2. THE shared types SHALL ProgressEvent と MultiProgressEvent に "consistency_complete"（サブキャラクター定義・シーン定義生成完了）イベントタイプを追加する
3. WHEN Sub_Character_Generator と Scene_Extractor の処理が開始された場合, THE Books_Router SHALL "consistency_generating" イベントを送信する
4. WHEN Sub_Character_Generator と Scene_Extractor の処理が完了した場合, THE Books_Router SHALL "consistency_complete" イベントを送信する
