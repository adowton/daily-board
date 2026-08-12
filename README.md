# Daily Board — Ray White Altona

A personal working-memory board: static top-level buckets, ad-hoc projects underneath,
task status, priority flags, project health, and a guided daily review.

This version stores its data in **Airtable** — specifically, in a base called
**ADRE BD**, in three tables Claude already built for you there:

- **Daily Board - Categories** — your four main buckets
- **Daily Board - Projects** — the projects/listings under each bucket
- **Daily Board - Tasks** — individual tasks

Your four starting categories (Ray White, TDC / Lisa / Kids, Personal, Home / Bills /
Obligations) are already seeded in. You can open that base directly in Airtable any
time to browse or bulk-edit — that's the whole point of using Airtable over a plain
database.

**Total setup time: about 10 minutes.**

---

## Why there's a "proxy function" involved

The app can't talk to Airtable directly from your browser. Airtable's API token is a
bearer credential — anyone who has it can read and write your whole base — so it can
never sit in code that runs in a browser, where anyone could open dev tools and copy
it out.

The fix: a small serverless function (`netlify/functions/board.cjs`) sits between
your app and Airtable. Your phone and laptop talk to that function; the function
holds the token and talks to Airtable. The token never reaches the browser. This
piece is already written — you just need to give it a token to use.

One consequence worth knowing: Airtable doesn't push live updates the way some
databases do, so instead of instant sync, the app quietly re-checks Airtable every
12 seconds. In practice you won't notice this — you're not going to be staring at
two screens waiting for a task to appear — but it's a real difference from "instant."

---

## 1. Create your Airtable access token

1. Go to https://airtable.com/create/tokens
2. Click **Create new token**.
3. Name it something like `daily-board-app`.
4. Under **Scopes**, add:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
5. Under **Access**, add the **ADRE BD** base specifically (not all bases — no
   need to give this token more reach than it needs).
6. Click **Create token**, then copy it immediately — Airtable only shows it once.
   It'll look like `patXXXXXXXXXXXXXX.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`.

---

## 2. Run it locally first (optional but recommended)

You'll need [Node.js](https://nodejs.org) installed (any recent LTS version).

```bash
npm install
cp .env.example .env
```

Open `.env` and paste in your token:

```
AIRTABLE_TOKEN=pat...your token...
AIRTABLE_BASE_ID=appEke6pGjKSlmowq
```

(The base ID is already filled in for you in `.env.example` — that's the ADRE BD base.)

Then:

```bash
npm run dev
```

This uses `netlify dev`, which runs the React app **and** the serverless function
together locally — a plain `vite` server can't run the function on its own. The
first time you run it, it may ask you to log in to Netlify or continue without an
account; either is fine for local testing.

Open the local URL it prints. You should see your board load with your four
buckets, already showing the ones set up in Airtable.

---

## 3. Push it to GitHub

```bash
git init
git add .
git commit -m "Initial daily board"
```

Create an empty repo on GitHub, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

Your `.env` file is in `.gitignore`, so your Airtable token won't be pushed to
GitHub.

---

## 4. Deploy on Netlify

1. Go to https://app.netlify.com → **Add new site → Import an existing project**.
2. Connect GitHub and pick this repo.
3. Netlify auto-detects the build settings from `netlify.toml`. Leave them as-is —
   this also tells Netlify where to find the serverless function.
4. Before deploying, go to **Site configuration → Environment variables** and add:
   - `AIRTABLE_TOKEN` → your token from step 1
   - `AIRTABLE_BASE_ID` → `appEke6pGjKSlmowq`
5. Click **Deploy site**. After a minute or two you'll get a live URL like
   `https://your-site-name.netlify.app`.
6. Optional: **Site configuration → Change site name** to something memorable.

Every push to `main` redeploys automatically.

---

## 5. Get it on your phone

1. Open your Netlify URL in Safari (iPhone) or Chrome (Android).
2. **iPhone:** Share icon → **Add to Home Screen**.
   **Android:** ⋮ menu → **Add to Home screen** / **Install app**.
3. You get a home-screen icon that opens full-screen, no browser bar.

Both devices talk to the same Airtable base through the same serverless function,
so a task added on your phone shows up on your laptop within about 12 seconds
(and vice versa).

---

## Updating the app later without losing data

Your **code** lives in GitHub/Netlify. Your **data** lives in Airtable. They're
completely separate — pushing a code update rebuilds the app; it never touches
your Airtable records. The only thing to be careful of: if a future update adds a
new field (like we did with priority, health, and effort), the serverless function
needs to know about it on both the read side (mapping the Airtable field to the
app's data) and the write side. That's a code change I'll make deliberately each
time, the same way this version was built — not something that happens by
accident.

## If something breaks

- **Blank page / "Missing or insufficient permissions":** almost always the
  `AIRTABLE_TOKEN` or `AIRTABLE_BASE_ID` environment variable is missing or wrong
  in Netlify. Check **Site configuration → Environment variables**.
- **"Airtable 403" in the browser console:** your token's scopes or base access
  (step 1) don't cover what's needed — re-check `data.records:read`,
  `data.records:write`, and that the ADRE BD base is selected under Access.
- **Changes not showing up on the other device:** wait up to 12 seconds (the poll
  interval) before assuming something's wrong — this is normal, not a bug.
- **Local dev won't start:** make sure you ran `npm run dev` (which is `netlify
  dev`), not `npx vite` directly — the function won't be available otherwise.
