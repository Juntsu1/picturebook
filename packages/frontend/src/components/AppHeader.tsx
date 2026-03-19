import { useNavigate } from 'react-router-dom';

interface AppHeaderProps {
  title: string;
  children?: React.ReactNode;
}

export function AppHeader({ title, children }: AppHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
          aria-label="トップページに戻る"
        >
          🏠 トップ
        </button>
        <h1 className="text-xl font-bold text-gray-800">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
