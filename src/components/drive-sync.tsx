"use client";

import { useEffect } from "react";
import { runDriveSync } from "@/lib/drive/client";

/** Checks the Drive folders for new notes and past papers when the app opens. */
export function DriveSync() {
  useEffect(() => {
    runDriveSync({ auto: true });
  }, []);
  return null;
}
