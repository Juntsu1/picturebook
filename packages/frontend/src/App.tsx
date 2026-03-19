import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfileFormPage } from './pages/ProfileFormPage';
import { ThemeSelectPage } from './pages/ThemeSelectPage';
import { GeneratingPage } from './pages/GeneratingPage';
import { PreviewPage } from './pages/PreviewPage';
import { CharacterListPage } from './pages/CharacterListPage';
import { CharacterFormPage } from './pages/CharacterFormPage';
import { CharacterDetailPage } from './pages/CharacterDetailPage';
import { TemplateSelectPage } from './pages/TemplateSelectPage';
import { RoleAssignPage } from './pages/RoleAssignPage';
import { ChatStoryPage } from './pages/ChatStoryPage';
import { MultiGeneratingPage } from './pages/MultiGeneratingPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profiles/new"
            element={
              <ProtectedRoute>
                <ProfileFormPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/themes/:profileId"
            element={
              <ProtectedRoute>
                <ThemeSelectPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/generating/:bookId"
            element={
              <ProtectedRoute>
                <GeneratingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/books/:bookId"
            element={
              <ProtectedRoute>
                <PreviewPage />
              </ProtectedRoute>
            }
          />
          <Route path="/characters" element={<ProtectedRoute><CharacterListPage /></ProtectedRoute>} />
          <Route path="/characters/new" element={<ProtectedRoute><CharacterFormPage /></ProtectedRoute>} />
          <Route path="/characters/:id" element={<ProtectedRoute><CharacterDetailPage /></ProtectedRoute>} />
          <Route path="/characters/:id/edit" element={<ProtectedRoute><CharacterFormPage /></ProtectedRoute>} />
          <Route path="/templates" element={<ProtectedRoute><TemplateSelectPage /></ProtectedRoute>} />
          <Route path="/templates/:templateId/assign" element={<ProtectedRoute><RoleAssignPage /></ProtectedRoute>} />
          <Route path="/chat-stories" element={<ProtectedRoute><ChatStoryPage /></ProtectedRoute>} />
          <Route path="/chat-stories/:sessionId" element={<ProtectedRoute><ChatStoryPage /></ProtectedRoute>} />
          <Route path="/generating-multi" element={<ProtectedRoute><MultiGeneratingPage /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
