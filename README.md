# Image Diff Inspector — Backend

NestJS 10 service that exposes `POST /api/diff` — accepts two images
as multipart form fields and returns the bounding boxes of every
visual difference between them, along with the algorithm's wall-clock
processing time in milliseconds.

This is the **server-side** counterpart to the
`image-diff-frontend` repo. The frontend ships with the same
algorithm running in a Web Worker and uses it by default; this backend
exists for full-resolution diffing of very large screenshots where
running in the browser would either OOM or get down-sampled.

- **Stack:** NestJS 10, TypeScript, sharp (libvips), pixelmatch.
- **Endpoint:** `POST /api/diff` (multipart) returning JSON.
- **No database, no Redis, no auth.** This is a single-purpose
  image-processing service.

---

## 1. How to run the application

Requirements: **Node ≥ 20**. On Windows or Linux, `sharp` will install
a prebuilt libvips binary automatically — no system libraries needed.

```bash
cp .env.example .env
npm install
npm run dev          # → http://localhost:8000
```

The dev server runs under `nest start --watch` and reloads on file
changes. Once up:

- **Friendly landing page**: <http://localhost:8000/>
- **Healthcheck**: <http://localhost:8000/api/healthcheck>
- **Swagger UI**: <http://localhost:8000/api-docs>

### Production build

```bash
npm run build        # nest build → build/
npm run prod         # node build/web
```

### Quick smoke test

With the server running:

```bash
node test/smoke-diff.mjs
```

Generates two synthetic PNGs (a moved/recolored shape on a white
background), posts them to `/api/diff`, and prints the JSON response.
Useful sanity check after dependency upgrades.

### Endpoint reference

`POST /api/diff` — multipart/form-data with the following fields:

| Field                | Type   | Required | Notes                                       |
| -------------------- | ------ | -------- | ------------------------------------------- |
| `before`             | file   | yes      | Any common image format (PNG, JPG, WEBP…).  |
| `after`              | file   | yes      | Same formats. Dimensions need not match.    |
| `sensitivity`        | string | no       | `0..100`, defaults to `60`.                 |
| `ignoreAntialiasing` | string | no       | `"true"` (default) or `"false"`.            |

Response:

```jsonc
{
  "width": 1920,
  "height": 1080,
  "boxes": [
    { "x": 100, "y": 80, "width": 60, "height": 32, "pixels": 1280 }
  ],
  "changedPixels": 4123,
  "durationMs": 18.4,
  "dimensionMismatch": false
}
```

### Configuration

All knobs are environment variables — see `.env.example`. Defaults are
fine for local dev.

| Variable           | Default        | Notes                                                 |
| ------------------ | -------------- | ----------------------------------------------------- |
| `APP_PORT`         | `8000`         | Listen port. Falls back to `$PORT` (Railway / Render / Heroku / fly inject that). |
| `BODY_SIZE`        | `60mb`         | Total multipart body parser limit (must fit ~2 files).|
| `MAX_IMAGE_BYTES`  | `31457280`     | Per-file cap in bytes (30 MB). Adjust upward freely.  |
| `CORS_ORIGIN`      | `http://localhost:5173` | Comma-separated allow list for the frontend. Any `*.vercel.app` host is also auto-allowed. |
| `LOGGER_LEVEL`     | `info`         | NestJS logger level.                                  |

### Deploying to Railway

The service is a vanilla NestJS app: no platform-specific code, just one
declarative `railway.json` that points Railway at `npm run build` and
`npm run prod`. If you ever switch to Render / fly.io / your own VPS,
delete `railway.json` and everything still works — the same build and
start commands are used.

Steps:

1. Push this repo to GitHub.
2. On <https://railway.app>, **New Project → Deploy from GitHub repo**
   and select this backend repo.
3. Railway auto-detects Node and reads `railway.json`:
   - **Build:** `npm install --include=dev && npm run build`
   - **Start:** `npm run prod`
   - **Healthcheck:** `GET /api/healthcheck`
4. In the Railway dashboard → **Variables**, set:
   - `CORS_ORIGIN` → your frontend's production URL
     (e.g. `https://image-diff-frontend.vercel.app`). Comma-separated
     for multiple. Any `*.vercel.app` host is already allowed
     automatically so preview deploys work without further config.
   - Optional: `MAX_IMAGE_BYTES`, `BODY_SIZE` if you need bigger
     uploads.
   - **Don't** set `APP_PORT` — Railway injects `PORT` and the app
     reads it via the fallback in `src/shared/config/configuration.ts`.
5. Railway will assign a domain like
   `image-diff-backend-production.up.railway.app`. Copy that — you
   need it for the frontend's `VITE_API_BASE_URL`.
6. Smoke test: `curl https://<your-domain>/api/healthcheck` should
   return `{"message":"Ok"}`.

### Deploying to Vercel

NestJS also runs fine as a Vercel serverless function via the small
adapter at `api/index.ts`. The adapter is the **only** Vercel-specific
TypeScript file — it doesn't even import `@vercel/node`. It uses plain
Node `http` types and forwards every request into the same Express
instance that `npm run prod` would have started.

Both deploy paths (Railway and Vercel) share the bootstrap logic in
`src/bootstrap.ts`, so CORS / body limits / global pipes can never
drift between them.

Steps:

1. Push this repo to GitHub.
2. On <https://vercel.com>, **Add New → Project → Import** this repo.
3. Vercel reads `vercel.json`:
   - All `/api/*` traffic → the serverless function at `api/index.ts`.
   - `/` → the static landing page at `public/index.html`.
   - Function memory: **1024 MB** (recommended — sharp's libvips
     decoder uses ~50 MB on common screenshots).
   - Function timeout: **30 s**.
4. Under **Environment Variables**, set:
   - `CORS_ORIGIN` → your frontend's production URL,
     comma-separated for multiples. Any `*.vercel.app` host is allowed
     automatically.
   - Optional: `MAX_IMAGE_BYTES`, `BODY_SIZE` (see caveat below).
5. Deploy. The assigned URL will be
   `https://<project>.vercel.app`. Smoke test:
   `curl https://<your-domain>/api/healthcheck`.

**⚠️ Important Vercel-specific caveats:**

- **Body size cap:** Vercel Hobby and Pro both cap request bodies at
  **4.5 MB**. Two large screenshots will be rejected by the platform
  *before* reaching your function. The frontend's Browser engine
  side-steps this entirely (the diff runs in the user's browser), so
  the recommended pattern is "use Browser by default, Server only
  for cases that fit". Enterprise plans raise the cap to 100 MB+.
- **Function size cap:** Vercel limits compressed function size to
  **50 MB**. `sharp` + libvips is ~30 MB, so we're well under, but if
  you add more native dependencies, monitor this.
- **Cold starts:** the first request after idle takes ~300–500 ms to
  boot NestJS. We cache the Express instance globally so warm
  requests are fast.
- **No Swagger on Vercel:** Swagger setup is intentionally skipped on
  the serverless path to keep cold starts quick. The
  `https://<your-domain>/api-docs` endpoint isn't available there.
  Run the local server (`npm run dev`) for Swagger access.

### Deploying anywhere else

`npm run build && npm run prod` is the entire production lifecycle.
Anything that runs Node ≥ 20 and lets you set env vars will work:
Render, fly.io, AWS ECS, plain `pm2`, a Docker container, etc. The app
binds to `0.0.0.0:$PORT` so it works inside any reverse-proxied
container.

**No platform-specific files exist in `src/`.** Both `railway.json` and
`vercel.json` are pure declarative deploy config — delete either (or
both) freely if you're going somewhere else.

---

## 2. Visual diff algorithm

The full pipeline lives in
`src/web/features/image-diff/image-diff.algorithm.ts`. Image decode +
padding lives in the sibling `image-diff.service.ts`. The algorithm
intentionally mirrors the browser counterpart in the frontend repo so
both engines produce identical boxes for the same sensitivity value.

**Step by step:**

1. **Decode** both images to raw RGBA via `sharp` (`.raw().toBuffer()`,
   native libvips). libvips streams big images through fixed-size
   tiles, so even >50 MP screenshots decode without blowing the Node
   heap.
2. **Pad** the smaller image to the union of both dimensions with a
   transparent background using `sharp.extend({ background: { r:0,
   g:0, b:0, alpha:0 } })`. The "extra" area on the larger image is
   intentionally flagged as a difference — the response flag
   `dimensionMismatch` lets the client surface a banner explaining
   what happened.
3. **pixelmatch** the two buffers with a YIQ-based perceptual color
   metric and anti-aliasing detection. Threshold comes from the
   sensitivity value (see §3).
4. **Compress** the styled diff output into a 1-byte-per-pixel binary
   mask by checking for pixelmatch's red marker color. This makes the
   next stages cache-friendly.
5. **Dilate** the mask with a two-pass 1-D sliding-window box filter.
   Radius scales with image size (`max(1, minDim / 300)`). This is
   what stitches the dots of an "i" or the pixels of a thin font
   stroke into a single region instead of dozens of micro-boxes.
6. **Connected-component labeling** with 8-connectivity, two-pass
   union-find with path compression (`Uint32Array` labels +
   `Int32Array` parent table for cache locality). Bounding box and
   pixel count per component are accumulated inline so we don't need
   a second sweep.
7. **Min-area filter** drops noise components below
   `max(4, 80 · (1 − s))` pixels.
8. **Greedy bounding-box merge** with an overlap-with-gap test. The
   gap scales with image size like the dilation radius. This cleans
   up close-but-not-quite-touching boxes — common when a UI element
   moves slightly and both the "missing from A" and "added to B"
   regions survive as separate components.

The response is a list of `{ x, y, width, height, pixels }` boxes in
the coordinate space of the *padded canvas* (union dimensions).

### Why this design

- **libvips for decode.** sharp's native pipeline is dramatically
  faster and more memory-efficient than any pure-JS PNG/JPEG
  decoder, and it forces RGBA output so pixelmatch can work directly
  on the byte buffer.
- **Typed arrays everywhere in the algorithm.** No JSON, no boxing.
  Dilation is two 1-D passes with a running-count window
  (`O(W·H·r)` with great cache behaviour).
- **No persistence.** Images live in memory for the request and are
  GC'd after the response. There's no upload disk path, no temp
  files, no leakage.
- **Same algorithm in the frontend.** The browser repo has byte-for-
  byte the same TypeScript pipeline running in a Web Worker. The
  client can flip engines at runtime and the boxes don't shift.

---

## 3. Sensitivity control

The `sensitivity` form field is a single `0..100` value that maps to
**three** internal algorithm knobs at once, so callers only have to
think about a single concept. All three are computed in
`resolveTuning()` in `image-diff.algorithm.ts`.

Let `s = sensitivity / 100`.

| Knob                  | Formula                                  | What it does                                                              |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| pixelmatch threshold  | `0.5 · exp(-3 · s) + 0.005`              | Lower threshold → flag smaller per-pixel color differences.               |
| Min component area    | `max(4, round(80 · (1 − s)))` pixels     | Higher sensitivity allows tinier components through the filter.           |
| Dilation / merge gap  | scales with `min(W, H)` only             | Stays constant across the slider; tied to image size, not sensitivity.    |

Sample values for the extremes:

| Sensitivity | pixelmatch threshold | Min component area |
| ----------- | -------------------: | -----------------: |
|  0          | 0.505                | 80 px              |
|  60         | 0.088                | 32 px              |
| 100         | 0.030                | 4 px               |

The exponential decay on the pixelmatch threshold gives fine-grained
control at the high-sensitivity end, where it actually matters (the
difference between `0.5` and `0.4` is huge; the difference between
`0.03` and `0.02` is where you catch subtle text recoloring).

A separate `ignoreAntialiasing` field toggles pixelmatch's `includeAA`
option. It defaults to `true` because AA detection dramatically
reduces false positives in font rendering and vector graphics.

---

## 4. How processing time is measured

The `durationMs` value in the JSON response is **algorithm-only**
wall-clock time, deliberately excluding I/O.

- Measured inside the service using `performance.now()` around the
  `computeDiff(...)` call. See `image-diff.service.ts`.
- **Excluded** from the number: HTTP upload, multipart parsing, `sharp`
  decode + padding (which run *before* the timed region), and JSON
  response serialization (which runs *after*).
- Why exclude I/O: the algorithm is the deterministic, optimizable
  part. Upload time depends on the wire and is wildly variable; we
  want a number callers can compare apples-to-apples to the browser
  engine's reported time.
- Reported with full microsecond-grade precision (`performance.now()`).
  The frontend rounds to one decimal for display.

If you need to time the **total request latency** (network + parse +
decode + algorithm + serialize), use the standard NestJS request
logger output or a load-testing tool like `autocannon`. The algorithm
itself will almost always be a small fraction of total request time
for screenshot-sized inputs.

---

## 5. Known limitations

- **No global alignment.** The algorithm assumes both images describe
  the same scene at the same position. A 1–2 pixel layout shift will
  light up most of the screen as a difference. A future iteration
  could add a coarse alignment step (phase-correlation or feature
  matching) to detect a global shift and re-baseline before pixel
  comparison.
- **Anti-aliasing detection isn't perfect.** Fonts that render with
  slightly different sub-pixel positioning between OS versions or
  browsers can still produce thin halos around text. Set
  `ignoreAntialiasing=false` on the request to see the raw output.
- **Different file formats can disagree.** Comparing a PNG against a
  JPEG of the same source will surface JPEG compression artifacts as
  differences. The algorithm has no way to know they came from the
  same master.
- **Dimension mismatch is treated as a change.** The smaller image is
  padded with transparency, and the extra strip on the larger image
  becomes a big bounding box. The response carries
  `dimensionMismatch: true` so a client can surface a banner.
  Cropping to the overlap region would hide real changes near the
  edges of the larger image, which seemed worse.
- **Per-file cap.** Defaults to 30 MB via `MAX_IMAGE_BYTES` (env).
  Bump it for genuinely huge inputs. Body parser limit is set
  separately via `BODY_SIZE` and should be at least ~2× the per-file
  cap because the request carries both files.
- **Single-threaded today.** The algorithm runs inside a Node event
  loop tick. For very large images (>20 MP), this can take tens of
  ms during which the process can't serve other requests. Scale
  horizontally if that's a problem; the algorithm itself has no
  shared state.
- **No persistence.** Images live in memory only — no upload history,
  no caching of results across requests.
- **No semantic understanding.** A spinner that rotated frames
  between the two captures will diff as a chaotic blob. Same for
  animations, cursors, video frames, etc.
- **AA detection is per-channel.** Very saturated edge cases (pure red
  vs. pure green at a 1-px edge) occasionally slip past the AA
  detector and survive as tiny boxes. Lowering sensitivity to ~30
  typically suppresses them.

---

## 6. AI tools used during development

This project was built collaboratively with **Claude Opus 4.7** through
the **Cursor IDE agent**. The model was used for:

- Architectural decisions (whether to share the algorithm with the
  frontend or duplicate it, picking `pixelmatch` over `resemble.js`
  / custom SSIM, choosing `sharp` + libvips for decode, dropping the
  template's BullMQ/Redis/Prisma/auth boilerplate since the service
  doesn't need any of it).
- Trimming the cloned NestJS boilerplate down to the essentials
  (kept: ConfigModule, ServeStaticModule, exception filter, request
  logger, Swagger; dropped: ~25 dependencies including database,
  queue, cache, websocket, auth modules).
- Drafting every TypeScript file under
  `src/web/features/image-diff/`, the simplified `core.module.ts`,
  the updated `web.ts` bootstrap, and this README.
- Resolving build issues (switching the NestJS CLI builder from
  `swc` to `tsc` after dropping the `@swc/*` dev deps).
- Implementing the two-pass dilation, the union-find connected-
  component labelling, and the bounding-box merge from scratch in
  TypeScript.

Verification was done by running both the production build
(`npm run build`) and the end-to-end smoke test
(`node test/smoke-diff.mjs`) that posts two synthetic PNGs and
asserts the response contains a single merged bounding box around
the change. No model output was committed without being run.

**No AI services or model APIs are called at runtime** — the diff
itself is pure pixel arithmetic in `pixelmatch` plus the classical
computer-vision steps described in §2.

---

## Project layout

```text
src/
├── web.ts                              # Standalone entry (Railway, Render, Docker, local dev)
├── bootstrap.ts                        # Shared NestJS configuration (CORS, pipes, body limits)
├── swagger.ts                          # Swagger UI setup (long-running server only)
├── core/
│   ├── core.module.ts                  # Slim global module (config + logger)
│   └── healthcheck/                    # GET /api/healthcheck
├── shared/
│   ├── config/                         # Env loader
│   ├── enums/                          # ENV, APP_ENV, LOGGER_CONTEXT
│   ├── filters/                        # Global exception filter
│   ├── helpers/                        # transformToInt et al.
│   ├── interfaces/                     # Query interface
│   └── middlewares/                    # Request logger
└── web/
    ├── web.module.ts                   # Root module
    └── features/
        ├── features.module.ts
        └── image-diff/
            ├── image-diff.controller.ts  # POST /api/diff
            ├── image-diff.service.ts     # sharp decode + padding
            ├── image-diff.algorithm.ts   # Pure diff pipeline
            └── image-diff.module.ts
api/
└── index.ts                            # Vercel serverless adapter
                                        # (uses ../src/bootstrap.ts)
test/
├── app.e2e-spec.ts                     # Boot + healthcheck e2e
├── smoke-diff.mjs                      # End-to-end script (sharp + fetch)
├── jest.json                           # Unit config
└── jest-e2e.json                       # e2e config
public/
└── index.html                          # Friendly landing page at /
railway.json                            # Railway deploy config (optional)
vercel.json                             # Vercel deploy config (optional)
.vercelignore                           # Files Vercel should skip when deploying
```

## Scripts

| Script              | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | `nest start --watch` on `http://localhost:8000`         |
| `npm run start`     | One-shot start (no watch)                               |
| `npm run build`     | `nest build` → `build/`                                 |
| `npm run prod`      | `node build/web` (production entrypoint)                |
| `npm run lint`      | ESLint                                                  |
| `npm run test`      | Jest unit tests                                         |
| `npm run test:e2e`  | Jest e2e (`test/app.e2e-spec.ts`)                       |
