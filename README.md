# Amity Exams

A personal exam planner and AI study helper. It covers everything from adding your date sheet to exam morning. It installs as an app (PWA) on your phone and laptop. Your data stays on the device. AI runs on the free Gemini API, with Groq as an automatic backup.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your API key(s), see below
npm run dev                  # http://localhost:3000
```

The service worker (offline mode and install) only runs in production builds:

```bash
npm run build && npm start
```

**Local only by default.** `dev` and `start` listen on `127.0.0.1`, so other people on the same Wi-Fi (college or hostel network) can't reach the app or use up your AI keys. To open it from your phone for a while, run `npx next dev` (without `-H 127.0.0.1`), visit `http://<your-laptop-IP>:3000`, and stop it when you're done.

Deploying (for example to Vercel) is optional. If you do, anyone with the URL can use your AI keys, so keep the URL private.

## Getting API keys

Both keys are free and both are optional; set at least one in `.env.local`.

- **Gemini** (primary): create a key at https://aistudio.google.com/apikey. A Gemini app subscription (Google AI Pro) is **not** needed and doesn't add API quota. Gemini also reads scanned PDFs and photos of notes.
- **Groq** (backup): create a key at https://console.groq.com/keys. Very fast, but the free tier allows only ~8K tokens/minute, so long notes are trimmed.

If Gemini hits a limit, times out or fails, the app switches to Groq on its own. **Settings** shows which keys are set and which provider answered last. Never commit `.env.local`; it's already in `.gitignore`.

## Workflow

1. **Subjects**: add each subject, then **Syllabus → Import with AI** (paste text, or upload the syllabus PDF or a photo of it).
2. **Exams**: add the date sheet (date, time, venue, seat, and which topics are examined).
3. **Subject → Materials**: upload notes and previous-year papers (PDF, text, or photos/scans, which are read by Gemini). Then use:
   - **Notes**: short notes or one-page cheat sheets per topic
   - **Quiz**: MCQ and short-answer practice. AI grades short answers, and low scores mark topics as weak
   - **PYQ Predict**: repeated questions, weightage and likely questions
   - **Doubt Chat**: answers based on your own notes
4. **Progress**: coverage, quiz trend and weak topics.
5. **Exam → Kit**: checklist, night-before tips, cheat sheet and weak topics. Printable.

Back up from **Settings → Export backup**. Use the same file to move data between devices.

## Tech

Next.js 15 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Serwist (PWA) · Gemini via `@google/genai` (`gemini-3.5-flash`, `gemini-3.5-flash-lite`) with Groq fallback (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`); override with `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GROQ_MODEL`, `GROQ_FAST_MODEL` · pdf.js · Recharts · Vitest.

`npm test` runs the unit tests.
