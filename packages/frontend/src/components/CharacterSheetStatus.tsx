interface CharacterSheetStatusProps {
  status: 'none' | 'generating' | 'completed' | 'failed';
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  none: { label: '未生成', className: 'bg-gray-100 text-gray-600' },
  generating: { label: '生成中...', className: 'bg-yellow-100 text-yellow-700' },
  completed: { label: '完了', className: 'bg-green-100 text-green-700' },
  failed: { label: '失敗', className: 'bg-red-100 text-red-700' },
};

export function CharacterSheetStatus({ status }: CharacterSheetStatusProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.none;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {status === 'generating' && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {config.label}
    </span>
  );
}
