---
inclusion: fileMatch
fileMatchPattern: "**/*.tsx"
---

# React 開発ルール

## StrictMode 二重実行対策（必須）

React の StrictMode は開発時に `useEffect` を2回実行する。
副作用のあるAPIリクエスト（POST等）を `useEffect` 内で発火する場合、`useRef` ガードで重複実行を防ぐこと。

### 重要: サーバーサイド冪等性（idempotency）パターン

POST リクエストで StrictMode の二重実行を安全に処理するには、サーバーサイドの冪等性キーを使う。

1. フロントエンド: `useRef(crypto.randomUUID())` で安定した `requestId` を生成し、POST body に含める
2. バックエンド: `requestId` をキーにした `Map` で処理中のリクエストを追跡。同じ `requestId` の2回目のリクエストは既存の SSE ストリームに合流させる
3. cleanup で `startedRef = false` にリセットしても安全（サーバーが重複を弾くため）
4. リトライ時は `requestIdRef.current = crypto.randomUUID()` で新しい ID を発行

```tsx
// ✅ 正しいパターン（冪等性キー付き）
const startedRef = useRef(false);
const requestIdRef = useRef<string>(crypto.randomUUID());

const doRequest = useCallback(async () => {
  if (startedRef.current) return;
  startedRef.current = true;
  // ... fetch POST with body: { ...data, requestId: requestIdRef.current }
}, [deps]);

useEffect(() => {
  doRequest();
  return () => {
    abortRef.current?.abort();
    startedRef.current = false; // 安全にリセット可能
  };
}, [doRequest]);

// リトライ時は新しい requestId を発行
onClick={() => {
  requestIdRef.current = crypto.randomUUID();
  startedRef.current = false;
  doRequest();
}}
```

### 重要: POST リクエストの場合は cleanup で startedRef をリセットしてはいけない（冪等性キーがない場合）

`abort()` はクライアント側の fetch をキャンセルするが、サーバー側ではリクエストが既に受理されて処理が始まっている。
cleanup で `startedRef = false` にすると、StrictMode の2回目マウントで再度 POST が飛び、サーバー上に重複データが作成される。

```tsx
// ✅ 正しいパターン（POST でサーバーリソースを作成する場合）
const startedRef = useRef(false);
const abortRef = useRef<AbortController | null>(null);

const doRequest = useCallback(async () => {
  if (startedRef.current) return;  // 二重実行を防止
  startedRef.current = true;
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  // ... fetch POST with signal: controller.signal ...
}, [deps]);

useEffect(() => {
  doRequest();
  return () => {
    abortRef.current?.abort();
    // ★ startedRef をリセットしない！リセットすると2回目のマウントで再度POSTが飛ぶ
  };
}, [doRequest]);

// リトライ時のみリセット
onClick={() => {
  startedRef.current = false;
  doRequest();
}}
```

### StrictMode の動作順序と問題

1. 1回目マウント → `doRequest()` → `startedRef = true` → fetch POST → サーバーで処理開始
2. cleanup実行 → `abort()` でクライアント側キャンセル（サーバーは処理続行中）
3. 2回目マウント → `doRequest()` → `startedRef` が false だと再度 POST → サーバーで2つ目の処理開始

```tsx
// ❌ ダメなパターン1（cleanup で startedRef をリセット → 重複POST）
useEffect(() => {
  doRequest();
  return () => {
    abortRef.current?.abort();
    startedRef.current = false;  // これが原因で2回目のPOSTが飛ぶ
  };
}, [doRequest]);

// ❌ ダメなパターン2（abort だけでは二重リクエストを防げない）
const doRequest = useCallback(async () => {
  abortRef.current?.abort();
  const controller = new AbortController();
  // ... fetch POST ... → サーバー側では1回目のリクエストが既に処理開始済み
}, [deps]);
```

### GET リクエストの場合

GET（読み取り専用）の場合は cleanup で abort するだけで十分。startedRef ガードは不要。

```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal }).then(...);
  return () => controller.abort();
}, [url]);
```

## コード重複の防止

- 同じ変数宣言（`const x = ...`）を連続で書かない。
- `strReplace` で編集する際、置換前後で行が重複していないか必ず確認する。
