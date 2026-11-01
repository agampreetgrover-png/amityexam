// Which Supabase projects this app may use, per environment. Nothing here is secret; it is committed so that changing
// it is a reviewed change:
//   - development / production: real projects, by their ref (the 20 lowercase letters or digits in
//     https://<ref>.supabase.co). This computer and Vercel Preview use development; Vercel Production uses production.
//     A ref listed under development is refused in production, and a production ref is refused everywhere else, so
//     the two databases can't be mixed up by pasting the wrong URL into the wrong environment.
//   - local: a Supabase running on this computer, by its exact host ("localhost", "127.0.0.1" or "[::1]"). Only ever
//     used off Vercel, and kept apart from the real refs: a local entry can never authorise a *.supabase.co address.
// While a list is empty, accounts stay off for it, whatever the environment variables say. Add the development ref
// when the development project is created (see .env.example). Add the production ref only when production accounts
// are approved.
export const SUPABASE_PROJECTS: { development: readonly string[]; production: readonly string[]; local: readonly string[] } = {
  development: [],
  production: [],
  local: [],
};
