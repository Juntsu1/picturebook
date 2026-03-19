import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateCharacterSchema, UpdateCharacterSchema, CHARACTER_ROLES } from '@picture-book/shared';
import { apiClient } from '../api/client';
import { PhotoUploadArea } from '../components/PhotoUploadArea';
import { AppHeader } from '../components/AppHeader';

interface FieldErrors {
  name?: string;
  role?: string;
  age?: string;
  gender?: string;
  appearance?: string;
}

export function CharacterFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [appearance, setAppearance] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await apiClient.get<{ id: string; name: string; role: string; age: number | null; gender: string | null; appearance: string | null; photoUrl: string | null }>(`/api/characters/${id}`);
        setName(res.name);
        setRole(res.role);
        setAge(res.age != null ? String(res.age) : '');
        setGender(res.gender ?? '');
        setAppearance(res.appearance ?? '');
        if (res.photoUrl) setPhotoPreview(res.photoUrl);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'キャラクターの取得に失敗しました');
      } finally {
        setLoadingEdit(false);
      }
    })();
  }, [id]);

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
      role: role || undefined,
      age: age === '' ? undefined : Number(age),
      gender: gender.trim() || undefined,
      appearance: appearance.trim() || undefined,
    };

    const schema = isEdit ? UpdateCharacterSchema : CreateCharacterSchema;
    const result = schema.safeParse(raw);
    if (!result.success) {
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await apiClient.put(`/api/characters/${id}`, result.data);
      } else {
        const formData = new FormData();
        formData.append('name', raw.name);
        formData.append('role', raw.role as string);
        if (raw.age != null) formData.append('age', String(raw.age));
        if (raw.gender) formData.append('gender', raw.gender);
        if (raw.appearance) formData.append('appearance', raw.appearance);
        if (photoFile) formData.append('photo', photoFile);
        await apiClient.postFormData('/api/characters', formData);
      }
      navigate('/characters', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = (field: keyof FieldErrors) =>
    `w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 ${
      fieldErrors[field] ? 'border-red-400' : 'border-gray-300'
    }`;

  if (loadingEdit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={isEdit ? 'キャラクター編集' : 'キャラクター登録'} />
      <div className="flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg rounded-lg bg-white p-8 shadow">

        {serverError && (
          <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              名前 <span className="text-red-500">*</span>
            </label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)}
              aria-invalid={!!fieldErrors.name} className={inputClass('name')} />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
          </div>

          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium text-gray-700">
              役割 <span className="text-red-500">*</span>
            </label>
            <select id="role" value={role} onChange={(e) => setRole(e.target.value)}
              aria-invalid={!!fieldErrors.role} className={inputClass('role')}>
              <option value="">選択してください</option>
              {Object.entries(CHARACTER_ROLES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            {fieldErrors.role && <p className="mt-1 text-xs text-red-600">{fieldErrors.role}</p>}
          </div>

          <div>
            <label htmlFor="age" className="mb-1 block text-sm font-medium text-gray-700">年齢</label>
            <input id="age" type="number" min={0} max={120} value={age}
              onChange={(e) => setAge(e.target.value)} className={inputClass('age')} />
          </div>

          <div>
            <label htmlFor="gender" className="mb-1 block text-sm font-medium text-gray-700">性別</label>
            <input id="gender" type="text" value={gender}
              onChange={(e) => setGender(e.target.value)} className={inputClass('gender')} />
          </div>

          <div>
            <label htmlFor="appearance" className="mb-1 block text-sm font-medium text-gray-700">外見の特徴</label>
            <textarea id="appearance" rows={3} value={appearance}
              onChange={(e) => setAppearance(e.target.value)} className={inputClass('appearance')} />
          </div>

          {!isEdit && (
            <PhotoUploadArea
              file={photoFile}
              previewUrl={photoPreview}
              onSelect={handlePhotoSelect}
              onClear={handlePhotoClear}
              uploading={submitting}
            />
          )}

          <button type="submit" disabled={submitting}
            className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {submitting ? '保存中...' : isEdit ? '更新する' : '登録する'}
          </button>
        </form>
      </div>
      </div>
    </div>
  );
}
