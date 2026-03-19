import type { TemplateRole } from '@picture-book/shared';
import { CharacterSheetStatus } from './CharacterSheetStatus';

interface CharacterOption {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
}

interface RoleAssignmentPanelProps {
  roles: TemplateRole[];
  characters: CharacterOption[];
  assignments: Record<string, string>;
  onChange: (role: string, characterId: string) => void;
}

export function RoleAssignmentPanel({ roles, characters, assignments, onChange }: RoleAssignmentPanelProps) {
  const assignedIds = new Set(Object.values(assignments));

  return (
    <div className="space-y-4">
      {roles.map((r) => {
        const currentId = assignments[r.role] ?? '';
        const available = characters.filter((c) => c.id === currentId || !assignedIds.has(c.id));
        const selected = characters.find((c) => c.id === currentId);

        return (
          <div key={r.role} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">{r.label}</span>
              {r.required ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">必須</span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">任意</span>
              )}
            </div>
            <select
              value={currentId}
              onChange={(e) => onChange(r.role, e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">未割り当て</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.name}（{c.role}）</option>
              ))}
            </select>
            {selected && !selected.photoUrl && (
              <p className="mt-1 text-xs text-yellow-600">⚠ 写真が未登録です</p>
            )}
            {selected && (
              <div className="mt-1">
                <CharacterSheetStatus status={selected.characterSheetStatus} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
