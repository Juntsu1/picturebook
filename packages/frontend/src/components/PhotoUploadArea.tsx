import { useRef, useState, type ChangeEvent } from 'react';
import { PHOTO_MAX_SIZE_BYTES, PHOTO_ALLOWED_MIME_TYPES } from '@picture-book/shared';

interface PhotoUploadAreaProps {
  file: File | null;
  previewUrl: string | null;
  onSelect: (file: File, previewUrl: string) => void;
  onClear: () => void;
  error?: string;
  uploading?: boolean;
}

export function PhotoUploadArea({
  file,
  previewUrl,
  onSelect,
  onClear,
  error,
  uploading = false,
}: PhotoUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState('');

  const displayError = error || localError;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setLocalError('');
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!PHOTO_ALLOWED_MIME_TYPES.includes(selected.type as typeof PHOTO_ALLOWED_MIME_TYPES[number])) {
      setLocalError('JPEG、PNG、WebP形式の画像を選択してください');
      return;
    }
    if (selected.size > PHOTO_MAX_SIZE_BYTES) {
      setLocalError('ファイルサイズは10MB以下にしてください');
      return;
    }

    const url = URL.createObjectURL(selected);
    onSelect(selected, url);
  }

  function handleClear() {
    setLocalError('');
    if (inputRef.current) inputRef.current.value = '';
    onClear();
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        子供の写真（任意）
      </label>

      {previewUrl ? (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt="プレビュー"
            className="h-32 w-32 rounded-lg border border-gray-300 object-cover"
          />
          <button
            type="button"
            onClick={handleClear}
            disabled={uploading}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600 disabled:opacity-50"
            aria-label="写真を削除"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex h-32 w-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 disabled:opacity-50"
        >
          写真を選択
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ALLOWED_MIME_TYPES.join(',')}
        onChange={handleChange}
        className="hidden"
        aria-label="写真ファイルを選択"
      />

      {uploading && (
        <p className="mt-1 text-xs text-blue-600">アップロード中...</p>
      )}

      {displayError && (
        <p className="mt-1 text-xs text-red-600" role="alert">{displayError}</p>
      )}

      {file && !displayError && (
        <p className="mt-1 text-xs text-gray-500">{file.name}</p>
      )}
    </div>
  );
}
