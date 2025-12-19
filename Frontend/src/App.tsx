import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Workers from './pages/Workers';
import WorkerEnroll from './pages/WorkerEnroll';
import Documents from './pages/Documents';
import Activities from './pages/Activities';
import AIAssistant from './pages/AIAssistant';
import './css/index.css';
import './css/App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/workers/enroll" element={<WorkerEnroll />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/activities" element={<Activities />} />
            <Route path="/ai-assistant" element={<AIAssistant />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;