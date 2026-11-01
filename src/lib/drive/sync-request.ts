// Limits of a POST /api/drive/sync body. The route refuses anything larger, so the client trims its request to fit
// instead of failing every sync because one subject has a long code or too many linked folders.
export const SYNC_LIMITS = {
  subjects: 50,
  subjectName: 200,
  subjectCode: 20,
  known: 50_000,
  knownId: 100,
  links: 50,
  folderIdsPerLink: 10,
} as const;

export type SyncSubject = { id: number; name: string; code?: string; driveFolderIds?: string[] };

/** The subjects, links and known ids of a sync request, trimmed to what the route accepts. */
export function fitSyncRequest(subjects: SyncSubject[], known: string[]) {
  const kept = subjects.slice(0, SYNC_LIMITS.subjects);
  return {
    subjects: kept.map((s) => ({
      id: s.id,
      name: s.name.slice(0, SYNC_LIMITS.subjectName),
      code: s.code ? s.code.slice(0, SYNC_LIMITS.subjectCode) : undefined,
    })),
    // Past the cap a few already-imported files may be listed again; the client skips ids it already has.
    known: known.filter((k) => k.length <= SYNC_LIMITS.knownId).slice(-SYNC_LIMITS.known),
    links: kept
      .filter((s) => s.driveFolderIds?.length)
      .slice(0, SYNC_LIMITS.links)
      .map((s) => ({ subjectId: s.id, folderIds: s.driveFolderIds!.slice(0, SYNC_LIMITS.folderIdsPerLink) })),
  };
}
