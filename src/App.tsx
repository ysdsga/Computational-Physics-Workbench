import { HashRouter, Routes, Route } from 'react-router-dom';
import { WorkflowProvider } from './contexts/WorkflowContext';
import Sidebar from './components/Sidebar';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TaskWorkflowPage from './pages/TaskWorkflowPage';
import WorkflowPage from './pages/WorkflowPage';
import HPCPage from './pages/HPCPage';
import ExperiencePage from './pages/ExperiencePage';

export default function App() {
  return (
    <WorkflowProvider>
      <HashRouter>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden bg-[#131320]">
            <Routes>
              <Route path="/" element={<ProjectsPage />} />
              <Route path="/workflow" element={<WorkflowPage />} />
              <Route path="/hpc" element={<HPCPage />} />
              <Route path="/project/:projectId" element={<ProjectDetailPage />} />
              <Route path="/task/:taskId" element={<TaskWorkflowPage />} />
              <Route path="/experiences" element={<ExperiencePage />} />
            </Routes>
          </main>
        </div>
      </HashRouter>
    </WorkflowProvider>
  );
}
