# KMZ Control Point Tool — browser-only TypeScript

Runs fully in the browser and can be deployed directly to GitHub Pages. No backend is required.

## Features

- PDF, PNG and JPG/JPEG input.
- Existing KMZ import/editing.
- Step 1: four-point rough alignment.
- Step 2: at least five precise control points using a thin-plate-spline warp.
- Linked image/map pan and zoom after rough alignment.
- Draggable and deletable control points.
- Step 3: preview the warped overlay on the map with a live opacity slider.
- Browser-side KMZ generation.
- Imported `LatLonBox`, rotated `LatLonBox`, and `gx:LatLonQuad` overlays seed step 1 from the image corners.

## Stack

The production dependencies are installed through npm rather than loaded from CDNs:

- Leaflet — map and image interaction.
- JSZip — KMZ import/export.
- PDF.js (`pdfjs-dist`) — first-page PDF rasterization.

Vite handles the TypeScript build, dependency bundling, PDF.js worker asset, CSS processing, and production minification.

## Development

Requires Node.js 22.

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

`npm run build` performs:

1. `tsc --noEmit` type checking.
2. `vite build --minify esbuild`.

The static GitHub Pages site is written to `dist/`. JavaScript and CSS are bundled and minified and source maps are disabled.

To inspect the production result locally:

```bash
npm run preview
```

## GitHub Pages

The included `.github/workflows/pages.yml`:

1. installs npm dependencies;
2. runs the minified production build;
3. uploads only `dist/`;
4. deploys it with GitHub Pages.

In the repository settings, set **Pages → Source** to **GitHub Actions**.

## Privacy / runtime behavior

Source images, PDFs, imported KMZ contents, control points and generated KMZ files remain in the browser. The app still needs network access for OpenTopoMap/OpenStreetMap map tiles.
