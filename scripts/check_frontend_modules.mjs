import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const interfaceDir = path.join(root, "interface");
const modulesDir = path.join(interfaceDir, "js");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

const modules = new Set(listFiles(modulesDir).filter((file) => file.endsWith(".js")));
const roots = [];
for (const html of listFiles(interfaceDir).filter((file) => file.endsWith(".html"))) {
  const source = readFileSync(html, "utf8");
  for (const match of source.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\btype=["']module["']/i.test(attributes)) continue;
    const sourceAttribute = attributes.match(/\bsrc=["']([^"']+)["']/i);
    if (sourceAttribute) {
      const specifier = sourceAttribute[1].split("?")[0];
      roots.push(specifier.startsWith("/")
        ? path.resolve(interfaceDir, specifier.slice(1))
        : path.resolve(path.dirname(html), specifier));
    }
  }
}

const visited = new Set();
const pending = [...roots];
const errors = [];
while (pending.length > 0) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  if (!modules.has(file)) {
    errors.push(`Módulo referenciado não encontrado: ${path.relative(root, file)}`);
    continue;
  }
  visited.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s+)?["']([^"']+)["']/g)) {
    const specifier = match[1].split("?")[0];
    if (!specifier.startsWith(".")) continue;
    pending.push(path.resolve(path.dirname(file), specifier));
  }
}

for (const file of modules) {
  if (!visited.has(file)) {
    errors.push(`Módulo sem caminho a partir de uma tela: ${path.relative(root, file)}`);
  }
}
if (roots.length === 0) errors.push("Nenhum módulo de entrada foi encontrado nas telas HTML.");

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`OK: ${modules.size} módulos JavaScript alcançáveis a partir das telas.`);
}
