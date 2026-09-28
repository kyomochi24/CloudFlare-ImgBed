# Building the Studio font converter

The deployed Studio uses the self-contained `frontend-dist/studio/vendor/font-engine.js`.
The editable source is `scripts/font-engine.source.mjs`. To rebuild it in a temporary directory:

```sh
mkdir -p /tmp/studio-font-build
npm install --prefix /tmp/studio-font-build --no-audit --no-fund woff-lib@0.0.3 opentype.js@2.0.0 fonteditor-core@2.4.1 esbuild@0.25.9
cp scripts/font-engine.source.mjs /tmp/studio-font-build/font-engine.source.mjs
/tmp/studio-font-build/node_modules/.bin/esbuild /tmp/studio-font-build/font-engine.source.mjs --bundle --platform=browser --format=esm --target=es2022 --minify --outfile=frontend-dist/studio/vendor/font-engine.js
```

The font conversion packages run in the browser. No runtime CDN is needed. If updating a dependency, refresh `frontend-dist/studio/vendor/font-licenses/` and `frontend-dist/studio/THIRD_PARTY_NOTICES.md` as well.
