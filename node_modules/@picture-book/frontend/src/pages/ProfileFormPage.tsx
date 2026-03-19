import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateProfileSchema } from '@picture-book/shared';
import { apiClient } from '../api/client';
import { PhotoUploadArea } from '../components/PhotoUploadArea';
import { AppHeader } from '../components/AppHeader';

interface FieldErrors {
  name?: string;
  age?: string;
  gender?: string;
  favoriteColor?: string;
  favoriteAnimal?: string;
  appearance?: string;
}

export function ProfileFormPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [favoriteColor, setFavoriteColor] = useState('');
  const [favoriteAnimal, setFavoriteAnimal] = useState('');
  const [appearance, setAppearance] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handlePhotoSelect(file: File, previewUrl: string) {
    setPhotoFile(file);
    setPhotoPreview(previewUrl);
  }

  function handlePhotoClear() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setServerError('');

    const raw = {
      name: name.trim(),
      age: age === '' ? undefined : Number(age),
      gender: gender.trim() || undefined,
      favoriteColor: favoriteColor.trim() || undefined,
      favoriteAnimal: favoriteAnimal.trim() || undefined,
      appearance: appearance.trim() || undefined,
    };

    const result = CreateProfileSchema.safeParse(raw);
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('name', result.data.name);
      formData.append('age', String(result.data.age));
      if (result.data.gender) formData.append('gender', result.data.gender);
      if (result.data.favoriteColor) formData.append('favoriteColor', result.data.favoriteColor);
      if (result.data.favoriteAnimal) formData.append('favoriteAnimal', result.data.favoriteAnimal);
      if (result.data.appearance) formData.append('appearance', result.data.appearance);
      if (photoFile) formData.append('photo', photoFile);

      const res = await apiClient.postFormData<{ id: string }>('/api/profiles', formData);
      navigate(`/themes/${res.id}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '予期しないエラーが発生しました';
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = (field: keyof FieldErrors) =>
    `w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 ${
      fieldErrors[field] ? 'border-red-400' : 'border-gray-300'
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="子供プロフィール登録" />
      <div className="flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg rounded-lg bg-white p-8 shadow">

        {serverError && (
          <div
            role="alert"
            className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* 名前 (必須) */}
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              名前 <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
              className={inputClass('name')}
            />
            {fieldErrors.name && (
              <p id="name-error" className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
            )}
          </div>

          {/* 年齢 (必須) */}
          <div>
            <label htmlFor="age" className="mb-1 block text-sm font-medium text-gray-700">
              年齢 <span className="text-red-500">*</span>
            </label>
            <input
              id="age"
              type="number"
              min={0}
              max={17}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              aria-invalid={!!fieldErrors.age}
              aria-describedby={fieldErrors.age ? 'age-error' : undefined}
              className={inputClass('age')}
            />
            {fieldErrors.age && (
              <p id="age-error" className="mt-1 text-xs text-red-600">{fieldErrors.age}</p>
            )}
          </div>

          {/* 性別 (任意) */}
          <div>
            <label htmlFor="gender" className="mb-1 block text-sm font-medium text-gray-700">
              性別
            </label>
            <input
              id="gender"
              type="text"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={inputClass('gender')}
            />
          </div>

          {/* 好きな色 (任意) */}
          <div>
            <label htmlFor="favoriteColor" className="mb-1 block text-sm font-medium text-gray-700">
              好きな色
            </label>
            <input
              id="favoriteColor"
              type="text"
              value={favoriteColor}
              onChange={(e) => setFavoriteColor(e.target.value)}
              className={inputClass('favoriteColor')}
            />
          </div>

          {/* 好きな動物 (任意) */}
          <div>
            <label htmlFor="favoriteAnimal" className="mb-1 block text-sm font-medium text-gray-700">
              好きな動物
            </label>
            <input
              id="favoriteAnimal"
              type="text"
              value={favoriteAnimal}
              onChange={(e) => setFavoriteAnimal(e.target.value)}
              className={inputClass('favoriteAnimal')}
            />
          </div>

          {/* 外見の特徴 (任意) */}
          <div>
            <label htmlFor="appearance" className="mb-1 block text-sm font-medium text-gray-700">
              外見の特徴
            </label>
            <textarea
              id="appearance"
              rows={3}
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              className={inputClass('appearance')}
            />
          </div>

          {/* 写真アップロード (任意) */}
          <PhotoUploadArea
            file={photoFile}
            previewUrl={photoPreview}
            onSelect={handlePhotoSelect}
            onClear={handlePhotoClear}
            uploading={submitting}
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '保存中...' : 'プロフィールを保存'}
          </button>
        </form>
      </div>
      </div>
    </div>
  );
}
