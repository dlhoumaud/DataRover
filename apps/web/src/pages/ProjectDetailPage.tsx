import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useProject, useUpdateProject } from "../api/projects";
import { useCreateWorkflow, useWorkflows } from "../api/workflows";
import { ProjectForm } from "../components/ProjectForm";
import { createDefaultNode } from "../lib/workflowGraph";

export function ProjectDetailPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const safeProjectId = projectId ?? "";

  const projectQuery = useProject(projectId);
  const workflowsQuery = useWorkflows(projectId);
  const updateProject = useUpdateProject(safeProjectId);
  const createWorkflow = useCreateWorkflow(safeProjectId);
  const navigate = useNavigate();

  const [isEditing, setIsEditing] = useState(false);
  const [isCreatingWorkflow, setIsCreatingWorkflow] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");

  function handleUpdateProject(values: {
    name: string;
    description?: string;
    variables: Record<string, unknown>;
  }): void {
    updateProject.mutate(values, {
      onSuccess: () => setIsEditing(false),
    });
  }

  function handleCreateWorkflow(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const name = newWorkflowName.trim();
    if (name.length === 0) {
      return;
    }
    createWorkflow.mutate(
      {
        name,
        definition: {
          name,
          startNodeId: "stop1",
          nodes: [createDefaultNode("stop", "stop1")],
          edges: [],
        },
      },
      {
        onSuccess: (workflow) => {
          setNewWorkflowName("");
          setIsCreatingWorkflow(false);
          navigate(`/projects/${safeProjectId}/workflows/${workflow.id}`);
        },
      },
    );
  }

  if (!projectId) {
    return <p className="text-red-600">Identifiant de projet manquant.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          &larr; Retour aux projets
        </Link>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {projectQuery.isPending ? <p className="text-gray-600">Chargement...</p> : null}

        {projectQuery.isError ? (
          <p className="text-red-600">
            {projectQuery.error instanceof ApiError
              ? projectQuery.error.message
              : "Impossible de charger le projet."}
          </p>
        ) : null}

        {projectQuery.data ? (
          isEditing ? (
            <div>
              <h2 className="mb-4 text-lg font-medium text-gray-900">Modifier le projet</h2>
              <ProjectForm
                defaultValues={{
                  name: projectQuery.data.name,
                  description: projectQuery.data.description ?? undefined,
                  variablesJson: JSON.stringify(projectQuery.data.variables, null, 2),
                }}
                submitLabel="Enregistrer"
                onSubmit={handleUpdateProject}
              />
              {updateProject.isError ? (
                <p className="mt-3 text-sm text-red-600">
                  {updateProject.error instanceof ApiError
                    ? updateProject.error.message
                    : "Une erreur est survenue lors de la mise à jour du projet."}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="mt-3 text-sm text-gray-600 hover:underline"
              >
                Annuler
              </button>
            </div>
          ) : (
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{projectQuery.data.name}</h1>
                {projectQuery.data.description ? (
                  <p className="mt-1 text-gray-600">{projectQuery.data.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-gray-400">
                  Créé le {new Date(projectQuery.data.createdAt).toLocaleDateString()}
                </p>
                <pre className="mt-3 max-w-full overflow-x-auto rounded-md bg-gray-50 p-3 text-xs text-gray-700">
                  {JSON.stringify(projectQuery.data.variables, null, 2)}
                </pre>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Modifier
              </button>
            </div>
          )
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Workflows</h2>
          <button
            type="button"
            onClick={() => setIsCreatingWorkflow((prev) => !prev)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {isCreatingWorkflow ? "Annuler" : "Nouveau workflow"}
          </button>
        </div>

        {isCreatingWorkflow ? (
          <form onSubmit={handleCreateWorkflow} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex-1">
              <label htmlFor="workflow-name" className="block text-sm font-medium text-gray-700">
                Nom du workflow
              </label>
              <input
                id="workflow-name"
                type="text"
                value={newWorkflowName}
                onChange={(event) => setNewWorkflowName(event.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {createWorkflow.isError ? (
                <p className="mt-2 text-sm text-red-600">
                  {createWorkflow.error instanceof ApiError
                    ? createWorkflow.error.message
                    : "Une erreur est survenue lors de la création du workflow."}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Créer
            </button>
          </form>
        ) : null}

        {workflowsQuery.isPending ? <p className="text-gray-600">Chargement...</p> : null}

        {workflowsQuery.isError ? (
          <p className="text-red-600">
            {workflowsQuery.error instanceof ApiError
              ? workflowsQuery.error.message
              : "Impossible de charger les workflows."}
          </p>
        ) : null}

        {workflowsQuery.data ? (
          workflowsQuery.data.length === 0 ? (
            <p className="text-gray-600">Aucun workflow pour l'instant.</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {workflowsQuery.data.map((workflow) => (
                <li key={workflow.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-gray-900">{workflow.name}</p>
                    <p className="text-sm text-gray-500">Version {workflow.latestVersion}</p>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <Link
                      to={`/projects/${projectId}/workflows/${workflow.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Éditer
                    </Link>
                    <Link
                      to={`/projects/${projectId}/workflows/${workflow.id}/executions`}
                      className="text-gray-600 hover:underline"
                    >
                      Historique
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
