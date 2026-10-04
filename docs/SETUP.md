# SETUP.md — IT Work TV go-live checklist

> **How to use this document.** Follow the steps **in order**. Every step names the exact URL and the exact value to type, so nothing needs to be guessed. Budget: **~45–60 minutes of active clicking**, plus DNS propagation from step 2 running in the background (minutes to hours; it only blocks step 4).
>
> **Accounts you need**
> - a **GitHub** account (user `itworktv` — https://github.com/itworktv)
> - a **Cloudflare** account on the **Free** plan — https://dash.cloudflare.com/sign-up (the whole site runs on the free tier, $0/month; the ceilings we stay under are in PLAN §10.6)
> - the **registrar** where `itworktv.com` is registered (only step 2 touches it)
>
> **Secret rule.** The only two secrets in this whole setup are the R2 token (step 7) and the deploy-hook URL (step 8). Each goes into exactly one place, named below. **Never** paste either into a file in the repo; `.env` is gitignored and `.env.example` holds `REPLACE_ME` only.

---

## 1. Create the GitHub repo and push (~3 min)

1. Open **https://github.com/itworktv** → top-right → **New repository**.
2. Repository name: `itworktv` · Visibility: **Public**.
3. Do **not** tick “Add a README”, “.gitignore” or “Add a license” — the repo already has its own.
4. Click **Create repository**.
5. In the local repo folder (PowerShell):
   ```powershell
   git remote add origin https://github.com/itworktv/itworktv.git
   git branch -m main        # run only if the local branch is still named master
   git push -u origin main
   ```
6. GitHub records `main` as the default branch on the first push. Confirm: repo → **Settings** → **General** → *Default branch* shows `main`. CI triggers on `main` (`.github/workflows/ci.yml`).
7. Watch the first CI run: **https://github.com/itworktv/itworktv/actions** — it should go green (`npm ci → check → build → test → upload`). A red run here is the moment to stop and fix.

## 2. Move `itworktv.com` to Cloudflare nameservers (~5 min, then wait)

> **Why this is early and unavoidable:** an **apex** custom domain on Pages (`itworktv.com`, without `www`) only works while the zone sits on Cloudflare nameservers — attaching it before this completes gives HTTP 522. Subdomains are **not** blocked, so steps 5–7 can run in parallel with the wait below.

1. Log in at **https://dash.cloudflare.com/** → top-right → **Add a site** (or **https://dash.cloudflare.com/?to=domains** → **Add a site**).
2. Type `itworktv.com` → **Continue** → plan: **Free** → **Continue**.
3. Cloudflare displays **two nameservers** (they look like `someone.ns.cloudflare.com`). **Copy both.**
4. Log in to your domain **registrar** (where `itworktv.com` was registered) → DNS / nameserver settings → **replace** the existing nameservers with the two Cloudflare ones → save.
5. Wait for propagation: usually under an hour, worst case 24–48 h. Check with **https://dnschecker.org/?domain=itworktv.com&type=NS** — Cloudflare’s two nameservers should appear everywhere. In the Cloudflare dashboard the zone badge changes from *Pending* to *Active*.
6. **Do not proceed to step 4 until this is done.** Everything else (1, 3, 5, 6, 7, 8, 9) can continue meanwhile.

## 3. Connect Cloudflare Pages (~5 min)

1. **https://dash.cloudflare.com/?to=pages** → **Create a project** → **Connect to Git**.
2. Select **GitHub** → choose your personal account → **Authorize** the Pages app → select the repo `itworktv / itworktv`.
3. In the *Set up Cloudflare Pages* form, enter exactly:

   | Field | Value |
   |---|---|
   | Project name | `itworktv` |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Build output directory | `_site` |
   | Root directory | *(leave empty)* |
   | Framework preset | **Other** (do not pick a preset) |

   Then, under **Environment variables** (choose scope “production and preview”):

   | Variable | Value |
   |---|---|
   | `NODE_VERSION` | `22` |

4. Click **Save and deploy** (or *Deploy site*).
5. Watch the build log (1–3 min). On success you get a preview URL `https://itworktv-<hash>.pages.dev` and the project URL `https://itworktv.pages.dev`.
6. **Nothing to do for previews:** `src/_headers` already ships host-scoped `X-Robots-Tag: noindex` rules for `https://:project.pages.dev/*` and `https://:version.:project.pages.dev/*`, so no `*.pages.dev` URL is ever indexed (PLAN A3.4).

## 4. Custom domain + `www` → apex redirect (~5 min, **after step 2**)

### 4a. Attach the apex domain

1. Pages → project `itworktv` → **Custom domains** tab → **Add custom domain**.
2. Enter `itworktv.com` (the bare apex, **not** `www`) → confirm. The dashboard creates the DNS record for you — that is only possible because step 2 is done.
3. Wait for status **Active** (usually a few minutes).
4. Verify: `curl -I https://itworktv.com/` → **HTTP/2 200** (PLAN A3.1). A **522** means DNS has not propagated — back to the step 2 check.

### 4b. `www` → apex 301 (zone-level Redirect Rule)

> `src/_redirects` **cannot** do this — domain-level redirects are explicitly unsupported in Pages `_redirects` (verified 2026-10-04), which is why that file is comment-only. This is a **Cloudflare zone rule**:

1. Dashboard → zone `itworktv.com` → **Rules** → **Redirect rules** → **Create rule**.
2. Rule name: `www-to-apex`.
3. *If incoming request matches*: **hostname** `equals` `www.itworktv.com`.
4. *Then*: **Static redirect** · status code **301** · redirect to `https://itworktv.com` **plus the original path and query** — in the URL field use the dashboard’s expression insert for the request path and query (result shape: `https://itworktv.com<original path><original query>`).
5. Enable the rule. It is the only rule, so no priority is needed.
6. Verify: `curl -I https://www.itworktv.com/posts/anything/` → **301** with `location: https://itworktv.com/posts/anything/` — path preserved (PLAN A3.2) — and the same path on the apex returns 200.

## 5. Create the R2 bucket (~5 min)

1. **https://dash.cloudflare.com/?to=r2** → **Create a bucket**.
2. Name: `itworktv-images` · Location: any (e.g. `US` — it cannot be changed later) · Class: **Standard** (the default; free tier only).
3. **Payment-method prompt — expected, not a surprise:** Cloudflare may ask you to add a payment method to activate R2 **even though our usage stays in the free tier at $0** (PLAN §10.6). This is the one-time “purchase R2” free-with-usage checkout, and it is the gate that makes the API token in step 7 creatable at all. If you are comfortable with a card on file (you will not be billed at our volume), add it and complete the checkout.
4. **Set a billing alert so any accidental charge emails you:** dashboard top-right → **Account** → **Billing** → **Billing alerts** → create an alert: threshold **$1**, notify by email.
5. **Never use the auto-generated `*.r2.dev` URL in content** — it is development-only and rate-limited. Production images are served exclusively from `img.itworktv.com` (step 6).

## 6. Attach `img.itworktv.com` to the bucket (~3 min)

1. R2 → bucket `itworktv-images` → **Custom domains** (bucket navigation, or under *Settings*).
2. **Create/attach a custom domain**: enter `img.itworktv.com`.
   - Because the zone is on Cloudflare (step 2), the CNAME is created for you. *If step 2 is still pending when you reach here:* create the CNAME manually instead — type `CNAME`, name `img`, target = the bucket public endpoint the dashboard shows in the confirmation screen.
3. **No paid plan is required** for an R2 custom domain (verified 2026-10-04). Wait for the domain to show **Active** / certificate issued (a few minutes).
4. Verify: `curl -I https://img.itworktv.com/` → **any** HTTP answer (an empty bucket typically 403/404s) proves DNS + TLS work; a **522** means the CNAME is missing.

## 7. Create the R2 API token (~3 min)

1. R2 → bucket `itworktv-images` → **Settings** → **Manage API tokens** → create a token.
2. **API selector: choose `S3 API` — not “Cloudflare API” (REST).** A token created against the REST surface is the number-one cause of silent 401s (PLAN R6).
3. Permission: exactly **`Object Read & Write`** (scoped to this bucket).
4. The dashboard shows a credential pair:
   - **Access Key ID** = your Cloudflare account ID (16 hex chars — also visible under the account menu → *View account*).
   - **Secret Access Key** = the generated token. **It is shown once — copy it now.**
5. Where the values go (env only, never in the repo):
   - copy `.env.example` to `.env` in the repo root (`.env` is gitignored), then set
     `CLOUDFLARE_ACCOUNT_ID=<account id>` and `CLOUDFLARE_API_TOKEN=<secret access key>`.
   - Nothing in CI uploads images as of Phase 1, so no GitHub secret is needed for these.
6. **First real test** happens with the image pipeline (Phase 2, `npm run img:upload`). A 401/`InvalidAccessKeyId` at that point means the token was created against the REST API, or the permission is not exactly `Object Read & Write`.

## 8. Pages deploy hook → GitHub secret (~3 min)

1. Pages → project `itworktv` → **Settings** → **Hooks** → **Create hook**.
2. Type: **Deploy to production branch** — a plain, unauthenticated `POST` to the hook URL triggers a new production deploy (that is how the scheduled-publish workflow will bring future-dated posts live on their date). Name it `daily-publish`.
3. Copy the generated **hook URL**. The exact URL shape is not documented by Cloudflare — read it off the dashboard. **Treat it as a secret**: anyone holding it can trigger deploys.
4. GitHub: **https://github.com/itworktv/itworktv/settings/secrets/actions** → **New repository secret**:
   - Name: `CF_PAGES_DEPLOY_HOOK`
   - Value: the hook URL from step 3.
5. The workflow that *consumes* this secret (a daily cron + `workflow_dispatch` POSTing to the hook) lands in a later phase — as of Phase 1, plain pushes deploy the site on their own.

## 9. Web Analytics — Pages Metrics auto-injection (~2 min, owner’s confirmed choice)

1. Pages → project `itworktv` → **Metrics** → enable **Cloudflare Web Analytics** (auto-injection).
2. Done. Cloudflare injects a `type="module"` beacon at the edge (modules are deferred by default — that is why it is not “blocking” despite the budget rule’s intent). The beacon posts to our own `/cdn-cgi/rum`, which is already covered by `'self'` in `connect-src`. `src/_headers` ships `script-src … https://static.cloudflareinsights.com` **and** `connect-src 'self' https://cloudflareinsights.com` — the second host covers the manual-embedding mode, so switching modes never requires another `_headers` change (PLAN R9).
3. **No token, no env var, nothing to store.** The Web Analytics token exists only for the manual-embedding fallback in step 4 — with auto-injection there is nothing to put anywhere.
4. **Hard rule for later maintenance:** never add `Cache-Control: public, no-transform` to `/` or `/*` in `src/_headers` — it silently blocks the auto-injection (PLAN §10.5 / R9). The reason is recorded next to the omission so nobody “fixes” it back.
5. **Fallback (only if the toggle is unavailable):** get the token at **https://dash.cloudflare.com/?to=web-analytics** (add `itworktv.com`), then hand-embed the beacon in `head.njk` (a file owned by seo-specialist — route the change through the orchestrator): the token goes in as a **literal** in `data-cf-beacon='{"token":"…"}'` (no env var exists for it) and the script is `type="module"` and **must not** be changed to `async`. **No `_headers` change is needed** — `connect-src` already lists `https://cloudflareinsights.com` for exactly this case.
6. Verify after launch: DevTools → Network → a request to `…/cdn-cgi/rum` from the beacon (PLAN A3.7).

## 10. Search engines (~10 min, after the first production deploy)

### 10a. Google Search Console

1. **https://search.google.com/search-console** → **Add resource** → **Domain** → `itworktv.com`.
2. It shows a TXT record: name `_google-site-verification`, value `<shown string>`.
3. Cloudflare dashboard → zone `itworktv.com` → **DNS** → **Records** → **Add record**:
   type **TXT** · name `_google-site-verification` · content `<shown string>` · TTL **Auto**.
4. Back in Search Console: **Verify** → green check.
5. **Indexing → Sitemaps** → enter `sitemap.xml` (or `https://itworktv.com/sitemap.xml`) → **Submit**.
6. Spot-check: **URL Inspection** on `/` and two real posts → **Request indexing** (PLAN A3.15).

### 10b. Bing Webmaster Tools

1. **https://www.bing.com/webmasters** → sign in (any Microsoft account) → **Add a new site** → `https://itworktv.com`.
2. Verify with the **DNS TXT record** they display — add it the same way as step 10a.3 (Cloudflare DNS).
3. After verification: **Sitemaps** → add `https://itworktv.com/sitemap.xml`.

> Both TXT records live in the Cloudflare DNS panel because the zone is on Cloudflare (step 2).

---

## Post-checklist (should all pass — PLAN §9 Phase 3)

- [ ] `curl -sI https://itworktv.com/` → **200** over HTTPS (A3.1)
- [ ] `curl -sI https://www.itworktv.com/` → **301** to the apex, path + query preserved (A3.2)
- [ ] `curl -sI https://<version-hash>.itworktv.pages.dev/` → header `X-Robots-Tag: noindex` (A3.4)
- [ ] `curl -sI https://itworktv.com/feed.xml` (and `/sitemap.xml`, `/robots.txt`) → `X-Robots-Tag: noindex` (A3.5)
- [ ] `curl -sI https://itworktv.com/assets/<the .css file>` → `Cache-Control: public, max-age=31536000, immutable` (A3.9)
- [ ] `curl -sI https://itworktv.com/this-does-not-exist` → **404** (A3.10)
- [ ] `curl -sI https://itworktv.com/` does **not** send `Cache-Control: public, no-transform` (A3.8)
- [ ] Beacon request to `/cdn-cgi/rum` visible in DevTools (A3.7)
- [ ] R2 dashboard: bucket `itworktv-images` at 0 GB, billing alert live
- [ ] Google Search Console **and** Bing Webmaster Tools: verified + sitemap submitted

## Where every value lands (cheat sheet)

| Value | Goes to | Secret? |
|---|---|---|
| Cloudflare account ID | `.env` → `CLOUDFLARE_ACCOUNT_ID` | no (an identifier) |
| R2 S3 token | `.env` → `CLOUDFLARE_API_TOKEN` | **yes** |
| Deploy hook URL | GitHub secret `CF_PAGES_DEPLOY_HOOK` | **yes** |
| Web Analytics token | not needed (auto-injection); fallback = literal in `head.njk` | no |
| Search / TXT verification strings | Cloudflare DNS records (public by nature) | no |
| `IMAGE_BASE_URL` | `.env` (default `https://img.itworktv.com`; dev may point at a local folder) | no |
