---
inclusion: auto
---

# プロジェクト既知の問題と制約

## 環境情報

- 企業プロキシ: `http://zia01.sojitz.com:10464` (Zscaler)
- Firebase プロジェクト: `project-imadoco`
- OpenAI SDK: v6.32.0
- 画像生成モデル: `gpt-image-1.5`
- ストーリー生成モデル: `gpt-4o`

## OpenAI API の制約

### gpt-image-1.5 の images.edit

- `image` に配列を渡す場合、`mask` パラメータは使用不可（"mask size does not match image size" エラーになる）
- 写真の同一性を強化するには、同じ写真を2枚 `image` 配列に渡す（mask なし）
- キャラクターシート方式: `[characterSheet, originalPhoto]` を渡して一貫性を保つ

### GPT-4o Vision の子供写真分析

- GPT-4o は子供の写真の外見記述を拒否することがある（"I'm sorry, I can't help with that"）
- 拒否された場合は空文字を返してキャラクターシートだけで対応する（エラーにしない）

## プロキシ環境での注意点

### FormData のプロキシ通過

- `openai.ts` の `proxyFetch` で `FormData` は `Request` 経由で変換し、`Content-Type` の boundary を正しく伝播させる必要がある
- `bodyToBuffer()` だけでは `Content-Type` ヘッダーの boundary が失われる

### SSE (Server-Sent Events) のバッファリング

- プロキシ環境では SSE レスポンスがバッファリングされ、フロントエンドにイベントが届かないことがある
- `res.flushHeaders()` を必ず呼ぶ
- 各 `res.write()` の後に明示的にフラッシュが必要な場合がある

## React フロントエンドの注意点

- StrictMode 二重実行対策は `react-patterns.md` を参照
- SSE 接続が「接続中...」で止まる場合、サーバー側のログを確認してバックエンド処理が進んでいるか切り分ける
- フロントが止まっているのにバックエンドが動いている場合 → SSE バッファリング問題
- バックエンドも止まっている場合 → プロキシ接続やAPI呼び出しの問題

## ストーリー生成の outfit ルール

- 各ページに `outfit` フィールド（英語）を含める
- 着替える必然性がないシーンでは前ページと完全に同じ文字列をコピー
- outfit にはトップス（色・襟・袖）、ボトムス（色・丈）、靴（色・種類）を含める
