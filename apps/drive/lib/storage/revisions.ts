export const REVISION_HEADER = "x-xenode-base-revision";

export function parseBaseRevision(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export function revisionFilter(baseRevision: number): Record<string, unknown> {
  return baseRevision === 0
    ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
    : { revision: baseRevision };
}

