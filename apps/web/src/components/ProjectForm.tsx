import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

export interface ProjectFormValues {
  name: string;
  description?: string;
  variablesJson: string;
}

/**
 * A blank/whitespace-only textarea is treated as "no variables" (`{}`),
 * so an empty field is valid and doesn't force the user to type `{}`
 * before they can submit.
 */
function isValidVariablesJson(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const projectFormSchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  description: z.string().optional(),
  variablesJson: z
    .string()
    .refine(isValidVariablesJson, {
      message: 'Les variables doivent être un objet JSON valide, par ex. { "baseUrl": "https://example.com" }',
    }),
});

export function ProjectForm({
  defaultValues,
  onSubmit,
  submitLabel,
}: {
  defaultValues?: Partial<ProjectFormValues>;
  onSubmit: (values: { name: string; description?: string; variables: Record<string, unknown> }) => void;
  submitLabel: string;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      variablesJson: defaultValues?.variablesJson ?? "",
    },
  });

  function submit(values: ProjectFormValues): void {
    const trimmed = values.variablesJson.trim();
    const variables = trimmed.length === 0 ? {} : (JSON.parse(trimmed) as Record<string, unknown>);
    const description = values.description?.trim();
    onSubmit({
      name: values.name,
      description: description && description.length > 0 ? description : undefined,
      variables,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div>
        <label htmlFor="project-name" className="block text-sm font-medium text-gray-700">
          Nom
        </label>
        <input
          id="project-name"
          type="text"
          {...register("name")}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name.message}</p> : null}
      </div>

      <div>
        <label htmlFor="project-description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="project-description"
          rows={2}
          {...register("description")}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.description ? <p className="mt-1 text-sm text-red-600">{errors.description.message}</p> : null}
      </div>

      <div>
        <label htmlFor="project-variables" className="block text-sm font-medium text-gray-700">
          Variables (JSON)
        </label>
        <textarea
          id="project-variables"
          rows={4}
          placeholder={'{ "baseUrl": "https://example.com" }'}
          {...register("variablesJson")}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.variablesJson ? (
          <p className="mt-1 text-sm text-red-600">{errors.variablesJson.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
