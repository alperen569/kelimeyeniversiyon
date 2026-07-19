const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MARKER = "ocean-loader.css";
const SNIPPET = [
  '<link rel="stylesheet" href="/shared/ocean-loader.css">',
  '<script src="/shared/ocean-loader.js"></script>',
  ""
].join("\n");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

function inject(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes(MARKER)) {
    return false;
  }

  const updated = content.replace(/<head([^>]*)>/i, `<head$1>\n${SNIPPET}`);
  if (updated === content) {
    console.warn("Head bulunamadi:", filePath);
    return false;
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return true;
}

const htmlFiles = walk(ROOT);
let injected = 0;

for (const filePath of htmlFiles) {
  if (inject(filePath)) {
    injected += 1;
    console.log("Eklendi:", path.relative(ROOT, filePath));
  }
}

console.log(`Toplam ${injected} HTML dosyasina yukleme ekrani eklendi.`);
