# Astro images

Original local SVG artwork, one file per astro type: `<type>.svg` (arid,
asteroid, craters, earthly, gaia, glacial, magma, metallic, oceanic,
radioactive, rocky, toxic, tundra, volcanic, crystalline).

The app loads `/public/img/astros/<type>.svg` directly — no external
requests, no CDN fallback. Re-generate or restyle any file in place; the
name-to-type mapping lives in `manifest.json`.
