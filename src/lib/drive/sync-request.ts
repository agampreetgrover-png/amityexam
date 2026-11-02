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

/** A Drive folder id the sync route accepts (sources and linked folders). The client drops any other id it holds. */
export const SYNC_FOLDER_ID = /^[A-Za-z0-9_-]{10,100}$/;
export const isSyncFolderId = (id: string) => SYNC_FOLDER_ID.test(id);

export type SyncSubject = { id: number; name: string; code?: string; driveFolderIds?: string[] };

/**
 * The Drive files already dealt with, oldest first, then the ones tried in this sync: the order `fitSyncRequest`
 * expects, so past the cap it's the oldest that go. (The table's own order is by Drive id, which is no order at all.)
 */
export function knownIds(files: { driveId: string; at: number }[], tried: Iterable<string> = []): string[] {
  const last = new Set(tried);
  const ids = [...files].sort((a, b) => (a.at || 0) - (b.at || 0)).map((f) => f.driveId).filter((id) => !last.has(id));
  return [...ids, ...last];
}

/** The subjects, links and known ids of a sync request, trimmed to what the route accepts. `known` is oldest first. */
export function fitSyncRequest(subjects: SyncSubject[], known: string[]) {
  const kept = subjects.slice(0, SYNC_LIMITS.subjects);
  return {
    subjects: kept.map((s) => ({
      id: s.id,
      name: s.name.slice(0, SYNC_LIMITS.subjectName),
      code: s.code ? s.code.slice(0, SYNC_LIMITS.subjectCode) : undefined,
    })),
    // Past the cap the oldest ids are left out: a few long-imported files may be listed again, and the client skips
    // ids it already has.
    known: known.filter((k) => k.length <= SYNC_LIMITS.knownId).slice(-SYNC_LIMITS.known),
    // An id the route would refuse (one restored from an old backup, say) is dropped, not sent: the route rejects the
    // whole request over one bad id, which would fail every sync.
    links: kept
      .map((s) => ({ subjectId: s.id, folderIds: (s.driveFolderIds ?? []).filter(isSyncFolderId).slice(0, SYNC_LIMITS.folderIdsPerLink) }))
      .filter((l) => l.folderIds.length)
      .slice(0, SYNC_LIMITS.links),
  };
}
