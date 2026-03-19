import { CHARACTER_ROLES } from '@picture-book/shared';
import { CharacterSheetStatus } from './CharacterSheetStatus';

interface CharacterCardProps {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onClick?: (id: string) => void;
}

export function CharacterCard({
  id,
  name,
  role,
  photoUrl,
  characterSheetStatus,
  onEdit,
  onDelete,
  onClick,
}: CharacterCardProps) {
  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm cursor-pointer hover:border-blue-300 transition-colors"
      onClick={() => onClick?.(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(id); }}
    >
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-gray-100">
        {photoUrl ? (
          <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-gray-400">👤</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-gray-800">{name}</h3>
        <p className="text-xs text-gray-500">{CHARACTER_ROLES[role] ?? role}</p>
        <div className="mt-1">
          <CharacterSheetStatus status={characterSheetStatus} />
        </div>
      </div>
      <div className="flex flex-shrink-0 gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(id); }}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
        >
          編集
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(id); }}
          className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          削除
        </button>
      </div>
    </div>
  );
}
