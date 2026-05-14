export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function parsePaginationParams(query: Record<string, unknown>): PaginationParams {
  let cursor: string | undefined;
  const rawCursor = query.cursor;
  if (typeof rawCursor === "string" && rawCursor.length > 0) {
    cursor = rawCursor;
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = query.limit;
  if (typeof rawLimit === "number" && Number.isFinite(rawLimit)) {
    limit = Math.floor(rawLimit);
  } else if (typeof rawLimit === "string" && rawLimit.length > 0) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed)) {
      limit = parsed;
    }
  }

  if (limit < 1) {
    limit = DEFAULT_LIMIT;
  }
  if (limit > MAX_LIMIT) {
    limit = MAX_LIMIT;
  }

  return cursor !== undefined ? { cursor, limit } : { limit };
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({
    createdAt: createdAt.toISOString(),
    id,
  });
  return Buffer.from(payload, "utf8").toString("base64");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("createdAt" in parsed) ||
      !("id" in parsed)
    ) {
      return null;
    }
    const { createdAt, id } = parsed as { createdAt: unknown; id: unknown };
    if (typeof createdAt !== "string" || typeof id !== "string") {
      return null;
    }
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

export function buildPaginatedResponse<T>(
  items: T[],
  limit: number,
  getCursor: (item: T) => { createdAt: Date; id: string },
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last !== undefined) {
    const { createdAt, id } = getCursor(last);
    nextCursor = encodeCursor(createdAt, id);
  }
  return { data, nextCursor, hasMore };
}
