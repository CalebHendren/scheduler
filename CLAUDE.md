# Working on this repo

## Always bump the version

Every change that is meant to reach `main` must increment `VERSION` in
`assets/js/util.js`, in the same branch or PR as the change. It is the only
place the version is written down. CI reads it, and a push to `main` that
changes it tags the commit and publishes a release with the single-file build.

Use semantic versioning:

- **Patch** (`1.2.0` → `1.2.1`): a bug fix, a copy or style tweak, a test-only fix.
- **Minor** (`1.2.0` → `1.3.0`): a new feature, a new setting, a changed default,
  a change to what the handout or the PDF shows.
- **Major** (`1.2.0` → `2.0.0`): a saved schedule or an exported file from the
  previous version no longer loads as it did.

Bump it once per PR, not once per commit. If the branch already carries a bump
over `main`, leave it unless the change has grown into a bigger kind (a fix
that became a feature moves a patch bump up to a minor one).

## Tests

Run `node tools/test-optimizer.mjs` before committing; it must end with
`0 failed`. `tools/selftest.html` runs the same suite in a browser.
