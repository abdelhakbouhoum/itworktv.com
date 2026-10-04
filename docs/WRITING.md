# WRITING — IT Work TV

> The editorial guide: how a post is built, worded and checked. Structure and numbers come from [`PLAN.md`](./PLAN.md) (§4 front-matter schema, §5 tag registry) — this document is how you apply them. Companion docs: [`IMAGES.md`](./IMAGES.md) (the image pipeline), [`SEO.md`](./SEO.md) (search behaviour), [`SETUP.md`](./SETUP.md) (go-live).

**The reader promise.** One practical IT tip per day. The reader arrives from Google with one specific problem and wants the answer in under 60 seconds. Everything below serves that promise.

## 1. The golden rule: only publish commands you have actually tested

Do not publish a command you have not run. "Tested" means:

- You ran the **exact command as it appears in the post**, in the **environment you claim** — same OS and build, same tool and version — and saw the output it produced. A faithful replica is fine (a VM with the target OS build and tool version); a different version is not.
- Your `Verify` section quotes the output you actually saw, tidied only of machine-specific values (hostnames, paths, PIDs).
- "I read it in the docs", "it is basically the same on this version", "it used to work" are not tests.

How to record it: in the `tested_on` front-matter field (optional in the schema, strongly recommended; 1–5 entries, each ≤ 40 characters), name each test environment — the OS with its build and the tool with its version:

```yaml
tested_on: ["Windows 11 23H2", "PowerShell 7.4"]
```

- One entry is enough when every command in the post ran on that one machine.
- Name what the reader needs to know: `"Ubuntu 24.04 LTS", "bash 5.2"` — not `"Linux"`, not `"my laptop"`.
- Re-test on a newer version later? Update `tested_on` and set `updated` (the URL does not move — see §8).
- The build does not enforce this — `tested_on` is optional — but the pre-publish checklist does: a post that cannot name its test environment should not ship. If you cannot test it, do not publish it — hold it with `draft: true` until you can.

## 2. The post archetype

Fixed section order, every time:

**TL;DR → Problem → Steps/Commands → Verify → Troubleshooting → Rollback/Risks → References**

Each section is an `##` heading in that order. The layout supplies the page's single H1 (the post title) — the body never contains an H1, so a single-`#` heading has no place in a post. Fence every command block with a language tag (`powershell`, `bash`, `cmd`, or `text` for quoted output); highlighting happens at build time, so no JavaScript ever ships for it. Use `::: warning` callouts for near-misses and `::: danger` callouts for the commands that can break something.

The example below uses one post throughout — "find the process using a port on Windows" — which is also the worked example in [`PLAN.md` §4.2](./PLAN.md#42-worked-example).

### TL;DR — never omit

The answer, first. One to three sentences that contain the working command or the one-line fix. A reader who reads only this section walks away able to fix the problem — that is the 60-second promise, and it is the first thing Google shows.

````markdown
## TL;DR

`Get-NetTCPConnection -LocalPort 8080 | Select-Object -ExpandProperty OwningProcess`
prints the PID that owns the port. Confirm the process before you stop it.
````

### Problem — never omit

One short paragraph: the exact situation the reader is in — the symptom, what they have already tried, and the scope (which OS/tool, what you assume). No story, no restate of the TL;DR. It exists so the reader can confirm this post is for *their* case before investing in the steps.

````markdown
## Problem

Port 8080 is taken and you need the owning process fast. `netstat -ano` buries the
PID in a wide table you have to join by hand, and the column names differ between
Windows versions.
````

### Steps/Commands — never omit

Numbered steps, one command per step, a sentence of *why* before any command that is not obvious. This is the body of the post; everything after it exists to rescue the reader if it does not work first try.

````markdown
## Steps/Commands

1. Open PowerShell as administrator — reading the owning process of another
   user's process fails without elevation.

   ```powershell
   Get-NetTCPConnection -LocalPort 8080 -State Listen
   ```

2. Take the `OwningProcess` value from the output and name the process.

   ```powershell
   Get-Process -Id 4321
   ```

::: danger
`Stop-Process -Id 4321 -Force` kills the process without a clean shutdown. If it
is a service, stop the service instead.
:::
````

### Verify — never omit from a published post

The exact output or state the reader should see after the steps, quoted from your test run. This is what makes the post checkable: if the reader's screen does not match, they know something is different — and Troubleshooting takes over from there.

````markdown
## Verify

The port is free and the query returns nothing:

```text
PS> Get-NetTCPConnection -LocalPort 8080 -State Listen
PS>
```

No output, exit code 0. If a row is still listed, the process re-bound the port —
check the process name from step 2.
````

Every published post has a Verify section; the launch acceptance criteria check it. (A `draft` is not bound by this.)

### Troubleshooting — omit only when there is nothing to break

The failure modes you actually saw while testing, each as symptom → cause → fix. Two or three entries, most likely first. Do not write a directory of every conceivable error; write the ones a reader of this post will hit.

````markdown
## Troubleshooting

- **`Access is denied`** — the PowerShell session is not elevated. Rerun as
  administrator.
- **No rows returned** — the process is bound to a specific address, not the
  wildcard. Drop `-State Listen` and read `LocalAddress` to confirm.
````

Omit only when the post is pure read-only diagnostics with no realistic failure mode (rare — if a command can fail, name it).

### Rollback/Risks — omit only for read-only posts

What can go wrong and how to undo it: the inverse of each destructive step, in the order to run it, plus the blast radius (what happens if it ran on the wrong machine).

````markdown
## Rollback/Risks

Stopping the process ends its work without saving state. If it is a service you
stopped, bring it back with `Start-Service -Name "W3SVC"`. Nothing in this post
writes to disk or the registry; there is nothing else to roll back.
````

Omit only when every command in the post is read-only — no service stopped, no file or registry change, no network state change.

### References — omit only when you have nothing to cite

Vendor docs, release notes, the tool's own reference page. Use markdown footnotes (`[^1]`) so they stay out of the reading flow and collect in one block at the bottom of the page.

````markdown
The full parameter list for `Get-NetTCPConnection` is in the Microsoft reference[^1].

[^1]: Microsoft, *Get-NetTCPConnection* —
     <https://learn.microsoft.com/powershell/module/nettcpip/get-nettcpconnection>
````

Omit only when there is genuinely nothing external that backs the post. Most fixes have at least one vendor doc worth a footnote.

## 3. Front-matter reference

The complete, closed schema, enforced by the content validator: a post that fails does not build, and **any key not in this table fails the build** (a typo in a field name must fail loudly, not ship silently). Source of truth: [`PLAN.md` §4](./PLAN.md#4-front-matter-schema).

| Field | Type | Required | Constraints | Valid example |
|---|---|---|---|---|
| `title` | string | **yes** | ≤ 65 characters; no trailing `.`; no ALL CAPS; no unescaped `"` | `"Find the process using a port on Windows"` |
| `description` | string | **yes** | 120–160 characters; ends with a period; must stand alone as a Google snippet. Aim for ≤ 158 so the snippet renders cleanly — the validator allows up to 160 | `"Identify which process owns a given TCP or UDP port on Windows, find out what it is, and close it safely — without rebooting the machine or guessing PIDs."` |
| `date` | string | **yes** | `YYYY-MM-DD` — UTC, date-only, no time-of-day; **must equal** the date in the filename | `"2026-10-04"` |
| `updated` | string or `null` | no | same format as `date`; must be ≥ `date`; set only on a real editorial revision | `null` |
| `tags` | array of strings | **yes** | 1–5 entries — 1–3 is plenty; use 4–5 only when the post genuinely spans them; no duplicates; every entry must exist in [`src/_data/tags.json`](../src/_data/tags.json); **the first tag is the primary topic** | `[networking, windows]` |
| `difficulty` | enum | **yes** | exactly `beginner`, `intermediate` or `advanced` | `intermediate` |
| `tested_on` | array of strings | **no** (strongly recommended) | 1–5 entries; each ≤ 40 characters; each must name a real environment (§1) | `["Windows 11 23H2", "PowerShell 7.4"]` |
| `image` | string or `null` | no | `null`, or `r2:<YYYY>/<MM>/<slug>/<file>` where the key exists in the image manifest | `"r2:2026/10/find-process-using-port/hero.webp"` |
| `imageAlt` | string | **if `image` is set** | 10–125 characters; must not begin "image of", "picture of", "screenshot of" or "graph of" | `"PowerShell output showing PID 4321 owning TCP port 8080"` |
| `draft` | boolean | no | `true` excludes the post from the build and every feed; default `false` | `false` |

**Deliberately absent — do not add these** (each is a hard error, by design):

- `permalink` — the URL is derived from the filename; a hand-written permalink is how URLs rot (§8).
- `layout` — set once for the whole `src/posts/` directory.
- `excerpt` — `description` already does this job.
- `author` — one author, today; adding it later is additive.
- `featured` / `sticky` — the home page is "newest N"; a featured flag is a manual-override treadmill on a one-post-per-day site.
- `seo_title` / `seo_description` — `title` and `description` are written for search already.

A valid, complete front matter:

```yaml
---
title: "Find the process using a port on Windows"
description: "Identify which process owns a given TCP or UDP port on Windows, find out what it is, and close it safely — without rebooting the machine or guessing PIDs."
date: "2026-10-04"
updated: null
tags: [networking, windows]
difficulty: intermediate
tested_on: ["Windows 11 23H2", "PowerShell 7.4"]
image: "r2:2026/10/find-process-using-port/hero.webp"
imageAlt: "PowerShell output showing PID 4321 owning TCP port 8080"
draft: false
---
```

**Scheduling and drafts.** A *future* `date` keeps the post out of the production build until that day — the date is the scheduler and it never appears in the URL. `draft: true` removes the post entirely, whatever the date. Both are how work-in-progress lives safely on a public repo.

## 4. Tags

The registry lives in [`src/_data/tags.json`](../src/_data/tags.json) — twenty-six slugs at launch, defined in [`PLAN.md` §5.3](./PLAN.md#53-the-initial-26-tags). The rules that matter while you write:

- **Use only registry slugs.** The validator rejects a post that carries a tag that is not a key in `tags.json`. The registry is deliberately small and boring; the file is the authoritative list (it wins over any list in prose, including this document).
- **1–5 tags, no duplicates, and the order matters — though 1–3 is plenty.** Use 4–5 only when the post genuinely spans them. The first tag is the primary topic — it drives the emphasis on post cards, the related-posts block, and the tag feed readers follow. Put the most specific topic first and the platform second: `[networking, windows]`, not `[windows, networking]`, when the post is about a port.
- **You do not need a new tag for every post.** If the topic fits one of the twenty-six, use it. Adding a tag later is cheap (one key in the registry, then first use); renaming a published slug is not — it becomes a 301.
- **Thin tags are fine.** A tag with fewer than three posts still gets its page; it is simply `noindex, follow` until the third post lands ([`PLAN.md` §5.4](./PLAN.md#54-the--3-posts-rule)). Nothing in your post changes because of this.

## 5. SEO content conventions

- **Answer-first TL;DR.** The first section of the page contains the working command or the one-line answer, and the meta description (`description`) stands alone as a Google snippet — what the reader gets, not "In this post we will…".
- **One H1, always.** The layout renders the post title as the page's single H1. Never write an H1 in the body; `##` and below only. Exactly one H1 per page is a build-checked invariant.
- **Descriptive H2s.** The archetype section names are your H2s, in order. When you add a sub-heading, make it earn the place: `## When the port belongs to a service` beats `## More`.
- **Descriptive link text.** Link with what the page is about — "find the process using a port on Windows" — never "click here", "this page", or a bare URL.
- **Internal links do the navigation for you.** Where a step depends on another post, link to it (a deep link to the relevant section beats the post top). Link to tag pages when a whole topic is the next step ("more Windows networking fixes live in the networking tag"). Every indexable page on the site must be reachable by at least one internal link — an orphan page is a build-checked defect.
- **Why the first tag is the primary topic.** A post can wear up to five tags, but one of them is the one the post *is about*. That one drives the card emphasis, the related block, and which tag feed the post leads. If you cannot decide which tag is primary, the title usually tells you.
- **No keyword stuffing.** `title` and `description` are written for a person with a problem; the query words are in there because a person with that problem would type them.

## 6. Images

The full pipeline (optimise, upload, storage math) is in [`IMAGES.md`](./IMAGES.md); this is the writing-side contract.

**Inline images** use the `r2:` syntax in the body:

```markdown
![PowerShell output showing PID 4321 owning TCP port 8080](r2:2026/10/find-process-using-port/shot-1.webp "Step 2: name the process")
```

The build rewrites this into a `<figure>` with a responsive `srcset`, explicit `width`/`height` (which is how the page keeps its layout shift at zero) and lazy loading. The path after `r2:` is `<YYYY>/<MM>/<slug>/<file>` and must match a file the optimiser actually emitted — a key the manifest does not know will not resolve.

**Cover images** live in the front matter instead:

```yaml
image: "r2:2026/10/find-process-using-port/hero.webp"
imageAlt: "PowerShell output showing PID 4321 owning TCP port 8080"
```

The cover is what post cards and social shares show; the build fetches it eagerly instead of lazy-loading it, and `imageAlt` is mandatory whenever `image` is set.

**When a post needs which:**

- **Inline images** for anything that supports a step — the output you are explaining, a settings pane, a diff. Add as many as the post needs; they lazy-load and cost the reader nothing until seen.
- **A cover image** when one of your screenshots is a fair thumbnail of the post: the terminal showing the key output, the result state. Pick the one you would click in a card. If no screenshot would survive being that small, leave `image: null` — the site default is used and the post is no worse for it. One cover per post, and never invent cover art the post does not contain.

**Alt text, both kinds:** describe the *information* in the image, not its existence. `"PowerShell output showing PID 4321 owning TCP port 8080"` — not `"screenshot"`, and nothing beginning "image of", "picture of", "screenshot of" or "graph of" (the validator rejects those starts).

**Workflow:** drop source screenshots into `images-src/YYYY/MM/<slug>/`, run `npm run img:optimize` (strip metadata, emit the responsive WebP variants, generate the manifest your `r2:` keys must match), then `npm run img:upload` to R2. Credentials come from environment variables only — never committed.

## 7. Pre-publish checklist

Run top to bottom. `npm run check` covers the mechanical half; the rest is yours.

- [ ] **Golden rule:** every command in the post was actually run, and `tested_on` names the environment(s) where it was.
- [ ] **TL;DR answers the question:** a reader who stops after it can fix the problem; the path from the top of the page to the fix is under 60 seconds of reading.
- [ ] **Structure:** the seven archetype sections, in order, each an H2 — and no H1 in the body.
- [ ] `npm run check` passes (schema, tag registry, unknown keys, date/filename match).
- [ ] **`title`** is ≤ 65 characters, no trailing period, not ALL CAPS.
- [ ] **`description`** is 120–160 characters (aim for ≤ 158), ends with a period, and stands alone as a snippet.
- [ ] **`tags`** are 1–5, all in the registry, no duplicates, primary topic first.
- [ ] **`difficulty`** is set; **`date`** equals the filename's date and is UTC (future date to schedule, `draft: true` to hold).
- [ ] **Alt text** on every image; `imageAlt` present wherever `image` is set.
- [ ] **Links:** internal links to related posts and tag pages where they genuinely help; no dead link, no dead fragment.
- [ ] **State:** the post is ready to publish — `draft: false`, no work-in-progress placeholders.
- [ ] Commit and push: the build runs the full budget gate and deploys on green.

## 8. URLs never change

The URL is the promise. A post at `/posts/find-process-using-port/` lives there forever:

- The slug comes from the filename — `YYYY-MM-DD-slug.md` publishes at `/posts/slug/`; the date is stripped and never appears in a URL. Never hand-write a `permalink`; the field is not allowed at all.
- **Once published, a URL never changes.** A rename is not an edit: it is a new slug plus a `301` line in [`src/_redirects`](../src/_redirects) (owned by the devops engineer, with a dated comment line so the auditor can confirm the destination still exists) — and the old URL is never served again. Ask before renaming anything that has shipped.
- Refreshing a post when a tool version changes — a new flag, a renamed output — is an **edit in place**: fix the commands, re-test them, update `tested_on`, set `updated`, and keep the URL. That is the only sanctioned way to change a published post.

---

*Structure and numbers: [`PLAN.md`](./PLAN.md) §4 (front-matter schema), §5 (tag registry). Images: [`IMAGES.md`](./IMAGES.md). Search behaviour: [`SEO.md`](./SEO.md). This document ships as-is — no placeholders.*
