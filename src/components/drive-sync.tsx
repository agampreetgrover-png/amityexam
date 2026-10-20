"use client";

import { useEffect, useRef } from "react";
import { runDriveSync, useDriveSync } from "@/lib/drive/client";
import { toast } from "./toast";

/** Checks the Drive folders for new notes and past papers when the app opens, and says what happened. */
export function DriveSync() {
  const sync = useDriveSync();
  // Only the sync started here (on open) is reported; a manual sync shows its status in Settings.
  const watching = useRef(false);
  const sawRunning = useRef(false);

  useEffect(() => {
    watching.current = true;
    void runDriveSync({ auto: true }).finally(() => {
      // An auto sync that was skipped (offline, synced recently, nothing set up) never runs: stay quiet.
      if (!sawRunning.current) watching.current = false;
    });
  }, []);

  useEffect(() => {
    if (!watching.current) return;
    if (sync.running) {
      sawRunning.current = true;
      return;
    }
    if (!sawRunning.current) return;
    watching.current = false;
    sawRunning.current = false;
    if (sync.imported) {
      toast(`Added ${sync.imported} file${sync.imported === 1 ? "" : "s"} from Google Drive`);
    } else if (sync.errors.length) {
      toast(`Drive sync couldn't read ${sync.errors.length} file${sync.errors.length === 1 ? "" : "s"}. Details are in Settings.`);
    } else if (sync.message && !/up to date/i.test(sync.message)) {
      // The sync itself failed (network, Drive API): the message carries the reason.
      toast(`Drive sync failed: ${sync.message}`);
    }
  }, [sync.running, sync.imported, sync.errors.length, sync.message]);

  return null;
}
