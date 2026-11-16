const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/release-crx.yml"), "utf8");
const bash = process.platform === "win32"
  ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe") : "bash";
const available = spawnSync(bash, ["--version"], { windowsHide: true }).status === 0;

// Execute the actual workflow shell blocks, rather than duplicating tag logic.
function script(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`      - name: ${name}`);
  assert.ok(start >= 0, name);
  const next = lines.findIndex((line, index) => index > start && line.startsWith("      - name:"));
  const step = lines.slice(start, next < 0 ? undefined : next);
  const run = step.indexOf("        run: |");
  assert.ok(run >= 0, name);
  return step.slice(run + 1).map(line => line.slice(10)).join("\n");
}

function fixture(t) {
  const temp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, "vk-dating-release-"));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), temp);
    assert.ok(path.basename(resolved).startsWith("vk-dating-release-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const repo = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(repo, "test-bin"));
  fs.writeFileSync(path.join(repo, "test-bin/node"), '#!/bin/sh\nexec "${NODE_EXECUTABLE}" "$@"\n', { mode: 0o755 });
  function git(...args) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  git("init", "--bare", "--quiet", remote);
  git("init", "--quiet", "--initial-branch=main");
  git("remote", "add", "origin", remote);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src/manifest.json"), JSON.stringify({ version: "1.0.0.0" }));
  function commit(text) {
    fs.writeFileSync(path.join(repo, "content.txt"), text);
    git("add", ".");
    git("-c", "user.name=Workflow Test", "-c", "user.email=test@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", text);
    return git("rev-parse", "HEAD");
  }
  const sha = commit("Initial source");
  git("push", "--quiet", "origin", "main");
  function run(name, overrides = {}) {
    return spawnSync(bash, ["--noprofile", "--norc", "-c", 'export PATH="$PWD/test-bin:$PATH"\n' + script(name)], {
      cwd: repo, encoding: "utf8", windowsHide: true,
      env: { ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "main",
        INPUT_TAG: "v1.0.0.0", TAG: "v1.0.0.0", SOURCE_SHA: sha,
        GITHUB_OUTPUT: "outputs.txt", NODE_EXECUTABLE: process.execPath.replace(/\\/g, "/"), ...overrides }
    });
  }
  return { repo, remote, sha, git, commit, run };
}

const options = { skip: available ? false : "Git Bash or Bash is required for release workflow tests" };

test("manual release resolves a new tag from the selected branch and publishes it", options, t => {
  const f = fixture(t);
  assert.equal(f.run("Resolve release source").status, 0);
  assert.equal(f.git("tag", "--list", "v1.0.0.0"), "");
  const outputs = fs.readFileSync(path.join(f.repo, "outputs.txt"), "utf8");
  assert.ok(outputs.includes(`sha=${f.sha}`));
  assert.ok(outputs.includes("tag=v1.0.0.0"));
  const metadata = f.run("Resolve release metadata");
  assert.equal(metadata.status, 0, metadata.stderr);
  const publish = f.run("Create or verify release tag");
  assert.equal(publish.status, 0, publish.stderr);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v1.0.0.0"), f.sha);
  const again = f.run("Create or verify release tag");
  assert.equal(again.status, 0, again.stderr);
});

test("manual release checks out the existing tag instead of retagging the selected branch", options, t => {
  const f = fixture(t);
  f.git("-c", "user.name=Workflow Test", "-c", "user.email=test@example.invalid",
    "-c", "tag.gpgsign=false", "tag", "-a", "v1.0.0.0", "-m", "Existing release");
  f.git("push", "--quiet", "origin", "refs/tags/v1.0.0.0");
  const next = f.commit("New branch source");
  assert.notEqual(next, f.sha);
  const result = f.run("Resolve release source");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git("rev-parse", "HEAD"), f.sha);
  assert.equal(f.run("Create or verify release tag").status, 0);
});

test("release tag cannot be silently moved to another commit", options, t => {
  const f = fixture(t);
  f.git("tag", "v1.0.0.0");
  const next = f.commit("Changed source");
  const result = f.run("Create or verify release tag", { SOURCE_SHA: next });
  assert.notEqual(result.status, 0);
  assert.equal(f.git("rev-parse", "refs/tags/v1.0.0.0"), f.sha);
});

test("a tag created remotely during the build cannot be overwritten", options, t => {
  const f = fixture(t);
  f.git("tag", "v1.0.0.0");
  f.git("push", "--quiet", "origin", "refs/tags/v1.0.0.0");
  f.git("tag", "-d", "v1.0.0.0");
  const next = f.commit("Concurrent source");
  const result = f.run("Create or verify release tag", { SOURCE_SHA: next });
  assert.notEqual(result.status, 0);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v1.0.0.0"), f.sha);
});

test("a version mismatch fails before any release tag is created", options, t => {
  const f = fixture(t);
  assert.equal(f.run("Resolve release source", { INPUT_TAG: "v2.0.0.0" }).status, 0);
  assert.notEqual(f.run("Resolve release metadata", { TAG: "v2.0.0.0" }).status, 0);
  assert.equal(f.git("tag", "--list"), "");
});

test("manual tag input is data rather than executable shell code", options, t => {
  const f = fixture(t);
  const malicious = 'v1.0.0.0$(touch PWNED)';
  assert.notEqual(f.run("Resolve release source", { INPUT_TAG: malicious }).status, 0);
  assert.notEqual(f.run("Resolve release metadata", { TAG: malicious }).status, 0);
  assert.equal(fs.existsSync(path.join(f.repo, "PWNED")), false);
});
