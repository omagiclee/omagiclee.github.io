# Site maintenance

## Source boundaries

- Project-level `layouts/` and `assets/` are the authoritative templates and frontend sources. Do not edit `themes/LoveIt/` or run the theme compile task to change site JavaScript; theme updates can overwrite those files.
- Homepage column definitions live in `data/home.toml`. Shared homepage rendering belongs in project partials rather than repeated template markup.
- Site Sass is split under `assets/css/site/` and assembled by the project asset pipeline.

## Development setup

Use Hugo **0.169.0** with Extended support, **Dart Sass 1.107.1**, Node.js 22.12 or later, and Python 3.11 or later. CI pins Hugo in `.github/workflows/hugo.yaml`; when upgrading Hugo, update that version and run the checks below. The LoveIt theme is already included in the repository.

On macOS, install missing tools with Homebrew and install the locked project packages:

```sh
brew install hugo python@3.13
npm ci
hugo version
```

Install the [official standalone Dart Sass 1.107.1 binary](https://github.com/sass/dart-sass/releases/tag/1.107.1) outside the checkout and put its executable on PATH. On Mini it is installed under `~/.local/share/dart-sass/1.107.1` and exposed as `~/.local/bin/sass`; `~/.local/bin` is added to the login shell PATH. Verify with `sass --version`. CI downloads the same version and checks its SHA256 before building. The standalone compiler requires no separately installed Dart SDK.

The main stylesheet combines two separately compiled Dart Sass resources: `assets/css/theme.scss` loads the unchanged LoveIt stylesheet as a third-party dependency, and `assets/css/site.scss` loads project styles with `@use`. The theme custom hook is empty so project styles are included once, after the theme. Dependency deprecation diagnostics are quieted only for the theme resource; the project resource and data-loop workbench keep all Sass diagnostics enabled.

An existing supported Node.js installation can be reused. On Mini, Python checks use `python3.13` explicitly because Apple's `/usr/bin/python3` is Python 3.9 and does not include `tomllib`. Where `python3` already resolves to Python 3.11 or later, it can be used instead.

Start the local preview:

```sh
hugo server --bind 127.0.0.1 --port 1313
```

Open `http://localhost:1313` on the machine running Hugo.

## Content conventions

- Use `_index.md` for a branch that contains child pages. Use `index.md` for a leaf page bundle; nested pages below a leaf bundle are treated as resources and will not be published as pages.
- When moving a published page, add its former URL to the page's `aliases` front matter and add the old-to-new mapping to `scripts/legacy-urls.json`. The static checker validates these redirects.
- Keep private interview notes at `draft = true`. Backup files are excluded through Hugo `ignoreFiles`; do not rely on Git ignore rules to stop files under `content/` from being published.
- Math assets are detected from source content. Set `math = true` or `math = false` in front matter only when an explicit override is needed.
- The interface language remains English. Set `contentLanguage` in page metadata when a page needs a different content-language declaration.
- Article discovery uses `Lastmod` descending: the first home section is Recently Updated, followed by recommendations and series; archives, category/tag article lists, related posts and RSS also use modification time. Archive year groups and list dates use that same time. The original publication date and RSS GUID remain unchanged; RSS adds `atom:updated`.
- Modification time follows the existing Git-first `frontmatter.lastmod` configuration. CI must retain full Git history (`fetch-depth: 0`) so updating an old article places it ahead of older updates. Hand-curated topic navigation keeps its configured weights.

## Production checks

Build with a clean destination so removed drafts and resources cannot survive from an earlier build:

```sh
npm ci
hugo --environment production --gc --minify --cleanDestinationDir
python3.13 scripts/check-site.py public
python3.13 scripts/check-local-photos-publication.py public
python3.13 scripts/check-updated-order.py
```

On macOS with Google Chrome installed, reuse its executable for the browser smoke tests:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npm run test:site -- public
```

The tests launch Chrome in headless mode with a temporary user directory and isolated browser contexts. They do not use an existing Chrome profile or session. The smoke tests start their own temporary localhost server. Screenshots can be written for visual debugging by setting `SITE_SMOKE_SCREENSHOT_DIR`.

`check-updated-order.py` builds temporary content with deliberately different publication and modification dates. It checks older articles resurfacing, within-day order, nested sections, update-year groups, taxonomy pagination, homepage exclusions, related posts and feed dates without adding fixture articles to the real site. `npm run test:site` also runs it automatically, including in the existing CI workflow.

CI uses Playwright-managed Chrome for Testing with `channel: 'chromium'`. To use that option locally, run `npm run install:browser`, then run `npm run test:site -- public` without the executable override. This download is optional when reusing installed Chrome. Playwright is pinned to 1.63.0; projects needing the same browser revision share the user-level browser cache. The install command uses `--no-shell` to avoid downloading a separate Headless Shell.

## Private local photo viewer

Run `npm run photos:setup` once, then `npm run photos` to build a separate local blog with the photo entry and start the loopback-only service. Source and usage details are in `local/photos/README.md`. Runtime indexes, previews and builds belong only in the ignored `.local-photos/` directory. Do not move them into Hugo content, assets or static sources. The photo page itself is served by the local service; production Hugo builds omit its entry. CI checks the artifact with `scripts/check-local-photos-publication.py`. Run `npm run photos:test` for independent fixture and headless browser checks.

## Mermaid diagrams

Mermaid is pinned in `package.json` and `package-lock.json` (currently 12.2.0). Run `npm ci` before building or previewing with Hugo. Hugo bundles `assets/js/mermaid.js` locally; the theme's legacy Mermaid CDN and vendored library are not used. The renderer uses the Promise-based API and redraws diagrams when the theme changes. Diagram styles live in `assets/css/site/_mermaid.scss`; wide diagrams scroll within their frame on mobile.

The `lodash-es` override uses 4.18.1 because Mermaid's parser dependencies pin an older release affected by GHSA-r5fr-rjxr-66jc and GHSA-f23m-r3pf-42rh. Recheck `npm audit` when updating Mermaid, and remove the override once upstream dependencies resolve to a fixed version.
