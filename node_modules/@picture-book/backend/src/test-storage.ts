import 'dotenv/config';
import { initFirebase } from './lib/firebase.js';
import { getStorage } from 'firebase-admin/storage';

async function testStorage() {
  console.log('=== Firebase Storage アップロードテスト ===\n');

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  console.log(`FIREBASE_STORAGE_BUCKET: ${bucketName || '(未設定)'}`);

  // Initialize Firebase
  initFirebase();
  const bucket = getStorage().bucket();
  console.log(`バケット名: ${bucket.name}\n`);

  // Create a small test file
  const testData = Buffer.from('Hello from storage test! ' + new Date().toISOString());
  const testPath = 'test/upload-test.txt';

  try {
    console.log(`[1] アップロード中: ${testPath} ...`);
    const file = bucket.file(testPath);
    await file.save(testData, { metadata: { contentType: 'text/plain' } });
    console.log('[1] ✅ アップロード成功!\n');

    console.log('[2] 署名付きURL取得中...');
    const [signedUrl] = await file.getSignedUrl({
      action: 'read' as const,
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    console.log(`[2] ✅ 署名付きURL: ${signedUrl.slice(0, 100)}...\n`);

    console.log('[3] ファイル削除中...');
    await file.delete();
    console.log('[3] ✅ 削除成功!\n');

    console.log('🎉 Firebase Storage は正常に動作しています！');
  } catch (error) {
    console.error('\n❌ エラー:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.message.includes('does not exist')) {
      console.error('\n→ バケット名が間違っている可能性があります。');
      console.error('  Firebase Console → Storage でバケット名を確認してください。');
      console.error('  .env の FIREBASE_STORAGE_BUCKET を修正してください。');
    }
  }
}

testStorage();
