import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function readVsixManifest(vsixPath: string): string {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip = [System.IO.Compression.ZipFile]::OpenRead(${JSON.stringify(vsixPath)})`,
    "try {",
    '$entry = $zip.GetEntry("extension.vsixmanifest")',
    'if ($null -eq $entry) { throw "VSIX missing extension.vsixmanifest" }',
    "$reader = [System.IO.StreamReader]::new($entry.Open())",
    "try { $reader.ReadToEnd() } finally { $reader.Dispose() }",
    "} finally { $zip.Dispose() }",
  ].join("; ");

  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
}

test("Marketplace Details is standalone and selected for VSIX packaging", () => {
  const detailsPath = path.join(process.cwd(), "docs", "marketplace-details.md");
  assert.ok(fs.existsSync(detailsPath), "Marketplace Details document must exist");

  const details = fs.readFileSync(detailsPath, "utf8");
  assert.doesNotMatch(details, /\[[^\]]+\]\([^)]*\)/, "Marketplace Details must not contain Markdown links");
  assert.doesNotMatch(details, /https?:\/\//i, "Marketplace Details must not contain external links");

  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.match(packageJson.scripts["package:vsix"], /--readme-path\s+docs\/marketplace-details\.md/);
  assert.match(packageJson.scripts["package:vsix"], /--allow-missing-repository/);
  const vsixPath = path.join(process.cwd(), "releases", `easymail-${packageJson.version}.vsix`);
  assert.ok(!packageJson.files.includes("README.md"), "VSIX must not package the GitHub README beside the custom Details file");
  assert.equal(packageJson.repository, undefined, "VSIX package metadata must not generate Marketplace source links");

  const manifest = readVsixManifest(vsixPath);
  assert.doesNotMatch(manifest, /Microsoft\.VisualStudio\.Services\.Links\./, "VSIX manifest must not contain Marketplace links");
});
