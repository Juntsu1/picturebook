# Requirements Document

## Introduction

ChatStoryPage において、AIがユーザーに質問しながら絵本の要件を収集するインタビューフローを実装する。
質問には選択肢ボタンが表示され、ユーザーはボタンクリックまたは自由入力で回答できる。
質問は「かんたん作成（必須8問）」と「こだわり設定（任意14問）」の2フェーズに分かれる。
収集した回答はフロントエンドの状態として管理され、全回答完了後にバックエンドへ送信してストーリー生成に使用する。

## Glossary

- **InterviewFlow**: インタビュー形式の質問フロー全体を指す
- **InterviewQuestion**: 質問文・選択肢・項目キーを持つ1つの質問単位
- **InterviewAnswer**: ユーザーが1つの質問に対して入力した回答（選択肢またはフリーテキスト）
- **InterviewState**: 現在の質問インデックス・収集済み回答・フェーズを保持するフロントエンド状態
- **BasicPhase**: かんたん作成フェーズ（必須8問）
- **AdvancedPhase**: こだわり設定フェーズ（任意14問）
- **ChoiceButton**: 選択肢として表示されるボタンUI要素
- **ChatStoryPage**: 絵本チャット作成画面（既存コンポーネント）
- **ChatMessageList**: メッセージ一覧コンポーネント（既存、`[CHOICES: A|B|C]` 形式対応済み）
- **InterviewFlowManager**: インタビューフローの進行を管理するフロントエンドモジュール
- **StoryRequirements**: インタビューで収集した全回答をまとめたオブジェクト

---

## Requirements

### Requirement 1: インタビュー質問データの定義

**User Story:** As a 開発者, I want 質問フローをデータとして定義したい, so that 質問の追加・変更をコード変更なしに管理できる。

#### Acceptance Criteria

1. THE InterviewFlowManager SHALL かんたん作成フェーズの質問を以下の10項目の順序で保持する：対象年齢・読み方・長さ・主人公・主人公の性格・舞台・テーマ・主人公の願い・困りごと・終わり方
2. THE InterviewFlowManager SHALL こだわり設定フェーズの質問を以下の14項目の順序で保持する：登場人物の数・雰囲気・現実感・物語の型・セリフ量・繰り返し表現・オノマトペ・入れたいモチーフ・避けたい要素・季節・時間帯・学び要素・主人公の名前・言葉のやさしさ
3. THE InterviewFlowManager SHALL 各質問に対して、項目キー・質問文・選択肢の配列を保持する
4. WHEN 選択肢が複数選択可能な項目（入れたいモチーフ・避けたい要素）である場合, THE InterviewFlowManager SHALL その質問に `multiSelect: true` フラグを保持する

### Requirement 2: かんたん作成フェーズの進行

**User Story:** As a ユーザー, I want AIから順番に質問されたい, so that 迷わず絵本の要件を決められる。

#### Acceptance Criteria

1. WHEN ChatStoryPage が初期化される, THE InterviewFlowManager SHALL BasicPhase の最初の質問（対象年齢）をチャットメッセージとして表示する
2. WHEN ユーザーが回答を送信する, THE InterviewFlowManager SHALL 現在の質問への回答を InterviewState に保存し、次の質問をチャットメッセージとして追加する
3. WHEN BasicPhase の全10問への回答が完了する, THE InterviewFlowManager SHALL こだわり設定フェーズへ進むか確認するメッセージを表示する
4. THE InterviewFlowManager SHALL BasicPhase の各質問メッセージを `[CHOICES: 選択肢1|選択肢2|...]` 形式で末尾に付与して送信する
5. WHEN ユーザーが ChoiceButton をクリックする, THE ChatStoryPage SHALL その選択肢テキストを回答として handleSend に渡す（既存の onChoiceSelect と同じ経路）

### Requirement 3: こだわり設定フェーズの進行

**User Story:** As a ユーザー, I want 詳細設定を任意で追加したい, so that より自分好みの絵本を作れる。

#### Acceptance Criteria

1. WHEN ユーザーがこだわり設定フェーズへの進行を選択する, THE InterviewFlowManager SHALL AdvancedPhase の最初の質問（登場人物の数）を表示する
2. WHEN ユーザーがこだわり設定フェーズをスキップすることを選択する, THE InterviewFlowManager SHALL AdvancedPhase をスキップしてストーリー生成確認メッセージを表示する
3. WHEN AdvancedPhase の全14問への回答が完了する, THE InterviewFlowManager SHALL ストーリー生成確認メッセージを表示する
4. THE InterviewFlowManager SHALL こだわり設定フェーズへの進行確認メッセージに `[CHOICES: こだわり設定をする|スキップしてストーリーを作る]` を付与する

### Requirement 4: 複数選択対応

**User Story:** As a ユーザー, I want 複数の選択肢を選びたい, so that 「入れたいモチーフ」や「避けたい要素」を細かく指定できる。

#### Acceptance Criteria

1. WHEN `multiSelect: true` の質問が表示される, THE ChatMessageList SHALL 選択肢ボタンを複数選択可能なトグルとして表示する
2. WHEN ユーザーが複数選択質問で選択肢をクリックする, THE ChatMessageList SHALL 選択済みの選択肢をビジュアル的に区別して表示する（選択済みは塗りつぶしスタイル）
3. WHEN `multiSelect: true` の質問が表示される, THE ChatMessageList SHALL 「決定する」ボタンを表示し、クリック時に選択済み項目をカンマ区切りで onChoiceSelect に渡す
4. IF ユーザーが複数選択質問で何も選択せずに「決定する」をクリックする, THEN THE ChatMessageList SHALL 「決定する」ボタンを無効化して送信を防ぐ

### Requirement 5: フリーテキスト入力との共存

**User Story:** As a ユーザー, I want 選択肢にない回答を自由に入力したい, so that 「その他」の内容を具体的に伝えられる。

#### Acceptance Criteria

1. WHILE インタビューフローが進行中である, THE ChatInput SHALL 常に有効な状態を保ち、ユーザーがフリーテキストを入力できる
2. WHEN ユーザーがフリーテキストを送信する, THE InterviewFlowManager SHALL そのテキストを現在の質問への回答として扱い、次の質問へ進む
3. WHEN ユーザーが「その他」ChoiceButton をクリックする, THE ChatStoryPage SHALL 「その他」を回答として送信し、次の質問へ進む（追加入力は求めない）

### Requirement 6: InterviewState の管理

**User Story:** As a 開発者, I want 回答状態をフロントエンドで管理したい, so that バックエンドへの不要なリクエストを減らせる。

#### Acceptance Criteria

1. THE InterviewFlowManager SHALL InterviewState として `{ phase: 'basic' | 'advanced' | 'complete', currentIndex: number, answers: Record<string, string> }` を管理する
2. WHEN ユーザーが回答を送信する, THE InterviewFlowManager SHALL `answers` に `{ [questionKey]: answerText }` の形式で回答を追記する
3. WHEN 全フェーズが完了する, THE InterviewFlowManager SHALL `phase` を `'complete'` に更新する
4. THE InterviewFlowManager SHALL InterviewState を React の useState で管理し、コンポーネント外部への副作用なしに状態遷移を行う

### Requirement 7: ストーリー生成への回答引き渡し

**User Story:** As a システム, I want 収集した回答をストーリー生成に使いたい, so that ユーザーの要件を反映した絵本が生成される。

#### Acceptance Criteria

1. WHEN インタビューが完了し、ユーザーがストーリー生成を確認する, THE ChatStoryPage SHALL StoryRequirements オブジェクトをシステムプロンプトまたはユーザーメッセージとしてバックエンドへ送信する
2. THE ChatStoryPage SHALL StoryRequirements を人間が読みやすい日本語テキスト形式に変換してからバックエンドへ送信する
3. WHEN バックエンドがストーリー生成リクエストを受信する, THE chat-story-service SHALL 既存の SSE ストリーミング経路でストーリーを生成して返す

### Requirement 8: 既存チャット機能との統合

**User Story:** As a ユーザー, I want インタビュー完了後もチャットで修正できたい, so that 生成されたストーリーを自由に調整できる。

#### Acceptance Criteria

1. WHEN インタビューフェーズが `'complete'` になる, THE ChatStoryPage SHALL 既存の自由チャットモードへ移行し、AIとの通常の会話が可能になる
2. WHEN インタビューフェーズが `'complete'` になる, THE ChatStoryPage SHALL 「ストーリーを完成させる」ボタンを有効化する
3. WHILE インタビューフェーズが `'basic'` または `'advanced'` である, THE ChatStoryPage SHALL 「ストーリーを完成させる」ボタンを無効化する
4. THE ChatStoryPage SHALL インタビューフロー中のメッセージを既存の ChatMessage 型で管理し、ChatMessageList で表示する
