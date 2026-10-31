# Amity Exams

A personal exam companion and AI study helper for Amity semesters. Keep your date sheet, syllabus, notes and past papers in one place, then use AI to make notes, quiz yourself, predict likely questions and ask doubts. It installs as an app (PWA) on your phone and laptop and works offline. Your data stays on the device. AI runs on free APIs: OpenRouter first, with Gemini as the backup.

## Setup

```bash
npm install
cp .env.example .env.local   # then paste your API key(s), see below
npm run build && npm start   # http://127.0.0.1:3000
```

The production build is the one to use day to day: it's faster and it's the only one that runs the service worker (offline mode and install). `npm run dev` is for working on the code. It resets any service worker left by a production build, so code changes show up.

**Local only by default.** `dev` and `start` listen on `127.0.0.1`, so other people on the same Wi-Fi (college or hostel network) can't reach the app or use up your AI keys. To open it from your phone for a while, run `npx next start` (without `-H 127.0.0.1`) with `ALLOWED_HOSTS=<your-laptop-IP>` set, visit `http://<your-laptop-IP>:3000`, and stop it when you're done. While it runs that way, anyone on the same Wi-Fi who knows the address can use your AI keys with a simple script, so only do it on a network you trust, or also set `APP_PASSWORD`.

Your data lives in the browser's storage for that exact address, so keep opening the app at `http://127.0.0.1:3000`. `localhost:3000` or another port starts with an empty app.

Deploying (for example to Vercel) is optional. If you do, set `APP_PASSWORD`: every device then asks for it once, and nobody else can open the app or use your AI keys. Without it, anyone with the URL can. To serve the app under your own domain without a password, list that domain in `ALLOWED_HOSTS`. The AI and Drive routes only answer to this computer's own addresses (`localhost`, `127.0.0.1`) otherwise, which stops other websites from reaching a copy running on your laptop. Requests from other websites are refused either way.

Drive sync parses PDFs, DOCX and PPTX in a worker loaded from `src/lib/drive/extract-worker.mjs`, so run the server from the project folder (`npm start`). Bundled serverless deploys don't include that file.

## Getting API keys

Both keys are free and both are optional; set at least one in `.env.local`.

- **OpenRouter** (tried first): create a key at https://openrouter.ai/keys. Uses free models only, and tries several in turn. Also reads scanned PDFs and photos.
- **Gemini** (the backup): create a key at https://aistudio.google.com/apikey. A Gemini app subscription (Google AI Pro) is **not** needed and doesn't add API quota. Also reads scans and photos.

If OpenRouter hits a limit, times out or fails, the app moves to Gemini on its own. **Settings → AI** shows which keys are set and which provider answered last. Never commit `.env.local`; it's already in `.gitignore`.

## Workflow

1. **Exam mode**: pick **Mid-sem** or **Major (End-term)** in Settings or from the mode pill. Syllabus, papers and exams all follow the mode. Units tagged mid-sem are in both; the rest are major only.
2. **Subjects**: add each subject, then **Syllabus → Import syllabus** (paste text, or upload the syllabus PDF or a photo of it). Mark topics as studied or revised as you go.
3. **Exams**: add the date sheet by hand or with **Upload date sheet** (date, time, venue, seat, and which topics are examined).
4. **Today** (the home page): a countdown to the next exam with its date, time, hall and how much of its syllabus you've covered; the next few exams as cards; your overall readiness for this exam mode; a month calendar of the date sheet (written papers and practicals marked differently); and your latest cheat sheets one tap away.
5. **Subject** tabs:
   - **Materials**: your notes and slides (PDF, text, or photos/scans, which are read by AI)
   - **PYQs**: past papers turned into a question bank, by year or by topic, with search
   - **Notes**: short notes or one-page cheat sheets per topic
   - **Quiz**: MCQ and short-answer practice. AI grades short answers, and low scores mark topics as weak
   - **Predict**: repeated questions, weightage and likely questions from past papers
   - **Ask**: a quick doubt chat for that subject, answered from your own notes
6. **Chat**: the study chat. Pick a subject and ask anything, or start from a tile (**High-yield prediction**, **Model answer**, **Rapid drill**, **Strategy**):
   - Answers are taught from your teacher's notes, which they cite by file name.
   - They're checked against past papers, with the year and marks when a question has been set before, e.g. "PYQ 2023, 10 marks".
   - They're pitched at your coming exam: its date, the most-asked topics and your weak ones.
   - Most answers end with an **In the exam** tip.
   - The chat never asks you to paste notes: it already has the subject's syllabus, notes and papers. Ask about another subject (by name, code or initials, like "ADA") and it moves the question there.
   - Choose **Auto**, **Simple**, **Exam answer** (sized to the marks) or **Quick revise**.
   - Formulas show as proper maths, and code comes in highlighted blocks with a copy button. The same goes for notes and cheat sheets.
   - Every conversation is saved in **History**: grouped by date and searchable. You can rename, pin, copy or delete each one.
7. **Important**: the topics asked most often in this exam's past papers, across all your subjects, with the questions under each.
8. **Zero prep**: topics you can learn cold, without studying anything else first. AI rates each topic for groundwork needed, time and importance, and the quickest wins come first.
9. **Exam page**: exam details, a packing checklist, the cheat sheet and weak topics. Printable.

Press **Ctrl+K** (⌘K on Mac) anywhere to jump to a page, subject or exam, or switch mode.

### Google Drive

The app pulls notes, slides and past papers from shared Drive folders when you open it (two folders are set up by default). Files are matched to your subjects by name, and past papers are tagged mid-sem or major from their file names. Scanned papers are read by AI, up to 10 each time you open the app, to save quota. Add or remove folders, or link a folder to a subject, in **Settings → Google Drive**. The syllabus is never taken from Drive, since it changes every year.

### Other settings

- **Appearance**: light, dark or follow the system.
- **Reminders**: an alert the day before each exam, while the app is open.
- **Your data**: **Export backup** and import (saved chats included). Use the same file to move data between phone and laptop. A backup is checked before it replaces anything, so a damaged file can't wipe your data.

## Tech

Next.js 15 · TypeScript · Tailwind v4 · Dexie (IndexedDB) · Serwist (PWA) · pdf.js · SheetJS (spreadsheet date sheets) · mammoth (Word files from Drive) · react-markdown with KaTeX (maths) and highlight.js (code) · Vitest.

AI providers and default models, each overridable in `.env.local`:

| Provider | Main | Fast | Override with |
| --- | --- | --- | --- |
| OpenRouter | `nvidia/nemotron-3.5-super-vl:free`, then two more free models | `nvidia/nemotron-3.5-lightning:free`, then two more | `OPENROUTER_MODEL`, `OPENROUTER_FAST_MODEL`, `OPENROUTER_VISION_MODEL` (comma-separated lists) |
| Gemini | `gemini-3.5-flash` | `gemini-3.5-flash-lite` | `GEMINI_MODEL`, `GEMINI_FAST_MODEL` |

The full default lists are in `.env.example`.

`npm test` runs the unit tests and `npm run lint` runs ESLint.
