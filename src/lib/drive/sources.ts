// Shared, public Google Drive folders the app pulls notes, slides and past papers from.
// The syllabus is NOT taken from here: it changes every year, so it's entered in the app.

export interface DriveSource {
  id: string; // folder id from the share link
  label: string;
}

// What the sync and date-sheet routes accept: each source costs ~80 Drive requests per sync.
export const MAX_DRIVE_SOURCES = 10;
export const MAX_SOURCE_LABEL = 100;

export const DEFAULT_DRIVE_SOURCES: DriveSource[] = [
  { id: "1RZ9HBZ0QLS7lYxt5jqUJBh8ZG7Fps_z2", label: "Amity subject library" },
  { id: "1x_19Nw6d3RqPEUjDgOj_Y5vtyWBcswCz", label: "My semester" },
];

/** Accepts a full share link or a bare id. */
export function folderIdFromLink(link: string): string | null {
  const m = link.match(/folders\/([A-Za-z0-9_-]{10,})/) ?? link.match(/^([A-Za-z0-9_-]{10,})$/);
  return m?.[1] ?? null;
}
