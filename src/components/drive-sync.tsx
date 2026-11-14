"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { runDriveSync, useDriveSync } from "@/lib/drive/client";
import { toast } from "./toast";

/**
 * Checks the Drive folders for new notes and past papers when the app opens, and says what any sync found
 * (on open, or after a subject is added). Settings shows a sync's status itself, so nothing pops up there.
 */
export function DriveSync() {
  const sync = useDriveSync();
  const onSettings = usePathname().startsWith("/settings");
  // A sync that was skipped (offline, synced recently, nothing set up) never runs, so it stays quiet.
  const sawRunning = useRef(false);

  useEffect(() => void runDriveSync({ auto: true }), []);

  useEffect(() => {
    if (sync.running) {
      sawRunning.current = true;
      return;
    }
    if (!sawRunning.current) return;
    sawRunning.current = false;
    if (onSettings) return;
    if (sync.imported) {
      toast(`Added ${sync.imported} file${sync.imported === 1 ? "" : "s"} from Google Drive`);
    } else if (sync.errors.length) {
      toast(`Drive sync couldn't read ${sync.errors.length} file${sync.errors.length === 1 ? "" : "s"}. Details are in Settings.`);
    } else if (sync.message && !/up to date/i.test(sync.message)) {
      // The sync itself failed (network, Drive API): the message carries the reason.
      toast(`Drive sync failed: ${sync.message}`);
    }
  }, [sync.running, sync.imported, sync.errors.length, sync.message, onSettings]);

  return null;
}
