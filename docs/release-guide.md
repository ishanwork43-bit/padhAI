# Prepare and publish PadhAI v0.1.0

Version **0.1.0** is the proposed first portfolio release. This guide separates
local preparation from the commands you may later choose to run against GitHub.
The initial source and tag have since been published at the owner's request:
[GitHub release v0.1.0](https://github.com/ishanwork43-bit/padhAI/releases/tag/v0.1.0).
The commands below illustrate the original release workflow; do not recreate or
move that published tag. Use a new reviewed version/tag for a future release.
The existing v0.1.0 ZIP was built from the v0.1.0 source snapshot. Current `main`
also includes later hosting additions; building `main` produces a development
snapshot with different bytes, even while the Python MVP version remains 0.1.0.
Check out the release tag in a separate clone when reproducing its exact archive.

The source version is in [VERSION](../VERSION), changes are in
[CHANGELOG.md](../CHANGELOG.md), and the prepared release description is
[release-notes-v0.1.0.md](release-notes-v0.1.0.md).

## 1. Verify the local project

Open Terminal in the project root. Use your existing virtual environment, or
follow the README's fresh-install instructions first:

```bash
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m pip check
```

The ordinary test suite uses simulated API replies and deterministic embedding
substitutes, with real Chroma storage; it needs no OpenAI key or model download.
See [verification.md](verification.md) for the actual environment and completed
checks. macOS instructions were written but not executed on a Mac in this delivery.
GitHub Actions is configured; a local pass does not mean CI has run on GitHub.

The real-model evaluation is optional for packaging and slower than ordinary
tests. Its first run downloads pinned public model weights:

```bash
python -m evaluation.run_retrieval --output evaluation/results.json
```

After the model is cached, you can run it without Hub access:

```bash
HF_HUB_OFFLINE=1 python -m evaluation.run_retrieval --output evaluation/results.json
```

The included results record the dataset hash, model revision, runtime versions,
parameters, and per-query rankings. The existing run covers eight documents,
eighteen answerable questions, and two negatives. Its high scores come from a
small hand-authored fixture, not a held-out general accuracy benchmark. If you
rerun it, review the new JSON and keep the README/results summary consistent with
that actual run; do not silently reuse old metrics after changing the corpus,
labels, model, or settings. See [retrieval-results.md](retrieval-results.md).

## 2. Build and check the archive

The builder uses [release-files.txt](../release-files.txt) as an explicit file
allowlist, so unrelated files in your project directory are not automatically
bundled. Review the manifest when intentionally adding release content.

```bash
python scripts/build_release.py --output-dir dist
cd dist
shasum -a 256 -c padhai-0.1.0.zip.sha256
cd ..
```

Expected artifacts:

- `dist/padhai-0.1.0.zip`, containing a `padhai-0.1.0/` project folder.
- `dist/padhai-0.1.0.zip.sha256`, for checking that downloaded ZIP bytes match.

On Linux, `sha256sum -c padhai-0.1.0.zip.sha256` is an equivalent check from `dist`.
The checksum checks integrity against that checksum file; it is not a signed
publisher identity. `dist/` is ignored by Git and should be attached as a release
asset rather than committed into source history.

Try extracting the ZIP into a separate directory and inspect its README before
sharing it. Keep `.env`, local databases, virtual environments, model caches, and
private study documents out of the source/release file lists. The sample documents
and evaluation corpus are intentionally included.

## 3. Create the local Git history

For a fresh copy with no `.git` directory:

```bash
git init -b main
git config --get user.name
git config --get user.email
```

If the two identity checks show no value or the wrong identity, set **your own**
name and email for this repository. Replace both placeholder strings; a GitHub
noreply email is an option if you do not want your personal email in public commits.
Do not use an assistant's identity.

```bash
git config --local user.name "YOUR NAME"
git config --local user.email "YOUR_EMAIL_OR_GITHUB_NOREPLY_EMAIL"
```

If this folder already has Git history, start with `git status` and use its
existing repository/branch intentionally; do not reinitialize or overwrite it
just to follow these fresh-project instructions.

Stage the intended project paths explicitly:

```bash
git add app.py src tests evaluation sample_data docs scripts requirements.txt requirements-dev.txt pytest.ini README.md LICENSE VERSION CHANGELOG.md release-files.txt .env.example .gitignore .gitattributes .streamlit/config.toml .github
```

Review exactly what will enter the initial commit:

```bash
git status --short
git diff --cached --stat
git diff --cached --name-only
git diff --cached --check
git diff --cached
git check-ignore .env .streamlit/secrets.toml
git ls-files -- .env .streamlit/secrets.toml
```

The ignore check should list those secret paths; `git ls-files` should list
neither. An ignore rule does not remove a file already tracked in an existing
repository. Review the staged diff, including example notes, before committing.
The example settings file belongs in Git; a real `.env` does not.

When the staged content is ready:

```bash
git commit -m "Release PadhAI v0.1.0 portfolio MVP"
git tag -a v0.1.0 -m "PadhAI v0.1.0"
git status --short
```

The final status should be clean apart from any intentional unstaged local work.
The tag identifies the reviewed commit; if you make more release changes, finish
reviewing those changes before creating the release tag rather than casually
moving a tag that has already been published.

## 4. Publish to GitHub only when you choose

Everything below contacts GitHub. Replace `YOUR_GITHUB_USERNAME` with your account
or organization and choose your repository visibility deliberately.

In GitHub's website, create an empty repository named **padhai**. For this initial
push, leave the options to add a README, license, and `.gitignore` unchecked because
this project already contains them. Then run:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/padhai.git
git push -u origin main
git push origin v0.1.0
```

If `origin` already exists, inspect `git remote -v` and use the intended remote;
do not replace it blindly. Authenticate with your own GitHub account as prompted.
Wait for the repository's **Actions** checks and inspect any failures before
advertising a green build.

If you prefer GitHub CLI, install and authenticate it yourself, then create the
empty remote instead of using the website:

```bash
gh auth login
gh repo create YOUR_GITHUB_USERNAME/padhai --public
```

Use `--private` instead if that is your chosen visibility. After creation, run
the same `git remote add` and push commands above. Run only one repository-creation
method; no automatic `--push` step is hidden in the CLI command.

## 5. Create the release

On GitHub, open **Releases → Draft a new release**, select the existing
`v0.1.0` tag, use **PadhAI v0.1.0** as the title, and copy the prepared
[release notes](release-notes-v0.1.0.md). Attach the ZIP and its `.sha256` file
from `dist/`. Review the version, assets, limitations, and CI result, then publish
when you are ready.

The equivalent optional CLI command is:

```bash
gh release create v0.1.0 dist/padhai-0.1.0.zip dist/padhai-0.1.0.zip.sha256 --verify-tag --title "PadhAI v0.1.0" --notes-file docs/release-notes-v0.1.0.md
```

`--verify-tag` requires the tag already pushed to GitHub. The command publishes
the release; use the website's draft flow if you want a separate final review.

## Final review

- Version/tag, release notes, manifest, ZIP root, and asset names all say 0.1.0.
- Tests and dependency checks pass; reported retrieval metrics match their JSON
  artifact and retain the small-dataset qualification.
- Source history and release assets contain intended code/examples, not private
  notes or credentials; the archive checksum verifies.
- The README/demo accurately state that live OpenAI answer/quiz generation was
  not verified, notes are temporary, and this is a portfolio MVP without a
  production-security claim.

Use [demo-guide.md](demo-guide.md) for the short presentation. Keep
[architecture.md](architecture.md), [verification.md](verification.md), and
[retrieval-results.md](retrieval-results.md) linked from the published project so
reviewers can inspect the implementation's evidence and limits.
