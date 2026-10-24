// Kept apart from theme.ts (which uses React hooks) so the server-rendered root layout can import it.
export const THEME_KEY = "theme";

/** Runs inline in <head> before anything paints, so a pinned theme never flashes the other one first. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
