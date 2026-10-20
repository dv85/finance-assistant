# Third-party notices

Finance Assistant project code is GPL-3.0-only. This license does not replace the licenses of dependencies fetched by npm or pip. No third-party package source, native binary, font, stock image, or private design screenshot is vendored in this source release.

Direct JavaScript dependency metadata identifies React, React DOM, and Phosphor Icons as MIT, and Drizzle ORM as Apache-2.0. Development tooling has its own package licenses. The pinned Python dependencies are recorded in `docs/dependency-licenses.json` with the JavaScript lockfile inventory.

Transitive npm metadata includes LGPL-3.0-or-later for libvips/Sharp native components, MPL-2.0 for some tooling, and CC-BY-4.0 for caniuse-lite data. Those packages are not relicensed as GPL project code. Preserve the applicable package notices and review obligations when redistributing bundled dependencies, native binaries, or a hosted/packaged derivative.

`docs/dependency-licenses.json` is an inventory of package metadata, not a determination of every possible downstream distribution's obligations. Packages retain the full license/notice files supplied in their installed distributions. The source archive includes a dependency lockfile and installation instructions rather than bundling those distributions.

The optional `jsonschema[format]` extra is intentionally not required; this project's date validation uses the built-in date checker. The release's Python dependency list excludes the unused optional `rfc3987` package.
