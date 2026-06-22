import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import PersonasManagement from './pages/PersonasManagement';
import PersonaNueva from './pages/PersonaNueva';
import PersonasCargaMasiva from './pages/PersonasCargaMasiva';
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
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import EnrollMe from './pages/EnrollMe';
import Unauthorized from './pages/Unauthorized';
import RegisterAdmin from './pages/RegisterAdmin';
import TenantOnboarding from './pages/TenantOnboarding';
import SignatureRequests from './pages/SignatureRequests';
import MySignatures from './pages/MySignatures';
import OfflineSignatures from './pages/OfflineSignatures';
import Obras from './pages/Obras';
import ObraNueva from './pages/ObraNueva';
import ObraDetalle from './pages/ObraDetalle';
import ObraEquipoPage from './pages/ObraEquipoPage';
import Crear from './pages/Crear';
import Contenido from './pages/Contenido';
import CargosOnboarding from './pages/CargosOnboarding';
import MiEmpresa from './pages/MiEmpresa';
import Equipo from './pages/Equipo';
import About from './pages/About';
import OfflineBanner from './components/OfflineBanner';
import SuggestionsWidget from './components/SuggestionsWidget';
import Footer from './components/Footer';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LayoutProvider, useLayout } from './context/LayoutContext';
import { ToastProvider } from './context/ToastContext';
import { ObraProvider } from './context/ObraContext';
import { BrandProvider, useBrand } from './context/BrandContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PERMISSIONS } from './permissions';
import './css/index.css';
import './css/App.css';
import './css/components.css';
import './css/dashboard.css';

function SessionExpiredModal() {
  const { sessionExpired, clearSessionExpired } = useAuth();
  if (!sessionExpired) return null;
  const handleGoToLogin = () => {
    clearSessionExpired();
  };
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999999, padding: '1rem'
    }}>
      <div style={{
        background: 'var(--surface-card)', border: '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-xl)', maxWidth: 400, width: '100%',
        padding: '2.5rem 1.5rem 1.5rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: '1rem' }}>⏰</div>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Tu sesión ha expirado
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '2rem' }}>
          Por seguridad, tu sesión fue cerrada automáticamente. Por favor, inicia sesión nuevamente.
        </p>
        <a href="/login" onClick={handleGoToLogin} className="btn btn-primary" style={{ display: 'block', width: '100%', textAlign: 'center' }}>
          Volver al inicio de sesión
        </a>
      </div>
    </div>,
    document.body
  );
}

function AppContent() {
  const { user } = useAuth();
  const { isMobileMenuOpen, closeMobileMenu, isSidebarCollapsed } = useLayout();
  const { setLogo, setPrimaryColor } = useBrand();
  const location = useLocation();

  useEffect(() => {
    if (!user?.branding) return;
    if (user.branding.logoUrl)       setLogo(user.branding.logoUrl);
    if (user.branding.colorPrimario) setPrimaryColor(user.branding.colorPrimario);
  }, [user?.branding, setLogo, setPrimaryColor]);

  // El enrolamiento es siempre pantalla completa (sin sidebar): durante el paso de
  // perfil el usuario ya queda `habilitado`, pero el flujo aún no termina, así que
  // no debe volver al layout del sistema. El cambio de contraseña solo bloquea en
  // el primer ingreso (después se puede cambiar desde dentro del sistema).
  const isFirstEntryUser = !!user && (user.passwordTemporal === true || user.habilitado === false);
  const isBlockingStep = !!user && (
    location.pathname === '/enroll-me' ||
    (isFirstEntryUser && location.pathname === '/change-password')
  );

  const routes = (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/recuperar-clave" element={<ForgotPassword />} />
      <Route path="/restablecer-clave" element={<ResetPassword />} />
      <Route path="/register-admin" element={<RegisterAdmin />} />
      <Route path="/onboarding" element={<TenantOnboarding />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/equipo" element={<Equipo />} />
      <Route path="/about" element={<About />} />

      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/personas" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_VER}><PersonasManagement /></ProtectedRoute>} />
      <Route path="/personas/nueva" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_CREAR}><PersonaNueva /></ProtectedRoute>} />
      <Route path="/personas/carga-masiva" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_CREAR}><PersonasCargaMasiva /></ProtectedRoute>} />
      <Route path="/personas/:rut" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_DETALLE}><WorkerDetail /></ProtectedRoute>} />

      {/* Legacy routes redirect to unified personas */}
      <Route path="/workers" element={<Navigate to="/personas" replace />} />
      <Route path="/users" element={<Navigate to="/personas" replace />} />
      <Route path="/workers/:rut" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_DETALLE}><WorkerDetail /></ProtectedRoute>} />

      <Route path="/obras" element={<ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_VER}><Obras /></ProtectedRoute>} />
      <Route path="/obras/nueva" element={<ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_CREAR}><ObraNueva /></ProtectedRoute>} />
      <Route path="/obras/:obraId" element={<ProtectedRoute requiredPermission={PERMISSIONS.OBRAS_DETALLE}><ObraDetalle /></ProtectedRoute>} />
      <Route path="/obras/:obraId/equipo" element={<ProtectedRoute requiredPermission={PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES}><ObraEquipoPage /></ProtectedRoute>} />

      {/* Constructor de cargos de onboarding (catálogo tenant). Admin + jefe de obra. */}
      <Route path="/cargos-onboarding" element={<ProtectedRoute requiredPermission={PERMISSIONS.CARGOS_GESTIONAR}><CargosOnboarding /></ProtectedRoute>} />
      <Route path="/workers/enroll" element={<ProtectedRoute requiredPermission={PERMISSIONS.PERSONAS_CREAR}><WorkerEnroll /></ProtectedRoute>} />
      <Route path="/documents" element={<ProtectedRoute requiredPermission={PERMISSIONS.DOCUMENTOS_VER}><Documents /></ProtectedRoute>} />
      <Route path="/documents-repository" element={<ProtectedRoute requiredPermission={PERMISSIONS.REPOSITORIO_VER}><DocumentsRepository /></ProtectedRoute>} />
      <Route path="/surveys" element={<ProtectedRoute><Surveys /></ProtectedRoute>} />
      <Route path="/incidents" element={<ProtectedRoute><Incidents /></ProtectedRoute>} />
      <Route path="/activities" element={<ProtectedRoute requiredPermission={PERMISSIONS.ACTIVIDADES_VER}><Activities /></ProtectedRoute>} />
      <Route path="/signature-requests" element={<ProtectedRoute><SignatureRequests /></ProtectedRoute>} />
      <Route path="/my-signatures" element={<ProtectedRoute><MySignatures /></ProtectedRoute>} />
      <Route path="/offline-signatures" element={<ProtectedRoute requiredPermission={PERMISSIONS.FIRMAS_CREAR}><OfflineSignatures /></ProtectedRoute>} />
      <Route path="/ai-assistant" element={<ProtectedRoute requiredPermission={PERMISSIONS.IA_VER}><AIAssistant /></ProtectedRoute>} />
      <Route path="/inbox" element={<ProtectedRoute><Inbox /></ProtectedRoute>} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
      <Route path="/mi-empresa" element={<ProtectedRoute requiredPermission={PERMISSIONS.EMPRESA_VER}><MiEmpresa /></ProtectedRoute>} />
      <Route path="/crear" element={<ProtectedRoute><Crear /></ProtectedRoute>} />
      <Route path="/contenido" element={<ProtectedRoute><Contenido /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/enroll-me" element={<ProtectedRoute><EnrollMe /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  if (isBlockingStep) {
    return (
      <>
        <SessionExpiredModal />
        <main className="onboarding-content">
          <div className="route-outlet">
            {routes}
          </div>
        </main>
      </>
    );
  }

  return (
    <div className={`app-layout ${!user ? 'auth-mode' : ''} ${user && isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <SessionExpiredModal />
      {user && <Sidebar isOpen={isMobileMenuOpen} onClose={closeMobileMenu} />}
      <main className={user ? 'main-content' : 'auth-content'}>
        {user && <Header />}
        {user && <OfflineBanner />}
        <div className="route-outlet">
          {routes}
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
            <BrandProvider>
              <BrowserRouter>
                <AppContent />
              </BrowserRouter>
            </BrandProvider>
          </LayoutProvider>
        </ObraProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;