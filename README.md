# AHRINU.STUDENT

Standalone GitHub Pages package for the AHRINU student LMS. Browser libraries,
fonts, and icons are served from this repository with relative URLs. Firebase,
Google Apps Script, Gemini, and Google Drive remain remote application services.

The optimized handoff was built from source commit
`dd0d0eaa566fcad0a8f86951073cbb888874e18f`. Its archive SHA-256 is
`7aa828452bfcd5e8a49167770ddc59014322257f02a8d1199f347ea03ec931d6`.
The handoff contained no default users or passwords; users are loaded through
the existing public Firebase storage adapter.

## Build and verify

Node.js 20 or newer is required.

```text
npm ci
npm run build
npm run verify
```

`npm run build` compiles Tailwind CSS 3.4.17, bundles Firebase 11.6.1, writes
content-hashed production assets, updates `index.html`, and regenerates
`assets/SHA256SUMS`. Commit the generated assets, but never `node_modules`.

When icon classes change, regenerate the Font Awesome 6.0.0 subset or replace it
with the pinned self-hosted solid and regular WOFF2 assets. Do not restore CDN
references. Exact redistribution terms are retained under `assets/licenses/` and summarized
in `assets/THIRD_PARTY_NOTICES.txt` and `assets/FIREBASE_NOTICE.txt`.

Serve the repository root over HTTP for local testing. All static asset paths
are relative so the same files work under the GitHub Pages repository subpath.
