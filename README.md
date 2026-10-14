# Sidequest

Your life, on the same page. Sidequest is a small, private shared planner for two partners. It is an Astro static site that talks directly to Supabase Auth and the existing PostgreSQL tables. PostgreSQL row-level security remains the authorization boundary.

## What is here

- Today overview with today's events, overdue and due-today tasks, active projects, and goals.
- Weekly calendar agenda with shared and personal event labels, all-day events, date, time, and location.
- Tasks with priorities, due dates, project links, completion, and reopening.
- Projects and goals with status, dates, progress, and editing.
- Email and password sign-in through Supabase Auth.
- Private space creation for an authenticated user. The existing database trigger adds the owner as a member.
- Installable PWA shell and GitHub Pages deployment workflow.

The current Supabase project has no invitation Edge Function or invitation table, and its RLS policies do not permit adding a member from the browser. Sidequest does not offer an invite button or client-side membership writes. The second partner needs a secure single-use server-side invitation flow before they can join.

## Local development

Use Node.js 22.12 or newer (Astro 7 requirement). Install dependencies and set the two public Supabase environment values:

```sh
npm ci
cp .env.example .env.local
```

Edit `.env.local` with the Supabase project URL and its **publishable** key. The project URL is `https://ukgglmqnxhvpzryrwjrf.supabase.co`. Find the publishable key in Supabase Project Settings → API Keys. Never use a `service_role` or secret key in this app, `.env.example`, GitHub Pages variables, or any browser build.

Then start Astro:

```sh
npm run dev
```

Astro serves the app at `http://localhost:4321/`. The static production build uses `/Sidequest/` for GitHub Pages assets and routes.

## Supabase setup and data notes

The app uses the existing `spaces`, `space_members`, `events`, `tasks`, `projects`, and `goals` tables. It scopes each query by the visible space ID and relies on RLS for actual authorization. The live database has RLS enabled on all six tables. Its event SELECT policy makes shared events visible to space members and personal events visible only to their creator. The `private.is_space_member(uuid)` helper and the owner-membership trigger are already present. No database migration was needed for this app.

Email/password sign-in and account creation use Supabase Auth. If email confirmation is enabled, users must confirm through the email before signing in. In Supabase Authentication → URL Configuration, add the local URL (`http://localhost:4321/**`) and the deployed Pages URL (`https://kage7047.github.io/Sidequest/**`) to the allowed redirect URLs; set the production URL as the Site URL when appropriate.

The first account can sign in, create its space, and use the app. Until a secure invitation mechanism is configured, the other partner cannot be added from the app. Do not work around this by inserting a `space_members` row with browser credentials.

Dates are displayed in `Europe/Warsaw`; date-time form values are converted to UTC instants using that zone before persistence. The service worker caches only the static shell and same-origin build assets. It does not cache Supabase Auth or database responses, and edits require a network connection.

## GitHub Pages deployment

The workflow in `.github/workflows/deploy.yml` builds and deploys `main` to GitHub Pages. In the GitHub repository, configure Pages to use **GitHub Actions**. Add these repository Actions variables (Settings → Secrets and variables → Actions → Variables):

- `PUBLIC_SUPABASE_URL`: `https://ukgglmqnxhvpzryrwjrf.supabase.co`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key

Both values are intentionally public client configuration. Do not put a service-role key or database password in Actions variables, secrets, or the application. The build remains possible if these are missing, but the app will display setup guidance instead of connecting.

## Checks

```sh
npm run check
npm run build
```

The GitHub Actions workflow runs both checks before deployment. The PWA service worker and manifest use the production `/Sidequest/` base path.

## Current limits

- The invitation flow for the second member is not implemented because the live project has no server-side invitation facility to build on.
- Supabase Auth and database operations need project credentials and a network connection. Authentication and CRUD should be tested with real accounts before sharing the deployment.
- Calendar is a weekly agenda; there is no external calendar sync, recurring events, push notification, or offline editing.
- This is a static frontend. A publishable key is expected in the public build; RLS and Auth must remain enabled in Supabase.
