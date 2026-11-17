# Contributing to Better Fitness Tracker

Thanks for taking the time to contribute. Better Fitness Tracker is a local-first app for training, body composition, nutrition, and weekly load. It keeps every record in a vault folder the user chooses, with no accounts, cloud, or telemetry.

This guide covers the development setup, the project's non-negotiable constraints, coding conventions, and the review process.

## Contents

- [Before you start](#before-you-start)
- [Project constraints](#project-constraints)
- [Development setup](#development-setup)
- [Useful commands](#useful-commands)
- [Tests and continuous integration](#tests-and-continuous-integration)
- [Versioning and releases](#versioning-and-releases)
- [Coding guidelines](#coding-guidelines)
- [Documentation](#documentation)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)
- [Security](#security)
- [License and third-party notices](#license-and-third-party-notices)

## Before you start

1. Read [README.md](README.md), [DECISIONES.md](DECISIONES.md), and [docs/METODOLOGIA.md](docs/METODOLOGIA.md).
2. Read the security checklist in [docs/CHECKLIST_SEGURIDAD.md](docs/CHECKLIST_SEGURIDAD.md). Those rules are not negotiable.
3. Search existing issues and pull requests before opening a new one.
4. For large features, refactors, or anything that changes the vault format, the export model, the updater, or the network surface, open an issue first so the scope can be agreed on.
5. Report security vulnerabilities privately, as described in [Security](#security). Never open a public issue for an unfixed vulnerability.

Most files under `docs/` are written in Spanish. The README, this guide, and the license inventory are in English.

## Project constraints

These constraints define the project. A change that breaks one of them will not be merged.

- **Local first.** No accounts, cloud sync, telemetry, analytics, or background network activity.
- **Network only where documented.** The only outbound connections are the **manual** update check and the optional Open Food Facts barcode lookup. Do not add remote fonts, CDNs, remote icons, or analytics to the webview. Any new endpoint needs prior discussion and documentation.
- **The vault is unencrypted.** This is an explicit decision. Do not introduce implicit encryption or silently change the storage model.
- **Append-only events.** Never rewrite or delete history destructively; deletions are new events or tombstones. Preserve the guarantee that an event written on one device is never erased by an older copy of another device.
- **No new permissions without justification.** Do not widen the Tauri capabilities or the CSP to add filesystem, HTTP, shell, or process access to the frontend. Discuss the need in an issue first.
- **Vault data never enters the repository.** Tests, fixtures, screenshots, and logs must use synthetic data. Never commit a real vault, backup, food log, or personal measurement.
- **License compatibility.** New dependencies must be compatible with MIT. The current MPL-2.0, CDLA, and platform LGPL exceptions are documented in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Any new copyleft dependency needs prior discussion.
- **Bundled data attribution.** The barcode catalog derives from Open Food Facts and is distributed under ODbL-1.0 / DbCL-1.0. Do not remove its attribution or regenerate it from an incompatible source.

## Development setup

### Prerequisites

- **Node.js 22+** and npm.
- **Stable Rust** with `cargo`.
- **Tauri 2 dependencies** for your platform. On Debian/Ubuntu:

  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev patchelf
  ```

- On Linux, GTK/WebKit and Wayland support. The app runs natively on Wayland.
- Optional: `cargo-deny` and `cargo-audit` to reproduce the CI license and advisory checks.
- Optional: an Android SDK and NDK if you are building the Android target.

### First build

```bash
git clone https://github.com/wulflo/BetterTracker.git
cd BetterTracker
npm ci
npm run tauri dev
```

To work on the frontend without the Tauri IPC layer:

```bash
npm run dev
```

## Useful commands

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Frontend only, in the browser |
| `npm run tauri dev` | Full desktop app |
| `npm run build` | Type-check and build the frontend |
| `npm run build:store` | Microsoft Store build without the in-app updater |
| `npm test` | Run the Vitest unit tests once |
| `npm run icons` | Regenerate desktop and Android icons |
| `npm run tauri build` | Package the app for the current platform |

Rust commands run against the Tauri manifest:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo deny --manifest-path src-tauri/Cargo.toml check
cargo audit --file src-tauri/Cargo.lock
```

The Playwright configuration in `playwright.config.ts` drives visual tests against `npm run dev`.

## Tests and continuous integration

CI lives in [.github/workflows/ci.yml](.github/workflows/ci.yml) and runs on every push and pull request. It performs:

1. `npm ci`
2. `node scripts/sync-version.mjs` followed by a clean-diff check of every versioned file
3. `npm run icons` followed by a clean-diff check of the reproducible icons
4. `npx tsc --noEmit`
5. `npm test`
6. `npm audit --omit=dev --audit-level=high`
7. `cargo test --manifest-path src-tauri/Cargo.toml`
8. `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
9. `cargo deny` and `cargo audit`

Guidelines:

- Add tests for every new behavior and every bug fix.
- Frontend tests use Vitest and live next to the code as `src/**/*.test.ts`. Rust tests use the standard `cargo test` harness.
- Pay special attention to metric formulas, food calculations, vault reads and writes, backup and restore, barcode matching, the updater, and signature verification.
- Before pushing, run at least `npm run build`, `npm test`, `cargo test`, and `cargo clippy -- -D warnings`.
- CI must pass before a pull request can be merged.

If a check is slow or unavailable on your machine, say so in the pull request and list the checks you did run.

## Versioning and releases

The version lives in [VERSION](VERSION) and is propagated to `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `snapcraft.yaml`, and the Flatpak metainfo. After changing `VERSION`, run:

```bash
node scripts/sync-version.mjs
```

Never edit those files by hand. CI fails if the copies are out of sync.

Releases are cut by the maintainer by pushing a tag of the form `vX.Y.Z` that matches [VERSION](VERSION). The [release workflow](.github/workflows/release.yml) verifies the version, builds Linux, Windows and Android artifacts, signs the updater files and the APK, and publishes a GitHub release.

A normal push to `main` only runs CI; it does not publish anything. To release:

1. Set `VERSION` to `X.Y.Z` and run `node scripts/sync-version.mjs`.
2. Commit, push to `main`, and wait for CI.
3. Create and push the matching tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The workflow rejects a tag that does not match `VERSION`. Tag pushes also publish the Snap to Snapcraft on the **stable** channel. Do not create release tags from a pull request.

## Coding guidelines

### TypeScript and React

- Keep TypeScript strict mode clean (`strict: true`). Avoid `any`; prefer explicit types and domain models.
- Use function components and hooks, following the patterns already in `src/`.
- Never add network calls, remote assets, or direct filesystem access to the frontend. File and system access goes through typed Tauri commands.
- Keep user-facing strings translatable in both Spanish and English.

### Rust

- Run `cargo fmt` and keep Clippy clean with `-D warnings`.
- Keep domain logic pure where possible. Filesystem, SAF, network, and OS integration belong at the edges.
- Prefer explicit errors over panics. Do not include vault contents, secrets, or personal paths in error messages or logs.
- Do not add a second HTTP client. The project standardizes on the existing `reqwest` 0.12 stack with `rustls-tls-webpki-roots`; see [DECISIONES.md](DECISIONES.md) before touching TLS.

### Data and compatibility

- Events are append-only. For deletions, write a new event or tombstone instead of rewriting or removing history.
- Keep the snapshot backup format and its manifest compatible. Restores must never delete or overwrite events already in `omega`.
- The barcode catalog is generated with `scripts/generate-barcode-catalog.mjs` from an Open Food Facts mini export. Do not hand-edit `src/data/barcodeCatalog.json`.
- When the vault format or an algorithm changes, update the relevant file under `docs/` and record the decision in [DECISIONES.md](DECISIONES.md).

### Icons and assets

- The icon master is `src-tauri/icons/app-icon.png`. Run `npm run icons` after changing it; CI checks that the generated icons are committed.
- Only add artwork you have the right to distribute. Do not bundle third-party fonts or icon sets without updating [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Documentation

- Update the README (both [README.md](README.md) and [README.es.md](README.es.md)) when user-visible behavior changes.
- Update the relevant files under `docs/` when architecture, storage, security, or release behavior changes.
- Record architectural decisions in [DECISIONES.md](DECISIONES.md).
- Add new dependencies or bundled data sources to [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) in the imperative mood, with a scope when it helps:

```text
feat(nutrition): add barcode match suggestions
fix(vault): preserve events when restoring a backup
docs(readme): document the Flatpak build
chore(deps): update Tauri
```

Keep commits focused. Reference issues when relevant, for example `Closes #42`.

## Pull requests

1. Create a branch from `main` (fork the repository first if you do not have write access), for example `feat/barcode-suggestions` or `fix/backup-restore`.
2. Make the change, add tests, and update the documentation.
3. Run the checks from [Tests and continuous integration](#tests-and-continuous-integration).
4. Verify that no secrets, real vault data, or personal information are included in the diff.
5. Open the pull request with:
   - a short summary of what changed and why;
   - screenshots or a recording for UI changes;
   - the tests and checks you ran;
   - the issue it closes, if any.
6. Keep CI green and respond to review comments. The maintainer may squash or rebase commits before merging.
7. Do not push to `main` or create release tags; releases are handled by the maintainer.

## Reporting bugs and requesting features

Open a GitHub issue and include:

- Better Fitness Tracker version and operating system.
- Steps to reproduce the problem.
- Expected and actual behavior.
- Relevant logs or screenshots with personal data removed.

Do not attach a real vault, backup, signing key, passphrase, or token. Use synthetic data in reproductions.

## Security

Do not open a public issue for a vulnerability. Use GitHub's private advisory form:

**https://github.com/wulflo/BetterTracker/security/advisories/new**

Include the affected version, the impact, and reproduction steps. Do not include real vault contents or personal data.

## License and third-party notices

By contributing, you agree that your contributions are licensed under the same terms as the project: **MIT**. See [LICENSE](LICENSE).

Third-party dependencies, the MPL-2.0 exceptions, the CDLA data dependencies, the platform LGPL components, and the Open Food Facts attribution are documented in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
