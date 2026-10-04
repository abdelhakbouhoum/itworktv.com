# IMAGES.md — IT Work TV image pipeline

> Images **never** pass through the site origin. Every image lives on Cloudflare R2 behind `https://img.itworktv.com` and is referenced by absolute URL. That is what keeps the deployed file count in the low hundreds (PLAN §1.4) and puts all image bytes under the R2 free tier (PLAN §10.6).

## The pipeline in one line

```
images-src/YYYY/MM/<slug>/        originals, local only (gitignored)
        |  npm run img:optimize    sharp: strip metadata, responsive WebP variants
        v
images-out/                       variants, local only (gitignored)
  + src/_data/images.json         manifest {width, height, variants:[{w, src}]}
        |  npm run img:upload      wrangler, credentials from .env
        v
R2 key  YYYY/MM/<slug>/<file>  ->  https://img.itworktv.com/YYYY/MM/<slug>/<file>
```

## Step by step

1. **Drop the original** into `images-src/2026/10/find-process-using-port/hero.png`
   (`.png` / `.jpg` / `.webp` all fine). The folder mirrors the post slug;
   `YYYY/MM` is the post's publish month. `images-src/` is **gitignored** —
   originals never enter the repo (see *What lives where*).
2. **`npm run img:optimize`** — sharp strips EXIF/metadata and writes
   **WebP variants at 480 / 800 / 1200 / 1600 widths** into `images-out/`,
   then (re)generates `src/_data/images.json`: one entry per `r2:` key with
   `width`, `height` and `variants: [{w, src}]`. Safe to re-run.
3. **`npm run img:upload`** — uploads every variant to the R2 bucket
   `itworktv-images` under the key `YYYY/MM/<slug>/<file>` with
   `Cache-Control: public, max-age=31536000, immutable`. Credentials come
   from the environment only: `CLOUDFLARE_ACCOUNT_ID` +
   `CLOUDFLARE_API_TOKEN` (SETUP.md step 7). Never from the repo.
4. **Reference it in the post** (next section), then `npm run check`:
   the validator fails the build if an `r2:` key is missing from the
   manifest, or a hero image has no `imageAlt` (PLAN §4).

## The `r2:` Markdown syntax

```markdown
![Task Manager showing explorer.exe holding PID 4321](r2:2026/10/find-process-using-port/hero.webp "Optional caption")
```

- The path after `r2:` is the **R2 key** (`YYYY/MM/<slug>/<file>`) — never a
  local path, never an `r2.dev` URL, never a full `https://` URL.
- At build time a markdown-it plugin rewrites it to a `<figure>` with
  `srcset` over the four variant widths, **explicit `width`/`height`**
  (so CLS stays 0 — PLAN §10.1), `loading="lazy"`, and a `<figcaption>`
  when a caption is given.
- **Cover images** (the post hero) get `fetchpriority="high"` and **no**
  lazy loading instead — they are part of the LCP element.
- The front-matter `image:` field uses the same key for the OG/social
  image: `image: "r2:2026/10/find-process-using-port/hero.webp"` (and
  requires `imageAlt`).
- A missing key, a missing variant, or a missing alt is a **build error**,
  not a warning — the golden rule, enforced mechanically.

## Immutable filenames — the one convention that matters

- Every upload carries `Cache-Control: public, max-age=31536000,
  immutable`: browsers and intermediates cache the URL for a year and
  **never revalidate** it.
- **To change an image, rename it — never overwrite.**
  - Screenshot is wrong? Save the fixed one as `hero-2.webp`, re-run
    optimize + upload, point the post's Markdown at the new key.
  - The old URL keeps serving the old bytes for up to a year: nothing
    breaks, and old links keep working.
  - Want the space back? Delete the old key later (R2 dashboard or
    `wrangler r2 object delete`). It is then gone; storage math accounts
    for this.
- **Uploading different bytes to the same key is the one real foot-gun:**
  visitors who already cached the URL see the *old* image for up to a year
  with no way to force a refresh. If you find yourself wanting to
  “re-upload the same file with new content”, stop — that is a rename.
- Re-running `img:upload` on **unchanged** files is always safe (same key,
  same bytes, nothing observable changes).

## What lives where

| Location | In git? | Notes |
|---|---|---|
| `images-src/YYYY/MM/<slug>/` | **no** (gitignored) | Originals. Local only — back them up if you care; variants cannot be regenerated without the original. |
| `images-out/` | **no** (gitignored) | Generated variants. |
| `src/_data/images.json` | **no** (generated, gitignored) | The manifest the build validates against; owned by eleventy-engineer, written by `img:optimize`. |
| `_site/` | **no** (gitignored) | **Zero** images. Every `<img>` points at `img.itworktv.com` (budget rule B8). |
| R2 bucket `itworktv-images` | — | The only place production images live. |

- **Dev mode:** set `IMAGE_BASE_URL` in `.env` to a local folder
  (e.g. `./images-out`) and `npm run dev` previews `r2:` images before
  anything is uploaded. Production builds use the default
  `https://img.itworktv.com`.
- **No CORS configuration** on the bucket: plain `<img>` loads are never
  CORS-enforced (only `fetch`/XHR/canvas are). Do not add a CORS rule
  unless JavaScript ever starts reading image bytes.
- **Never** CNAME or link `*.r2.dev` into content — development-only,
  rate-limited, explicitly not for production.

## Storage math — how long does the 10 GB free tier last at one post per day?

**Free tier (PLAN §10.6, verified 2026-10-04):** 10 GB-month storage,
1 M Class A operations/month, 10 M Class B, **free egress**.

**Assumptions (stated, not guessed):**

- **A1** — one post per day → **365 posts/year**.
- **A2** — **1 image per post** on average (the hero/primary screenshot;
  most tips need one, some none, a few two or three).
- **A3** — **4 WebP variants per image**: 480w, 800w, 1200w, 1600w.
- **A4** — average optimised bytes per variant. Terminal screenshots are
  ideal WebP material (high-frequency small text, few colours, sharp
  edges compress well):

  | variant | typical size |
  |---|---|
  | 480w | ≈ 15 KiB |
  | 800w | ≈ 30 KiB |
  | 1200w | ≈ 55 KiB |
  | 1600w | ≈ 80 KiB |

  → **≈ 180 KiB per image** (≈ 45 KiB average per variant).
- **A5** — clean renames: when an image is re-shot, the old key is deleted
  after its immutable year (leftovers are bounded in the table below
  regardless).

**The arithmetic:**

```
per image      180 KiB
per post       180 KiB x 1 image            = 180 KiB
per year       180 KiB x 365 posts         = 65,700 KiB
             = 64.2 MiB  ~=  67.3 MB (decimal)
free tier      10 GB = 10,000 MB (decimal)
years to fill  10,000 MB / 67.3 MB per year ~= 148 years
```

**Sensitivity — what if the assumptions drift?**

| Scenario | bytes/year | years to 10 GB |
|---|---|---|
| Baseline (1 image/post, 4 optimised variants) | 67 MB | **≈ 148** |
| 3 images per post | 202 MB | ≈ 49 |
| 10 images per post | 673 MB | ≈ 15 |
| Leftover renamed keys, 500/year, never deleted | +90 MB | negligible on top of baseline |
| **Pipeline bug: unoptimised PNGs uploaded** (≈ 2 MB x 4 variants ≈ 8 MB/image) | ≈ 2.9 GB | < 4 |

**Operations:** 4 PUTs per image x 365 = **1,460 Class A operations/year
≈ 122/month** against 1,000,000 free → 0.01 % of the quota.

**Conclusion:** at one post per day the 10 GB tier lasts **decades** — the
budget will never be the constraint. The only reason to glance at the R2
dashboard monthly (PLAN P4.5) is to catch a pipeline bug: the
*“unoptimised PNG”* row above is the failure mode to watch, and even it
has years of headroom. Egress is free, so serving costs nothing at any
realistic traffic.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `img:upload` fails 401 / `InvalidAccessKeyId` | Token created against the **Cloudflare REST** API instead of the **S3 API**, or the permission is not exactly `Object Read & Write` (SETUP.md step 7) |
| `img.itworktv.com` returns 522 | CNAME missing — zone not on Cloudflare NS yet, or the manual CNAME was never added (SETUP.md step 6) |
| Image still “old” after a “fix” | A key was overwritten instead of renamed (section above) |
| 429 / rate-limiting on image loads | An `*.r2.dev` URL leaked into content — replace it with the `r2:` key |
| Build fails: *image key not in manifest* | Run `npm run img:optimize` after adding or changing images, before `npm run check`/`build` |
