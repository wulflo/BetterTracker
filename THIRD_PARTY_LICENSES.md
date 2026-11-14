# Third-party licenses and notices

> **Inventory snapshot:** 2026-11-14, app version 0.9.18.
> **Project license:** MIT (see [LICENSE](LICENSE)).

Better Fitness Tracker is MIT-licensed and does not copy GPL or AGPL code. Its dependencies use MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, and other permissive terms. A small number of transitive Rust crates use **MPL-2.0** (file-level copyleft), two use **CDLA-Permissive-2.0**, and the bundled barcode catalog derives from **Open Food Facts** under **ODbL-1.0 / DbCL-1.0**. Those cases are documented below.

This file is a summary, not a substitute for the full license texts. Before any public distribution, keep the complete license text of every dependency.

## How to regenerate the inventory

```bash
# npm: direct and installed packages with their declared license
python3 - <<'PY'
import json, os
lock = json.load(open("package-lock.json"))
for path, meta in lock.get("packages", {}).items():
    if not path.startswith("node_modules/"):
        continue
    name = path.removeprefix("node_modules/")
    license = meta.get("license")
    manifest = os.path.join(path, "package.json")
    if not license and os.path.exists(manifest):
        license = json.load(open(manifest)).get("license")
    print(f"{name}\t{meta.get('version')}\t{license or 'UNKNOWN'}")
PY

# Rust: resolved graph with declared licenses
cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml \
  | jq -r '.packages[] | [.name, .version, (.license // "UNKNOWN")] | @tsv' \
  | sort -u
```

For a formal distribution, run `cargo-about` (Rust) and an npm license tool, and archive the generated license bundles with the release.

## Summary

| Ecosystem | Resolved packages | License result |
| --- | ---: | --- |
| npm (runtime and development) | 53 installed, 111 lockfile entries | All permissive: MIT, Apache-2.0, ISC, BSD-3-Clause. No copyleft installed. |
| Cargo (desktop and Android) | 526 | Permissive, plus 5 MPL-2.0 and 2 CDLA-Permissive-2.0 transitive crates. No GPL or AGPL. |
| Bundled data | 11,232 barcode entries | Derived from Open Food Facts, ODbL-1.0 / DbCL-1.0. |

The lockfile count is higher than the installed count because it includes platform-specific optional binaries (for example the `esbuild` builds for other operating systems) that are not installed on a given machine.

## npm dependencies

### Runtime dependencies

| Package | Version | License |
| --- | --- | --- |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-process` | 2.4.0 | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-updater` | 2.14.0 | MIT OR Apache-2.0 |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |

### Development dependencies

| Package | Version | License |
| --- | --- | --- |
| `@playwright/test` | 1.64.1 | Apache-2.0 |
| `@tauri-apps/cli` | 2.12.4 | Apache-2.0 OR MIT |
| `@types/react` | 18.3.31 | MIT |
| `@types/react-dom` | 18.3.7 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vite` | 6.4.5 | MIT |
| `vitest` | 5.0.5 | MIT |

Installed npm license breakdown: 40 MIT, 5 Apache-2.0, 4 Apache-2.0 OR MIT, 2 MIT OR Apache-2.0, 1 ISC, 1 BSD-3-Clause.

## Rust dependencies

### Direct dependencies

| Crate | Version | License |
| --- | --- | --- |
| `tauri` | 2.12.5 | Apache-2.0 OR MIT |
| `tauri-build` (build) | 2.7.4 | Apache-2.0 OR MIT |
| `tauri-plugin-dialog` | 2.8.3 | Apache-2.0 OR MIT |
| `tauri-plugin-opener` | 2.7.2 | Apache-2.0 OR MIT |
| `tauri-plugin-single-instance` | 2.5.5 | Apache-2.0 OR MIT |
| `tauri-plugin-updater` | 2.14.1 | Apache-2.0 OR MIT |
| `tauri-plugin-process` | 2.4.0 | Apache-2.0 OR MIT |
| `tauri-plugin-android-fs` | 30.2.0 | MIT OR Apache-2.0 |
| `serde` | 1.0.229 | MIT OR Apache-2.0 |
| `serde_json` | 1.0.154 | MIT OR Apache-2.0 |
| `uuid` | 1.29.0 | Apache-2.0 OR MIT |
| `chrono` | 0.4.45 | MIT OR Apache-2.0 |
| `base64` | 0.22.1 | MIT OR Apache-2.0 |
| `minisign-verify` | 0.3.0 | MIT |
| `reqwest` | 0.12.28 | MIT OR Apache-2.0 |
| `sha2` | 0.10.9 | MIT OR Apache-2.0 |

### Transitive license families

| License expression | Crates |
| --- | ---: |
| MIT OR Apache-2.0 | 248 |
| MIT | 118 |
| Apache-2.0 OR MIT | 52 |
| Zlib OR Apache-2.0 OR MIT | 18 |
| Unicode-3.0 | 18 |
| MIT/Apache-2.0 | 14 |
| Unlicense OR MIT | 9 |
| MPL-2.0 | 5 |
| Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 5 |
| BSD-3-Clause | 3 |
| Apache-2.0/MIT | 3 |
| Apache-2.0 OR ISC OR MIT | 3 |
| ISC | 3 |
| MIT OR Apache-2.0 OR Zlib | 3 |
| Zlib | 2 |
| MIT OR Zlib OR Apache-2.0 | 2 |
| BSD-3-Clause OR MIT OR Apache-2.0 | 2 |
| MIT OR Apache-2.0 OR LGPL-2.1-or-later | 2 |
| Unlicense/MIT | 2 |
| Apache-2.0 | 2 |
| CDLA-Permissive-2.0 | 2 |
| Other permissive expressions | 10 |

The 10 remaining crates use combinations such as `0BSD`, `BSD-3-Clause AND MIT`, `Apache-2.0 AND MIT`, `CC0-1.0 OR MIT-0 OR Apache-2.0`, `Apache-2.0 OR BSL-1.0`, and `(MIT OR Apache-2.0) AND Unicode-3.0`. All are permissive.

`cargo deny` in CI allows MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-3-Clause, ISC, MPL-2.0, CDLA-Permissive-2.0, Unicode-DFS-2016, Unicode-3.0, and Zlib. The configuration is in [`src-tauri/deny.toml`](src-tauri/deny.toml).

## Copyleft and data exceptions

### MPL-2.0 (file-level copyleft)

These crates are transitive dependencies of Tauri's CSS parsing stack (`tauri-utils` → `dom_query` → `cssparser` / `selectors`):

| Crate | Version |
| --- | --- |
| `cssparser` | 0.37.0 |
| `cssparser-macros` | 0.7.1 |
| `dtoa-short` | 0.3.5 |
| `option-ext` | 0.2.0 |
| `selectors` | 0.38.0 |

`option-ext` is reached through `dirs` → `tauri`. MPL-2.0 is file-level copyleft: it permits distribution inside a larger MIT-licensed work as long as the MPL-covered source files remain available under MPL-2.0 and their notices are preserved. The crates are used unmodified, and their source is publicly available from crates.io. No MPL code is copied into the project's own source files.

### CDLA-Permissive-2.0 (data)

| Crate | Version |
| --- | --- |
| `webpki-root-certs` | 1.0.11 |
| `webpki-roots` | 1.0.11 |

These crates package the Mozilla root certificate store used by `reqwest`. The CDLA-Permissive-2.0 is a permissive data license and does not impose copyleft on the application.

### LGPL option not used

`r-efi` 5.3.0 and 6.0.0 are dual/tri-licensed as `MIT OR Apache-2.0 OR LGPL-2.1-or-later`. The project relies on the MIT/Apache-2.0 option, so no LGPL obligation applies to these crates.

### CC0 option

`dunce` 1.0.5 is `CC0-1.0 OR MIT-0 OR Apache-2.0`; any of those options is permissive.

## Platform system components

The app links against platform user-interface libraries that are provided by the operating system or the runtime environment:

- **Linux:** GTK 3 and WebKitGTK 4.1 are LGPL-licensed and are used as dynamically linked system libraries. AppImage builds bundle the shared libraries they need; their LGPL notices and source availability obligations still apply.
- **Windows:** WebView2 is a Microsoft system component distributed under its own terms and is not redistributed by this project.
- **Android:** the Android WebView and AndroidX libraries are system or platform components under their own terms.

These components are not relicensed by this project. Distributions that bundle them must keep their license notices and provide source or a written offer where required.

## Bundled data: Open Food Facts

`src/data/barcodeCatalog.json` contains 11,232 entries (barcode, name, category, country) derived from an Open Food Facts mini export. It is generated by [`scripts/generate-barcode-catalog.mjs`](scripts/generate-barcode-catalog.mjs) and used for offline barcode lookups.

Open Food Facts data is made available under the **Open Database License (ODbL-1.0)**, and the individual contents of the database under the **Database Contents License (DbCL-1.0)**.

- Source: <https://world.openfoodfacts.org>
- ODbL-1.0: <https://opendatacommons.org/licenses/odbl/1-0/>
- DbCL-1.0: <https://opendatacommons.org/licenses/dbcl/1-0/>

Attribution: the catalog is derived from Open Food Facts, a collaborative database maintained by its contributors. The app does not claim ownership of the underlying data. If you redistribute the catalog or a derivative database, keep this attribution and the ODbL/DbCL terms.

The rest of the bundled food database (`src/data/foodNames.en.ts` and the food definitions in the app) is project-authored reference data; it is not a copy of Open Food Facts.

## Full license texts

- **npm:** each package ships its license in `node_modules/<package>/LICENSE*`.
- **Rust:** each crate ships its license in the Cargo registry source (`~/.cargo/registry/src/...`), and `cargo-about` can generate a combined bundle.
- **Project:** [LICENSE](LICENSE) contains the MIT text.

## Keeping this file current

Update this document whenever you:

- add, remove, or upgrade a direct dependency;
- introduce a dependency under a new license family;
- regenerate or replace the barcode catalog;
- change how a platform component is bundled.

`cargo deny check` and `npm audit` run in CI and will catch new license or advisory problems, but they do not replace the attribution notes above.
