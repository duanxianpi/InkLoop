# Licensing and redistribution

Reviewed on 2026-11-04 against the locked production dependency tree and the pinned tldraw source. InkLoop's original code and documentation use the [MIT License](../LICENSE). That grant does not relicense dependencies, fonts or third-party trademarks. The complete [third-party inventory and license texts](../THIRD_PARTY_NOTICES.txt) travel with the application.

## tldraw 3.15.6

The project pins both `tldraw` and `@tldraw/assets` to **3.15.6**. The [license at that exact release](https://github.com/tldraw/tldraw/blob/v3.15.6/LICENSE.md) permits commercial and non-commercial projects, modification and bundling as part of another application, subject to its conditions. It is a source-available license with restrictions, not MIT or another unrestricted open-source license. Some tldraw support packages have their own MIT texts; the notices retain each package's supplied terms.

For the SDK and assets governed by the tldraw license:

- Keep the native watermark visible and unchanged. Do not hide it through CSS, overlays or custom component overrides. Leave the license-key validation process intact. A custom InkLoop toolbar does not replace the watermark.
- Preserve copyright notices and distribute a verbatim copy of the pinned license, including its disclaimer and liability terms. A link to the changing upstream main branch alone is insufficient.
- Distribute the SDK as part of InkLoop, rather than repackaging it as a standalone SDK. Do not apply InkLoop's MIT grant over the SDK or negate its terms.
- Follow the [trademark guidelines shipped with that release](../third-party/upstream/tldraw-3.15.6-TRADEMARKS.md). InkLoop uses its own name and logo; factual dependency attribution does not imply endorsement. InkLoop is not affiliated with or endorsed by tldraw Inc. Required SDK branding remains intact.

The complete [pinned license text](../third-party/upstream/tldraw-3.15.6-LICENSE.md) is checked into this repository and replaces the link-only license in the copied drawing assets. The current code supplies no alternative license key and retains the SDK's default watermark and validation. Keep the canvas and surrounding controls from covering that watermark, including at narrow widths and while tool panels are open.

This conclusion is specific to **3.15.6**. The [current upstream license documentation](https://tldraw.dev/community/license) describes different terms requiring a production license key. Do not upgrade the SDK or substitute the main-branch license without reviewing the new release's terms and obtaining any required license. Removing the watermark requires authorization under a suitable separate tldraw license; InkLoop's MIT license gives no such right.

## Other bundled components

The generated inventory includes installed production dependencies and their transitive dependencies, conservatively including packages later removed by bundling. It preserves their available LICENSE, NOTICE, COPYING and copyright files and identifies their versions and repositories. Development tooling is excluded from the application inventory because the tools themselves are not distributed as part of InkLoop; a distribution that bundles those tools must include their notices too.

| Components                                                           | Terms / handling                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Hono, React, zod, Cloudflare OAuth provider and many UI dependencies | MIT; copyright and permission notices retained                                                         |
| MathJax and related packages                                         | Apache-2.0; license and supplied notices retained                                                      |
| Inter, STIX Two Text, tldraw's IBM Plex and Shantell Sans fonts      | SIL Open Font License 1.1; copyright, license and reserved-name terms retained; fonts remain under OFL |
| Other transitive libraries                                           | Their original MIT, ISC, BSD, Python, CC0 or 0BSD terms, as recorded in the inventory                  |

Font licenses do not change the license of documents or handwriting produced using them. Avoid renaming or modifying fonts without reviewing reserved font names and other OFL conditions.

Some published packages omit license files. Checked-in supplements in `third-party/upstream/` fill those gaps; [sources.json](../third-party/upstream/sources.json) records their official URLs and SHA-256 hashes. Tiptap uses the source commit identified by its npm release metadata. The scroll-bar package's upstream license is preserved from a fixed official repository commit because its published `gitHead` was unavailable. `mj-context-menu` declares Apache-2.0 but ships no license text; its inventory entry includes the standard Apache text from its parent MathJax dependency, without inventing a copyright holder.

## Build and release

```sh
npm ci
npm run licenses
npm run licenses:check
npm run build
```

`npm run licenses` regenerates the tracked inventory offline from the lockfile, installed packages and checked-in supplements. Review and commit changes after dependency updates. The build rejects stale notices, changed supplement hashes, unsupported license declarations and an unreviewed tldraw version. Missing license texts fail generation rather than silently disappearing.

The board's Settings panel links to **Licenses and notices**. Vite emits the combined InkLoop license and third-party texts under a content-hashed `/assets/` URL, so they remain available through the deployment's public static-assets handler without an owner session. The complete tldraw license is also distributed at `/assets/tldraw/3.15.6/LICENSE.md`. Redistribute these files with the browser assets and retain license comments in bundles. Preserve the repository license and notices when sharing source or forks.

This covers the current source and build artifacts. Previously deployed assets receive these notices only after deploying the updated build; this change does not itself publish a deployment. Dependency, engine, font and branding changes require another review.
