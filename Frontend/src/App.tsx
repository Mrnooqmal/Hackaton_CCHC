import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import PersonasManagement from './pages/PersonasManagement';
import WorkerDetail from './pages/WorkerDetail';
import WorkerEnroll from './pages/WorkerEnroll';
import Documents from './pages/Documents';
import DocumentsRepository from './pages/DocumentsRepository';
import Activities from './pages/Activities';
import AIAssistant from './pages/AIAssistant';
import Surveys from './pages/Surveys';
import Incidents from './pages/Incidents';
import Inbox from './pages/Inbox';
import Login from './pages/Login';
// Legacy UserManagement replaced by PersonasManagement
import ChangePassword from './pages/ChangePassword';
import Settings from './pages/Settings';
import EnrollMe from './pages/EnrollMe';
import Unauthorized from './pages/Unauthorized';
import RegisterAdmin from './pages/RegisterAdmin';
import TenantOnboarding from './pages/TenantOnboarding';
import SignatureRequests from './pages/SignatureRequests';
import MySignatures from './pages/MySignatures';
import OfflineSignatures from './pages/OfflineSignatures';
import Obras from './pages/Obras';
import ObraDetalle from './pages/ObraDetalle';
import CargosOnboarding from './pages/CargosOnboarding';
import Equipo from './pages/Equipo';
import About from './pages/About';
import OfflineBanner from './components/OfflineBanner';
import SuggestionsWidget from './components/SuggestionsWidget';
import Footer from './components/Footer';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LayoutProvider, useLayout } from './context/LayoutContext';
import { ToastProvider } from './context/ToastContext';
import { ObraProvider } from './context/ObraContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PERMISSIONS } from './permissions';
import './css/index.css';
import './css/App.css';
import './css/components.css';
import './css/dashboard.css';

function AppContent() {
  const { user } = useAuth();
  const { isMobileMenuOpen, closeMobileMenu, isSidebarCollapsed } = useLayout();

  return (
    <div className={`app-layout ${!user ? 'auth-mode' : ''} ${user && isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {user && <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />}
      <main className={user ? 'main-content' : 'auth-content'}>
        {user && <Header />}
        {user && <OfflineBanner />}
        <div className="route-outlet">
        <Routes>

          <Route path="/login" element={<Login />} />
          <Route path="/register-admin" element={<RegisterAdmin />} />
          <Route path="/onboarding" element={<TenantOnboarding />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/equipo" element={<Equipo />} />
          <Route path="/about" element={<About />} />

          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />

          <Route path="/personas" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_VER}>
              <PersonasManagement />
            </ProtectedRoute>
          } />

          <Route path="/personas/:rut" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_DETALLE}>
              <WorkerDetail />
            </ProtectedRoute>
          } />

          {/* Legacy routes redirect to unified personas */}
          <Route path="/workers" element={<Navigate to="/personas" replace />} />
          <Route path="/users" element={<Navigate to="/personas" replace />} />

          <Route path="/workers/:rut" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_DETALLE}>
              <WorkerDetail />
            </ProtectedRoute>
          } />

          <Route path="/obras" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_VER}>
              <Obras />
            </ProtectedRoute>
          } />

          <Route path="/obras/:obraId" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_DETALLE}>
              <ObraDetalle />
            </ProtectedRoute>
          } />

          {/* Constructor de cargos de onboarding (catálogo tenant). Admin + jefe de obra. */}
          <Route path="/cargos-onboarding" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.CARGOS_GESTIONAR}>
              <CargosOnboarding />
            </ProtectedRoute>
          } />

          <Route path="/workers/enroll" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_CREAR}>
              <WorkerEnroll />
            </ProtectedRoute>
          } />

          <Route path="/documents" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.DOCUMENTOS_VER}>
              <Documents />
            </ProtectedRoute>
          } />

          <Route path="/documents-repository" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.REPOSITORIO_VER}>
              <DocumentsRepository />
            </ProtectedRoute>
          } />

          <Route path="/surveys" element={
            <ProtectedRoute>
              <Surveys />
            </ProtectedRoute>
          } />

          <Route path="/incidents" element={
            <ProtectedRoute>
              <Incidents />
            </ProtectedRoute>
          } />

          <Route path="/activities" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.ACTIVIDADES_VER}>
              <Activities />
            </ProtectedRoute>
          } />

          <Route path="/signature-requests" element={
            <ProtectedRoute>
              <SignatureRequests />
            </ProtectedRoute>
          } />

          <Route path="/my-signatures" element={
            <ProtectedRoute>
              <MySignatures />
            </ProtectedRoute>
          } />

          <Route path="/offline-signatures" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.FIRMAS_CREAR}>
              <OfflineSignatures />
            </ProtectedRoute>
          } />

          <Route path="/ai-assistant" element={
            <ProtectedRoute requiredPermission={PERMISSIONS.IA_VER}>
              <AIAssistant />
            </ProtectedRoute>
          } />

          <Route path="/inbox" element={
            <ProtectedRoute>
              <Inbox />
            </ProtectedRoute>
          } />

          <Route path="/change-password" element={
            <ProtectedRoute>
              <ChangePassword />
            </ProtectedRoute>
          } />

          <Route path="/settings" element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } />

          <Route path="/enroll-me" element={
            <ProtectedRoute>
              <EnrollMe />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
        {user && <SuggestionsWidget />}
        {user && <Footer />}
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ObraProvider>
          <LayoutProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </LayoutProvider>
        </ObraProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;