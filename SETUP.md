# Putting BSL Sign Stories on signstories.andymiah.net

You'll set up three free services, in this order:

1. **Supabase**, which holds the database, sign-ins and uploaded files.
2. **GitHub Pages**, which hosts the website files.
3. **Squarespace DNS**, which points `signstories.andymiah.net` at GitHub.

It takes about an hour. Menu names below were correct when this guide was written, but these services do rename things occasionally.

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The site |
| `app.js` | How the site works |
| `config.js` | Your settings. **This is the only file you edit.** |
| `privacy.html` | Privacy, consent and removal page |
| `schema.sql` | Database setup, pasted into Supabase once |
| `CNAME` | Tells GitHub Pages which address to use |
| `SETUP.md` | This guide (it doesn't need uploading) |

---

## Part 1: Supabase (database and sign-in)

1. Go to **supabase.com** and sign up. Signing up with your GitHub account is quickest.
2. Click **New project**.
   - **Name:** `signstories`
   - **Database password:** click *Generate*, then save it in your password manager. You won't need it day to day.
   - **Region:** *West EU (London)*, which keeps the data in the UK.
3. Wait a minute or two for the project to finish setting up.
4. In the left menu, open **SQL Editor** and click **New query**. Open `schema.sql`, copy all of it, paste it in, and click **Run**. You should see "Success. No rows returned".
5. Open **Authentication → URL Configuration**.
   - **Site URL:** `https://signstories.andymiah.net`
   - Under **Redirect URLs**, add `https://signstories.andymiah.net/**`
6. Open **Project Settings → API**. It may be called *Data API* or *API Keys*. Copy two things:
   - **Project URL**, which looks like `https://abcd1234.supabase.co`
   - **anon public** key, a long string
7. Open `config.js` in a text editor and paste them in, replacing `PASTE_PROJECT_URL_HERE` and `PASTE_ANON_PUBLIC_KEY_HERE`. Put your contact email in `CONTACT_EMAIL` if you'd like it shown on the site.

The anon key is designed to be public. The rules in `schema.sql` are what protect the data.

### Before you launch: sign-in emails

Supabase's built-in email service only sends a handful of sign-in emails per hour. That's fine for testing, but not for a launch. Connect a free email-sending service:

1. Sign up for a sending service such as **Resend** or **Brevo**. Both have free tiers. Verify `andymiah.net` with them; they'll give you DNS records to add in Squarespace, the same way as Part 3.
2. In Supabase, open **Authentication → Emails → SMTP Settings**, turn on custom SMTP, and enter the details the service gives you.
3. Optional: under **Authentication → Emails → Templates**, edit the "Magic Link" email so it mentions BSL Sign Stories.

---

## Part 2: GitHub Pages (the website)

1. Sign in at **github.com**, then click **+ → New repository**.
   - **Name:** `signstories`
   - **Public**. The free plan needs this for Pages, and it's fine because nothing secret is in the files.
   - Click **Create repository**.
2. On the new repository page, click **uploading an existing file**. Drag in `index.html`, `app.js`, `config.js` (with your details filled in), `privacy.html` and `CNAME`, then click **Commit changes**.
3. Go to **Settings → Pages**.
   - **Source:** *Deploy from a branch*
   - **Branch:** `main`, folder `/ (root)`, then click **Save**.
   - **Custom domain:** `signstories.andymiah.net`, then click **Save**. GitHub will report the DNS check failing until you finish Part 3; that's expected.

---

## Part 3: Squarespace DNS (the address)

1. In Squarespace, open **Domains** and click **andymiah.net**.
2. Open **DNS** (or **DNS Settings**). Under **Custom records**, click **Add record**:
   - **Type:** `CNAME`
   - **Host:** `signstories`
   - **Data / Points to:** `YOUR-GITHUB-USERNAME.github.io`
   - Save.
3. Back in GitHub **Settings → Pages**, wait until the domain check shows a green tick. This is usually within an hour, occasionally longer. Then tick **Enforce HTTPS**.
4. Visit **https://signstories.andymiah.net**.

Your main andymiah.net site is untouched. To link to the project, add a navigation link or a button in Squarespace pointing to `https://signstories.andymiah.net`.

---

## Part 4: make yourself a moderator

1. On the live site, click **Sign in**, use your email link, and fill in your name.
2. In Supabase's **SQL Editor**, run this with your own email address:

```sql
insert into public.moderators (user_id)
select id from auth.users where email = 'YOUR-EMAIL-HERE';
```

3. Reload the site. A **Moderation** tab appears, listing new posts waiting for approval.

To add panel members as moderators later, ask them to sign in once, then run the same command with their email.

---

## Good to know

- **New posts wait for approval.** Posts appear publicly after a moderator approves them. People always see their own posts, marked "Awaiting approval".
- **Free-plan limits.** Supabase's free plan pauses a project after a period with no activity (currently about a week); you restart it from the dashboard. File storage on the free plan is limited (around 1 GB), and videos use it quickly, which is one reason the site encourages video links. A paid plan removes both limits if the project grows.
- **Making changes later.** Edit a file on GitHub (open it, click the pencil, then *Commit changes*) and the site updates within a minute or two.
- **Moving content from the claude.ai version.** If people add entries to the claude.ai pilot first, ask Claude to export them and write them into Supabase.
