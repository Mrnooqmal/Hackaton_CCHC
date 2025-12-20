import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Workers from './pages/Workers';
import WorkerEnroll from './pages/WorkerEnroll';
import Documents from './pages/Documents';
import Activities from './pages/Activities';
import AIAssistant from './pages/AIAssistant';
import Surveys from './pages/Surveys';
import Incidents from './pages/Incidents';
import Inbox from './pages/Inbox';
import Login from './pages/Login';
import UserManagement from './pages/UserManagement';
import ChangePassword from './pages/ChangePassword';
import EnrollMe from './pages/EnrollMe';
import Unauthorized from './pages/Unauthorized';
import RegisterAdmin from './pages/RegisterAdmin';
import SignatureRequests from './pages/SignatureRequests';
import MySignatures from './pages/MySignatures';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import './css/index.css';
import './css/App.css';

function AppContent() {
  const { user } = useAuth();

  return (
    <div className={`app-layout ${!user ? 'auth-mode' : ''}`}>
      {user && <Sidebar />}
      <main className={user ? 'main-content' : 'auth-content'}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register-admin" element={<RegisterAdmin />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />

          <Route path="/workers" element={
            <ProtectedRoute requiredPermission="ver_trabajadores">
              <Workers />
            </ProtectedRoute>
          } />

          <Route path="/workers/enroll" element={
            <ProtectedRoute requiredPermission="ver_trabajadores">
              <WorkerEnroll />
            </ProtectedRoute>
          } />

          <Route path="/users" element={
            <ProtectedRoute requiredPermission="crear_usuarios">
              <UserManagement />
            </ProtectedRoute>
          } />

          <Route path="/documents" element={
            <ProtectedRoute>
              <Documents />
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
            <ProtectedRoute>
              <Activities />
            </ProtectedRoute>
          } />

          <Route path="/signature-requests" element={
            <ProtectedRoute requiredPermission="crear_actividades">
              <SignatureRequests />
            </ProtectedRoute>
          } />

          <Route path="/my-signatures" element={
            <ProtectedRoute>
              <MySignatures />
            </ProtectedRoute>
          } />

          <Route path="/ai-assistant" element={
            <ProtectedRoute>
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

          <Route path="/enroll-me" element={
            <ProtectedRoute>
              <EnrollMe />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;