# Frontend dependency audit

Audit snapshot from npm 10 against the public registry. npm counts flagged package names, including parent packages flagged through a vulnerable dependency. Multiple advisories can affect the same package. See the inventory below for every package reported in the baseline or final audit.

## Validated remediation

| Stage | Critical | High | Moderate | Low | Total | Jest | Production build |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Baseline | 4 | 33 | 13 | 19 | 69 | 9 passed | Passed |
| Axios 1.x update | 4 | 32 | 12 | 19 | 67 | 9 passed | Passed |
| Compatible lockfile refresh | 0 | 13 | 8 | 16 | 37 | 9 passed | Passed |
| Scoped Underscore patch | 0 | 10 | 8 | 16 | 34 | 9 passed | Passed |

Each stage used a clean `npm ci`, non-interactive Jest, a CI-mode production build and an npm audit. The full report can be reproduced with `npm audit --json` from `frontend`. The final high-severity gate still exits 1.

- Updated Axios within major 1. The app calls its browser adapter for metadata, partner and bio requests to a build-configured API origin. The package was the flagged direct browser dependency. Axios advisories limited to Node adapters do not apply to this static browser bundle. The update also removed the flagged Node redirect dependency entry. [Axios releases](https://github.com/axios/axios/releases) · [Axios advisories](https://github.com/axios/axios/security/advisories)
- Applied the compatible lockfile fixes without force. Direct dependency ranges were unchanged by this batch. The Webpack 5 and schema-utils 4 updates declare the new es-module-lexer 2 and ajv-formats 3 ranges themselves. These are changes within their parents' supported releases.
- Scoped the Underscore 1.13.8 patch to jsonpath, whose published dependency pins Underscore 1.13.6. The override remains within the 1.13 patch line. Remove it when CRA and its BFJ path are removed or the parent updates its pin. [Underscore advisory](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw)

## Exposure in the deployed React build

Before the upgrade, the application directly exercised Axios request construction and JSON response parsing. The baseline report includes prototype-pollution gadgets in those shared paths. The source sends string-valued JSON fields to fixed route suffixes and does not pass user-controlled Axios config, install interceptors or submit multipart or streaming uploads. Those facts narrow the trigger conditions. They do not establish that the browser-side gadgets were unexploitable. Node HTTP adapter paths such as proxy bypass and redirect credentials are outside the deployed client. [Axios advisory list](https://github.com/axios/axios/security/advisories)

The source maps of the generated JavaScript name these third-party package sources: `axios`, `react`, `react-dom`, `scheduler`, `web-vitals`. None of the packages in the final npm report appears in those maps. The audited CRA paths run in developer or CI Node processes for transformation, asset optimization, tests, or the development server. The checked-in React app supplies source-controlled CSS and assets to those tools and does not register a service worker. The webpack development server is a separate exposure and should not serve production traffic. Avoid exposing it to untrusted networks or processing untrusted build inputs until the toolchain is replaced.

Source-map comparison establishes what package sources were emitted in the tested build. It cannot rule out vulnerabilities in generated output, a different deployment configuration, or exploitation of developer/build systems. The npm manifest currently classifies react-scripts as a dependency even though it functions as a build/test/dev tool. An `--omit=dev` audit would therefore be a poor proxy for browser exposure.

## Plan for replacing CRA with Vite

The registry lists react-scripts 5.0.1 as the latest stable version. Remaining root causes include SVGO/nth-check, PostCSS 7 through resolve-url-loader, webpack-dev-server and middleware, serialize-javascript through Workbox and the CSS minimizer, and the legacy Jest/jsdom and glob branches. npm suggests react-scripts 0.0.0 for several paths. That would break the existing scripts and is not a compatible remediation. Forcing cross-major overrides under CRA would also require validating those tool APIs. [React's CRA deprecation notice](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)

Estimated scope is **2–3 engineering days**, including validation:

1. **Build and config, 0.5–1 day.** Add Vite and its React plugin as development dependencies, move the HTML entry to the frontend root, replace CRA public asset placeholders, and configure equivalent static output, browser targets, and a loopback dev server on port 3000. Keep the existing Flask URL default and document the transition from `REACT_APP_API_URL` to a Vite-exposed config value. Use a supported Node 22 release that meets the new toolchain minimum. [Vite getting started](https://vite.dev/guide/)
2. **Tests and lint, 0.5–1 day.** Port the existing nine Testing Library cases to Vitest with jsdom, including Axios mocks, accessibility, rich/legacy API compatibility, and the privacy-filtered bio response. Carry forward lint checks currently supplied by react-scripts.
3. **CI and parity, 1 day.** Remove CRA and the temporary override, regenerate the lockfile, and retain the high audit threshold. Verify clean install, test, static build and audit, then smoke-test both search flows, CORS, keyboard and responsive behavior against Flask. Compare asset paths, browser targets and generated packages before review. Keep deployment settings aligned with the chosen build output directory.

## Package inventory

The path column shows one shortest lockfile path per direct root for the final finding, or the baseline path if the finding was resolved. Nested copies can account for more than one affected version. The registry JSON provides individual advisory IDs, full `via` entries and all affected installation paths.

| Package | Before severity and affected versions | After severity and affected versions | Representative path from a direct dependency |
| --- | --- | --- | --- |
| `@babel/core` | low (7.27.1) | — | `react-scripts` → `@babel/core` |
| `@babel/plugin-transform-modules-systemjs` | high (7.27.1) | — | `react-scripts` → `@svgr/webpack` → `@babel/preset-env` → `@babel/plugin-transform-modules-systemjs` |
| `@jest/core` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` → `@jest/core` |
| `@rollup/plugin-node-resolve` | low (11.2.1) | low (11.2.1) | `react-scripts` → `workbox-webpack-plugin` → `workbox-build` → `@rollup/plugin-node-resolve` |
| `@svgr/plugin-svgo` | high (5.5.0) | high (5.5.0) | `react-scripts` → `@svgr/webpack` → `@svgr/plugin-svgo` |
| `@svgr/webpack` | low (5.5.0) | low (5.5.0) | `react-scripts` → `@svgr/webpack` |
| `@tootallnate/once` | low (1.1.2) | low (1.1.2) | `react-scripts` → `jest` → `@jest/core` → `jest-config` → `jest-environment-jsdom` → `jsdom` → `http-proxy-agent` → `@tootallnate/once` |
| `ajv` | moderate (6.12.6, 8.17.1) | — | `react-scripts` → `eslint` → `ajv` |
| `axios` (direct) | high (1.9.0) | — | `axios` |
| `body-parser` | high (1.20.3) | — | `react-scripts` → `webpack-dev-server` → `express` → `body-parser` |
| `brace-expansion` | high (1.1.11, 2.0.1) | — | `react-scripts` → `eslint` → `minimatch` → `brace-expansion` |
| `browserslist` | high (4.24.5) | — | `react-scripts` → `browserslist` |
| `colord` | moderate (2.9.3) | — | `react-scripts` → `css-minimizer-webpack-plugin` → `cssnano` → `cssnano-preset-default` → `postcss-colormin` → `colord` |
| `compression` | high (1.8.0) | — | `react-scripts` → `webpack-dev-server` → `compression` |
| `css-minimizer-webpack-plugin` | moderate (3.4.1) | moderate (3.4.1) | `react-scripts` → `css-minimizer-webpack-plugin` |
| `css-select` | high (2.1.0) | high (2.1.0) | `react-scripts` → `@svgr/webpack` → `@svgr/plugin-svgo` → `svgo` → `css-select` |
| `deepmerge` | low (4.3.1) | low (4.3.1) | `react-scripts` → `@svgr/webpack` → `@svgr/plugin-svgo` → `deepmerge` |
| `express` | high (4.21.2) | — | `react-scripts` → `webpack-dev-server` → `express` |
| `fast-uri` | high (3.0.6) | — | `react-scripts` → `@pmmmwh/react-refresh-webpack-plugin` → `schema-utils` → `ajv` → `fast-uri` |
| `flatted` | high (3.3.3) | — | `react-scripts` → `eslint` → `file-entry-cache` → `flat-cache` → `flatted` |
| `follow-redirects` | moderate (1.15.9) | — | `axios` → `follow-redirects`<br>`react-scripts` → `webpack-dev-server` → `http-proxy-middleware` → `http-proxy` → `follow-redirects` |
| `fork-ts-checker-webpack-plugin` | low (6.5.3) | low (6.5.3) | `react-scripts` → `react-dev-utils` → `fork-ts-checker-webpack-plugin` |
| `form-data` | critical (3.0.3, 4.0.2) | — | `axios` → `form-data`<br>`react-scripts` → `jest` → `@jest/core` → `jest-config` → `jest-environment-jsdom` → `jsdom` → `form-data` |
| `glob` | high (10.4.5) | moderate (10.5.0) | `react-scripts` → `tailwindcss` → `sucrase` → `glob` |
| `http-proxy-agent` | low (4.0.1) | low (4.0.1) | `react-scripts` → `jest` → `@jest/core` → `jest-config` → `jest-environment-jsdom` → `jsdom` → `http-proxy-agent` |
| `http-proxy-middleware` | moderate (2.0.9) | — | `react-scripts` → `webpack-dev-server` → `http-proxy-middleware` |
| `jest` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` |
| `jest-cli` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` → `jest-cli` |
| `jest-config` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` → `@jest/core` → `jest-config` |
| `jest-environment-jsdom` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` → `@jest/core` → `jest-config` → `jest-environment-jsdom` |
| `jest-runner` | low (27.5.1) | low (27.5.1) | `react-scripts` → `jest` → `@jest/core` → `jest-runner` |
| `jest-watch-typeahead` | low (1.1.0) | low (1.1.0) | `react-scripts` → `jest-watch-typeahead` |
| `js-yaml` | high (3.14.1, 4.1.0) | — | `react-scripts` → `eslint` → `js-yaml` |
| `jsdom` | low (16.7.0) | low (16.7.0) | `react-scripts` → `jest` → `@jest/core` → `jest-config` → `jest-environment-jsdom` → `jsdom` |
| `jsonpath` | high (1.1.1) | — | `react-scripts` → `bfj` → `jsonpath` |
| `launch-editor` | high (2.10.0) | — | `react-scripts` → `webpack-dev-server` → `launch-editor` |
| `lodash` | high (4.17.21) | — | `@testing-library/jest-dom` → `lodash`<br>`react-scripts` → `html-webpack-plugin` → `lodash` |
| `minimatch` | high (3.1.2, 5.1.6, 9.0.5) | moderate (9.0.9) | `react-scripts` → `tailwindcss` → `sucrase` → `glob` → `minimatch` |
| `nanoid` | high (3.3.11) | — | `react-scripts` → `postcss` → `nanoid` |
| `node-forge` | high (1.3.1) | — | `react-scripts` → `webpack-dev-server` → `selfsigned` → `node-forge` |
| `nth-check` | high (1.0.2) | high (1.0.2) | `react-scripts` → `@svgr/webpack` → `@svgr/plugin-svgo` → `svgo` → `css-select` → `nth-check` |
| `on-headers` | low (1.0.2) | — | `react-scripts` → `webpack-dev-server` → `compression` → `on-headers` |
| `path-to-regexp` | high (0.1.12) | — | `react-scripts` → `webpack-dev-server` → `express` → `path-to-regexp` |
| `picomatch` | high (2.3.1) | — | `react-scripts` → `eslint-webpack-plugin` → `micromatch` → `picomatch` |
| `postcss` | high (7.0.39, 8.5.3) | high (7.0.39) | `react-scripts` → `resolve-url-loader` → `postcss` |
| `postcss-selector-parser` | moderate (6.1.2, 7.1.0) | — | `react-scripts` → `tailwindcss` → `postcss-selector-parser` |
| `proxy-addr` | critical (2.0.7) | — | `react-scripts` → `webpack-dev-server` → `express` → `proxy-addr` |
| `qs` | moderate (6.13.0) | — | `react-scripts` → `webpack-dev-server` → `express` → `qs` |
| `react-dev-utils` | low (12.0.1) | low (12.0.1) | `react-scripts` → `react-dev-utils` |
| `react-scripts` (direct) | moderate (5.0.1) | moderate (5.0.1) | `react-scripts` |
| `resolve-url-loader` | moderate (4.0.0) | moderate (4.0.0) | `react-scripts` → `resolve-url-loader` |
| `rollup` | high (2.79.2) | — | `react-scripts` → `workbox-webpack-plugin` → `workbox-build` → `rollup` |
| `rollup-plugin-terser` | high (7.0.2) | high (7.0.2) | `react-scripts` → `workbox-webpack-plugin` → `workbox-build` → `rollup-plugin-terser` |
| `serialize-javascript` | high (4.0.0, 6.0.2) | high (4.0.0, 6.0.2) | `react-scripts` → `css-minimizer-webpack-plugin` → `serialize-javascript` |
| `shell-quote` | critical (1.8.2) | — | `react-scripts` → `react-dev-utils` → `shell-quote` |
| `sockjs` | moderate (0.3.24) | moderate (0.3.24) | `react-scripts` → `webpack-dev-server` → `sockjs` |
| `source-map-js` | high (1.2.1) | — | `react-scripts` → `postcss` → `source-map-js` |
| `sucrase` | — | moderate (3.35.0) | `react-scripts` → `tailwindcss` → `sucrase` |
| `svgo` | high (1.3.2, 2.8.0) | high (1.3.2) | `react-scripts` → `@svgr/webpack` → `@svgr/plugin-svgo` → `svgo` |
| `terser-webpack-plugin` | moderate (5.3.14) | — | `react-scripts` → `terser-webpack-plugin` |
| `underscore` | high (1.12.1) | — | `react-scripts` → `bfj` → `jsonpath` → `underscore` |
| `uuid` | moderate (8.3.2) | moderate (8.3.2) | `react-scripts` → `webpack-dev-server` → `sockjs` → `uuid` |
| `webpack` | low (5.99.8) | — | `react-scripts` → `webpack` |
| `webpack-dev-middleware` | high (5.3.4) | high (5.3.4) | `react-scripts` → `webpack-dev-server` → `webpack-dev-middleware` |
| `webpack-dev-server` | high (4.15.2) | high (4.15.2) | `react-scripts` → `webpack-dev-server` |
| `websocket-driver` | critical (0.7.4) | — | `react-scripts` → `webpack-dev-server` → `sockjs` → `websocket-driver` |
| `workbox-build` | high (6.6.0) | high (6.6.0) | `react-scripts` → `workbox-webpack-plugin` → `workbox-build` |
| `workbox-webpack-plugin` | low (6.6.0) | low (6.6.0) | `react-scripts` → `workbox-webpack-plugin` |
| `ws` | high (7.5.10, 8.18.2) | — | `react-scripts` → `webpack-dev-server` → `ws` |
| `yaml` | moderate (1.10.2, 2.7.1) | — | `react-scripts` → `tailwindcss` → `postcss-load-config` → `yaml` |
