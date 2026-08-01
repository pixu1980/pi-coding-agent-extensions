import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagesDir = join(root, "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

test("every extension ships a structured, accessible SVG banner", () => {
  const themes = new Set();

  for (const packageDir of packageDirs) {
    const directory = join(packagesDir, packageDir);
    const bannerPath = join(directory, "lib", "banner.svg");
    assert.ok(existsSync(bannerPath), `${packageDir} is missing lib/banner.svg`);
    assert.ok(!existsSync(join(directory, "lib", "banner.png")), `${packageDir} still ships a raster banner`);

    const svg = readFileSync(bannerPath, "utf8");
    assert.match(svg, /viewBox="0 0 1792 592"/, `${packageDir} uses the shared canvas`);
    assert.match(svg, /role="img"/, `${packageDir} banner is exposed as an image`);
    assert.match(svg, /aria-labelledby="banner-title banner-description"/);
    assert.match(svg, new RegExp(`<title id="banner-title">[^<]*${packageDir}[^<]*<\\/title>`));
    assert.match(svg, /<desc id="banner-description">[^<]+<\/desc>/);

    for (const group of ["background", "grid", "artwork", "typography", "metadata"]) {
      assert.match(svg, new RegExp(`<g id="${group}"`), `${packageDir} is missing the ${group} group`);
    }

    const theme = svg.match(/data-theme="([^"]+)"/)?.[1];
    assert.ok(theme, `${packageDir} is missing its theme identifier`);
    themes.add(theme);

    const readme = readFileSync(join(directory, "README.md"), "utf8");
    assert.match(readme, /src="\.\/lib\/banner\.svg"/, `${packageDir} README does not show its banner`);
  }

  assert.equal(themes.size, packageDirs.length, "each extension needs a distinct visual theme");
});
