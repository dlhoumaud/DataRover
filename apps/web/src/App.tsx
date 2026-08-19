import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { ExecutionDetailPage } from "./pages/ExecutionDetailPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { WorkflowEditorPage } from "./pages/WorkflowEditorPage";

export function App(): JSX.Element {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route
          path="/projects/:projectId/workflows/:workflowId"
          element={<WorkflowEditorPage />}
        />
        <Route
          path="/projects/:projectId/workflows/:workflowId/executions"
          element={<ExecutionsPage />}
        />
        <Route path="/executions/:executionId" element={<ExecutionDetailPage />} />
      </Routes>
    </Layout>
  );
}
