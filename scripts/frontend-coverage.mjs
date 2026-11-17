import { readdir } from 'node:fs/promises';
import path from 'node:path';

const excludedDirectories = new Set(['.git', '.semantic-local', '.production-updates', 'node_modules', 'dist', 'coverage']);

export async function discoverJavaScript(directory, prefix = '') {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
      files.push(...await discoverJavaScript(path.join(directory, entry.name), relative + '/'));
    } else if (entry.isFile() && /\.(?:[cm]?js|jsx|tsx?)$/i.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

export function auditJavaScript(files, bundled) {
  return files.map(file => {
    if (bundled.has(file)) return [file, 'Included', 'Emitted as ' + bundled.get(file)];
    if (file.startsWith('frontend/')) throw new Error('Unprocessed browser source: ' + file);
    if (file.startsWith('backend/server/')) return [file, 'Excluded', 'Private Express runtime deployed directly by npm start'];
    if (file.startsWith('workers/')) return [file, 'Excluded', 'Separate worker deployment with its own entry point'];
    if (file.startsWith('backend/tests/') || file.startsWith('scripts/ui-tests/')) return [file, 'Excluded', 'Test or fixture'];
    if (file.startsWith('deliverables/')) return [file, 'Excluded', 'Audit reproduction tooling'];
    return [file, 'Excluded', 'Build, provisioning, or maintenance tooling outside the browser release'];
  });
}
