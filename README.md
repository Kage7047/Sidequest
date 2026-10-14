# Sidequest

Your life, on the same page. Sidequest is a small, private shared planner for two partners. It is an Astro static site that talks directly to Supabase Auth and the existing PostgreSQL tables. PostgreSQL row-level security remains the authorization boundary.

## What is here

- Today overview with today's events, overdue and due-today tasks, active projects, and goals.
- Weekly calendar agenda with shared and personal event labels, all-day events, date, time, and location.
- Tasks with priorities, due dates, assignment, repeating schedules, reminders, project links, completion, and reopening.
- Shared grocery, packing, and custom lists, plus a shared someday list for date ideas, places, and activities.
- Projects and goals with status, dates, progress, and editing.
- Email and password sign-in through Supabase Auth.
- Private space creation for an authenticated user. The existing database trigger adds the owner as a member.
- Single-use partner invitations tied to the invited email. Owners can create a link that expires in seven days; the invitee must confirm that email, then accept the invite while signed in with it.
- Installable PWA shell, with Android home-screen shortcuts for adding a task and opening lists.

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

The app uses the existing `spaces`, `space_members`, `events`, `tasks`, `projects`, and `goals` tables, plus `shared_lists`, `shared_list_items`, and `shared_ideas`. It scopes each query by the visible space ID and relies on RLS for actual authorization. Shared planning tables are protected by member-scoped RLS policies. Tasks can be assigned only to a member of their space. Completing a repeating task creates the next occurrence in the database. The event SELECT policy makes shared events visible to space members and personal events visible only to their creator. The `private.is_space_member(uuid)` helper and owner-membership trigger are already present. The invitation migrations create a private token-hash table and restricted RPC functions; browser writes to `space_members` are not allowed.

Email/password sign-in and account creation use Supabase Auth. If email confirmation is enabled, users must confirm through the email before signing in. In Supabase Authentication → URL Configuration, add `http://localhost:4321/**` and `https://kage7047.github.io/Sidequest/**` to the allowed redirect URLs. Set the Site URL to `https://kage7047.github.io/Sidequest/` so email confirmation returns to the app.

The first account signs in and creates the space. Use **Invite partner** to create a one-use link for the partner’s email, then share it privately. The partner opens the link, creates an account using that same email, confirms it, and signs in. The server consumes the invitation and adds the member. Invitation hashes stay in the private schema; the browser never writes to `space_members` directly. The email message itself is shared manually; the project does not have an outbound email sender configured for invitations.

Dates are displayed in `Europe/Warsaw`; date-time form values are converted to UTC instants using that zone before persistence. Reminders use browser notifications while Sidequest is open. Background reminders need a separately secured server-side push service. The service worker caches only the static shell and same-origin build assets. It does not cache Supabase Auth or database responses, and edits require a network connection.

## GitHub Pages deployment

The workflow in `.github/workflows/deploy.yml` builds and deploys `main` to GitHub Pages. It includes the project's public Supabase URL and publishable key as build-time environment fallbacks, so a fresh deploy can connect without creating Actions variables. These values are expected to be public in a browser app; RLS remains the authorization boundary. To override them for another environment, add these repository Actions variables (Settings → Secrets and variables → Actions → Variables):

- `PUBLIC_SUPABASE_URL`: `https://ukgglmqnxhvpzryrwjrf.supabase.co`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key

Both values are intentionally public client configuration. Do not put a service-role key or database password in Actions variables, secrets, or the application.

For the first GitHub Pages publish, set repository **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Then check the latest `Deploy Sidequest to GitHub Pages` run in Actions.

## Checks

```sh
npm run check
npm run build
```

The GitHub Actions workflow runs both checks before deployment. The PWA service worker and manifest use the production `/Sidequest/` base path.

## Current limits

- Supabase Authentication URL Configuration must include the Pages redirect URL above; otherwise email confirmation may not return to the app. Real account flows need to be confirmed with your and Angie’s accounts.
- Calendar is a weekly agenda; there is no external calendar sync, recurring events, background push reminders, or offline editing.
- A web app can install as an app and provide Android icon shortcuts, but a glanceable iPhone or Android home-screen widget requires native app/widget work.
- This is a static frontend. A publishable key is expected in the public build; RLS and Auth must remain enabled in Supabase.
