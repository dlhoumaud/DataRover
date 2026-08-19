import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCreateProject, useProjects } from "../api/projects";
import { ProjectForm } from "../components/ProjectForm";

export function ProjectsPage(): JSX.Element {
  const { data: projects, isPending, isError, error } = useProjects();
  const [isCreating, setIsCreating] = useState(false);
  const createProject = useCreateProject();
  const navigate = useNavigate();

  function handleCreate(values: { name: string; description?: string; variables: Record<string, unknown> }): void {
    createProject.mutate(values, {
      onSuccess: (project) => {
        setIsCreating(false);
        navigate(`/projects/${project.id}`);
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Projets</h1>
        <button
          type="button"
          onClick={() => setIsCreating((prev) => !prev)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {isCreating ? "Annuler" : "Nouveau projet"}
        </button>
      </div>

      {isCreating ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-medium text-gray-900">Créer un projet</h2>
          <ProjectForm onSubmit={handleCreate} submitLabel="Créer" />
          {createProject.isError ? (
            <p className="mt-3 text-sm text-red-600">
              {createProject.error instanceof ApiError
                ? createProject.error.message
                : "Une erreur est survenue lors de la création du projet."}
            </p>
          ) : null}
        </div>
      ) : null}

      {isPending ? <p className="text-gray-600">Chargement...</p> : null}

      {isError ? (
        <p className="text-red-600">
          {error instanceof ApiError ? error.message : "Impossible de charger les projets."}
        </p>
      ) : null}

      {!isPending && !isError && projects ? (
        projects.length === 0 ? (
          <p className="text-gray-600">Aucun projet pour l'instant.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.id}`}
                  className="block h-full rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow"
                >
                  <h2 className="text-lg font-medium text-gray-900">{project.name}</h2>
                  {project.description ? <p className="mt-1 text-sm text-gray-600">{project.description}</p> : null}
                  <p className="mt-2 text-xs text-gray-400">
                    Créé le {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
