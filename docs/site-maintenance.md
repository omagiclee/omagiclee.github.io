# Site maintenance

## Source boundaries

- Project-level `layouts/` and `assets/` are the authoritative templates and frontend sources. Do not edit `themes/LoveIt/` or run the theme compile task to change site JavaScript; theme updates can overwrite those files.
- Homepage column definitions live in `data/home.toml`. Shared homepage rendering belongs in project partials rather than repeated template markup.
- Site Sass is split under `assets/css/site/` and assembled by the project asset pipeline.

## Content conventions

- Use `_index.md` for a branch that contains child pages. Use `index.md` for a leaf page bundle; nested pages below a leaf bundle are treated as resources and will not be published as pages.
- When moving a published page, add its former URL to the page's `aliases` front matter and add the old-to-new mapping to `scripts/legacy-urls.json`. The static checker validates these redirects.
- Keep private interview notes at `draft = true`. Backup files are excluded through Hugo `ignoreFiles`; do not rely on Git ignore rules to stop files under `content/` from being published.
- Math assets are detected from source content. Set `math = true` or `math = false` in front matter only when an explicit override is needed.
- The interface language remains English. Set `contentLanguage` in page metadata when a page needs a different content-language declaration.

## Production checks

Build with a clean destination so removed drafts and resources cannot survive from an earlier build:

```sh
npm ci
npm run install:browser
hugo --environment production --gc --minify --cleanDestinationDir
python3 scripts/check-site.py public
npm run test:site -- public
```

The browser smoke tests start their own temporary localhost servers and use Playwright-managed Chrome for Testing in its new headless mode (`channel: 'chromium'`). Playwright is pinned to 1.63.0, matching the local data-flywheel project, so both projects can share the same browser download. Local and CI installation use `--no-shell` to avoid downloading a separate Headless Shell. Tests use isolated browser contexts, without a personal browser profile. A custom isolated browser executable can still be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; screenshots can be written for visual debugging by setting `SITE_SMOKE_SCREENSHOT_DIR`.

## Private local photo viewer

Run `npm run photos:setup` once, then `npm run photos` to build a separate local blog with the photo entry and start the loopback-only service. Source and usage details are in `local/photos/README.md`. Runtime indexes, previews and builds belong only in the ignored `.local-photos/` directory. Do not move them into Hugo content, assets or static sources. The photo page itself is served by the local service; production Hugo builds omit its entry. CI checks the artifact with `scripts/check-local-photos-publication.py`. Run `npm run photos:test` for independent fixture and headless browser checks.

## Mermaid diagrams

Mermaid is pinned in `package.json` and `package-lock.json` (currently 12.0.0). Run `npm ci` before building or previewing with Hugo. Hugo bundles `assets/js/mermaid.js` locally; the theme's legacy Mermaid CDN and vendored library are not used. The renderer uses the Promise-based API and redraws diagrams when the theme changes. Diagram styles live in `assets/css/site/_mermaid.scss`; wide diagrams scroll within their frame on mobile.

The `lodash-es` override uses 4.18.1 because Mermaid's parser dependencies pin an older release affected by GHSA-r5fr-rjxr-66jc and GHSA-f23m-r3pf-42rh. Recheck `npm audit` when updating Mermaid, and remove the override once upstream dependencies resolve to a fixed version.
