# Releasing

Releases are published to npm by `.github/workflows/release.yml` when a version tag is pushed.

1. Bump `version` in `package.json` in a PR and merge it to `main`.
2. Tag the merged commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag v$(node -p "require('./package.json').version")
   git push origin --tags
   ```

3. The workflow checks the tag matches `package.json`, runs typecheck, lint, tests and the package test,
   publishes with npm provenance, and creates a GitHub release with generated notes.

## One-time setup

Either of these, on npmjs.com (a package owner):

- **Trusted publishing (preferred, no secret):** `@apideck/docs-mcp` → Settings → Trusted publisher →
  GitHub Actions, organization `apideck-libraries`, repository `docs-mcp`, workflow `release.yml`.
- **Token:** create an automation token and save it as the `NPM_TOKEN` repository secret.

A version bump merged without a tag is not published. Check with `npm view @apideck/docs-mcp version`.
