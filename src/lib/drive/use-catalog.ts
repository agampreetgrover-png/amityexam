"use client";

import { useEffect, useState } from "react";
import type { Course } from "./catalog";

const KEY = "amityexams:courseCatalog";

/** Course list for code auto-fill. Cached in localStorage so it also works offline. */
export function useCourseCatalog(): Course[] {
  const [courses, setCourses] = useState<Course[]>([]);
  useEffect(() => {
    let alive = true;
    try {
      const cached = localStorage.getItem(KEY);
      if (cached) setCourses(JSON.parse(cached));
    } catch {
      // storage unavailable; fall through to the network
    }
    fetch("/api/drive/catalog")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Course[]) => {
        if (!alive || !list.length) return;
        setCourses(list);
        try {
          localStorage.setItem(KEY, JSON.stringify(list));
        } catch {
          // not important
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return courses;
}
