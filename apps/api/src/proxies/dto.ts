import { z } from "zod";
import { ProxyStatus } from "@datarover/database";

export const CreateProxySchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});
export type CreateProxyDto = z.infer<typeof CreateProxySchema>;

export const UpdateProxySchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  status: z.nativeEnum(ProxyStatus).optional(),
});
export type UpdateProxyDto = z.infer<typeof UpdateProxySchema>;

/**
 * Query params for `GET /proxies` — the first paginated endpoint in this API, so the shape
 * (`page`/`limit`, 1-indexed; a flat `{items, total, page, limit}` envelope on the response side)
 * is being established here, not copied from an existing convention. `z.coerce.number()` matters:
 * Fastify hands every query param to Nest as a raw string (`?page=2`), never a real number.
 */
export const ListProxiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(ProxyStatus).optional(),
});
export type ListProxiesQueryDto = z.infer<typeof ListProxiesQuerySchema>;

export const UpdateProxyConfigSchema = z.object({
  purgeErrorThreshold: z.number().int().min(1),
});
export type UpdateProxyConfigDto = z.infer<typeof UpdateProxyConfigSchema>;
