# fold.pdf

fold.pdf is a lightweight browser-based PDF workspace for merging, organizing, splitting, and visually signing PDFs. It uses static HTML/CSS/JavaScript, PDF.js for previews, and pdf-lib for PDF output.

Live site: <https://pdf-merger-sepia.vercel.app/>

## Features

- Merge PDF, JPG, PNG, and WebP files.
- Reorder, rotate, and remove individual output pages.
- Split by ordered or reverse page ranges, or create one PDF per page.
- Draw or type a visual signature image and place it on multiple pages.
- Keyboard/touch page movement and keyboard signature nudging.

## Privacy model

Files selected from the device are processed in the browser. Optional URL and Google Drive imports are different: the URL and document pass through the Vercel serverless proxy before returning to the browser. See `privacy.html` for the full disclosure.

Sign mode is visual only. It does not verify identity, encrypt the PDF, add a certificate, or provide tamper evidence.

## Local static preview

Serve this directory from any static web server and open `/`. The Docker configuration serves the complete static directory through Nginx, but the Vercel serverless `/api/proxy` remote-import endpoint is not available in the Nginx-only container.

## Smoke checks

With Node.js installed:

```sh
node tests/smoke.mjs
```

The checks cover range parsing, reverse ranges, internal links, canonical hosts, index/noindex behavior, sitemap/robots rules, and key security invariants.

## Known limitations

- Split-to-many-files uses multiple browser downloads; a ZIP export is planned.
- Visual signing does not currently transform placement coordinates for every rotated/CropBox edge case.
- PDF.js remains CDN-hosted; self-hosting an upgraded audited build with subresource integrity is planned. `isEvalSupported: false` is set as an immediate mitigation for untrusted PDFs.
- The remote proxy validates resolved addresses and redirects but does not pin DNS results to the subsequent connection; rate limiting should also be added at the deployment edge.
