/**
 * PostgREST / supabase-js: some RPCs return one row as a plain object; others return an array.
 * Normalizes to an array so callers can safely use rows[0].
 */
export function normalizeSupabaseRpcRows<T extends Record<string, unknown>>(data: unknown): T[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data === "object") return [data as T];
  return [];
}
