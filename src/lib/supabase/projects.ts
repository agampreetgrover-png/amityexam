// Which Supabase project (by its ref, the "abcd" in https://abcd.supabase.co) belongs to which environment.
// Refs are not secrets; they are committed so that changing them is a reviewed change:
//   - Every environment only runs against a ref listed for it: production under production; this computer and
//     Vercel Preview under development. While a list is empty, accounts stay off there, whatever the environment
//     variables say. (A Supabase running on this computer is listed by its host, e.g. "127.0.0.1".)
//   - A ref listed under development is refused in production, and a production ref is refused everywhere else, so
//     the two databases can't be mixed up by pasting the wrong URL into the wrong environment.
// Add the development ref when the development project is created (see .env.example). Add the production ref only
// when production accounts are approved.
export const SUPABASE_PROJECTS: { development: readonly string[]; production: readonly string[] } = {
  development: [],
  production: [],
};
