import { randomUUID } from "node:crypto";

/**
 * Generates a unique identifier.
 *
 * When a `prefix` is provided, the returned id has the shape
 * `${prefix}_${uuid}`. Without a prefix, a bare UUID (v4) string is
 * returned.
 *
 * @param prefix - Optional prefix to prepend to the generated UUID.
 * @returns A unique identifier string.
 */
export function generateId(prefix?: string): string {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
