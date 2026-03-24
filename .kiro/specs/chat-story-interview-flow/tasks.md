# Implementation Plan: chat-story-interview-flow

## Overview

フロントエンド主導のインタビューフローを ChatStoryPage に追加する。質問定数ファイル・カスタムフック・フォーマットユーティリティを新規作成し、既存の ChatMessageList と ChatStoryPage を拡張して統合する。

## Tasks

- [x] 1. 質問定数ファイルの作成
  - `packages/frontend/src/constants/interviewQuestions.ts` を新規作成する
  - `InterviewQuestion` インターフェースを定義する
  - `BASIC_QUESTIONS`（10問）を design.md の順序通りに定義する
  - `ADVANCED_QUESTIONS`（14問）を design.md の順序通りに定義する
  - `PHASE_TRANSITION_CHOICES` 定数を定義する
  - `motifs` と `avoidElements` に `multiSelect: true` を付与する
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.1 Write unit tests for interviewQuestions
    - BasicPhase が 10 問であることを検証する
    - AdvancedPhase が 14 問であることを検証する
    - `multiSelect: true` を持つ質問が `motifs` と `avoidElements` のみであることを検証する
    - 各質問が `key`・`text`・`choices` を持つことを検証する
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.2 Write property test for interviewQuestions (Property 1)
    - **Property 1: 全質問が必須フィールドを持つ**
    - **Validates: Requirements 1.3**

- [x] 2. `formatAnswers` ユーティリティの作成
  - `packages/frontend/src/utils/formatAnswers.ts` を新規作成する
  - `formatAnswersAsText(answers: Record<string, string>): string` を実装する
  - 空の answers が渡された場合はデフォルトメッセージを含む文字列を返す
  - 出力は `【絵本の要件】` ヘッダーと箇条書き形式の日本語テキストにする
  - _Requirements: 7.2_

  - [ ]* 2.1 Write property test for formatAnswers (Property 5)
    - **Property 5: formatAnswers が全回答キーを含むテキストを返す**
    - **Validates: Requirements 7.2**

- [x] 3. `useInterviewFlow` カスタムフックの作成
  - `packages/frontend/src/hooks/useInterviewFlow.ts` を新規作成する
  - `InterviewPhase`・`InterviewState`・`UseInterviewFlowReturn` 型を定義する
  - 初期状態 `{ phase: 'basic', currentIndex: 0, answers: {} }` を実装する
  - `getCurrentMessage()`: 現在の質問文に `[CHOICES: ...]` または `[MULTI_CHOICES: ...]` を付与して返す
  - `submitAnswer(answer)`: 回答を `answers` に保存し `currentIndex` をインクリメント、最終問では次フェーズへ遷移する
  - `proceedToAdvanced()`: phase を `'advanced'`、currentIndex を `0` にリセットして最初の質問メッセージを返す
  - `skipToComplete()`: phase を `'complete'` に更新する
  - BasicPhase 10問完了後にフェーズ移行確認メッセージ（`[CHOICES: こだわり設定をする|スキップしてストーリーを作る]` 付き）を返す
  - AdvancedPhase 14問完了後に phase を `'complete'` に更新する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 3.1 Write unit tests for useInterviewFlow
    - 初期状態が `{ phase: 'basic', currentIndex: 0, answers: {} }` であることを検証する
    - BasicPhase 10問完了後にフェーズ移行確認メッセージが返ることを検証する
    - フェーズ移行確認メッセージに `[CHOICES: こだわり設定をする|スキップしてストーリーを作る]` が含まれることを検証する
    - `proceedToAdvanced()` 後に phase が `'advanced'`、currentIndex が `0` になることを検証する
    - `skipToComplete()` 後に phase が `'complete'` になることを検証する
    - AdvancedPhase 14問完了後に phase が `'complete'` になることを検証する
    - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 6.1_

  - [ ]* 3.2 Write property test for useInterviewFlow (Property 2)
    - **Property 2: submitAnswer が回答を保存して次の質問へ進む**
    - **Validates: Requirements 2.2, 5.2, 6.2**

  - [ ]* 3.3 Write property test for useInterviewFlow (Property 3)
    - **Property 3: BasicPhase の全質問が [CHOICES:] 形式を含む**
    - **Validates: Requirements 2.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. `ChatMessageList` の複数選択対応
  - `packages/frontend/src/components/ChatMessageList.tsx` を修正する
  - `parseChoices` を拡張し `[MULTI_CHOICES: ...]` 形式も検出して `multiSelect: boolean` を返すようにする
  - `[MULTI_CHOICES: ...]` の場合、選択肢ボタンをトグル式（選択済みは塗りつぶしスタイル）で表示する
  - 複数選択の選択状態を `ChatMessageList` 内部の `useState` で管理する
  - 「決定する」ボタンを表示し、選択済み項目を `、` 区切りで `onChoiceSelect` に渡す
  - 何も選択していない状態では「決定する」ボタンを `disabled` にする
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 5.1 Write unit tests for ChatMessageList multiselect
    - `[MULTI_CHOICES: ...]` を含むメッセージで「決定する」ボタンが表示されることを検証する
    - 何も選択していない状態で「決定する」ボタンが disabled であることを検証する
    - 選択肢クリックで選択済みスタイルが適用されることを検証する
    - _Requirements: 4.1, 4.2, 4.4_

  - [ ]* 5.2 Write property test for ChatMessageList (Property 4)
    - **Property 4: 複数選択の決定ボタンがカンマ区切りで送信する**
    - **Validates: Requirements 4.3**

- [x] 6. `ChatStoryPage` へのインタビューフロー統合
  - `packages/frontend/src/pages/ChatStoryPage.tsx` を修正する
  - `useInterviewFlow` フックを組み込む
  - セッション作成後、バックエンドからの挨拶メッセージ取得をスキップし、`getCurrentMessage()` でインタビュー最初の質問をローカル生成してメッセージに追加する
  - `handleSend` をインタビューフェーズ中（`phase !== 'complete'`）は `submitAnswer` 経由に切り替える
    - フェーズ移行確認（`こだわり設定をする` / `スキップしてストーリーを作る`）の回答を検出して `proceedToAdvanced()` / `skipToComplete()` を呼び出す
    - `submitAnswer` が返す `nextMessage` をメッセージリストに追加する
  - `phase === 'complete'` になったら `formatAnswersAsText` でテキスト変換し、バックエンドへ送信する
  - 「ストーリーを完成させる」ボタンを `phase === 'complete'` のときのみ有効化する（`messages.length < 2` 条件を置き換える）
  - インタビューフロー中のメッセージを既存の `ChatMessage` 型で管理する
  - _Requirements: 2.1, 2.5, 3.2, 5.1, 5.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- プロパティテストには fast-check を使用する（既存の `packages/frontend` に追加が必要な場合はインストールする）
- インタビューフローはフロントエンド完結のため、バックエンドへの変更は不要
- `[MULTI_CHOICES: ...]` は `useInterviewFlow` 内で `multiSelect: true` の質問に対して付与する
