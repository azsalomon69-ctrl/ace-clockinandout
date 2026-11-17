import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { decode } from '@jridgewell/sourcemap-codec';
import { tokenizer } from 'acorn';

const sections = [
  'General application identifiers', 'Authentication and authorization', 'Employee management',
  'Attendance and time tracking', 'Holiday calendar', 'Time analytics', 'Admin functionality',
  'API and service functions', 'Other relevant project modules'
];

function sectionFor(file, name) {
  if (/holiday/i.test(file + name)) return 4;
  if (/auth|login|logout|permission|oauth/i.test(name)) return 1;
  if (/supabase-auth/i.test(file) || /fetch|request|retry|network|service/i.test(name)) return 7;
  if (/analytics|leaderboard|chart|report|duration|totals/i.test(file + name)) return 5;
  if (/clock|attendance|shift|timeEntr|schedule/i.test(file + name)) return 3;
  if (/employee-profile|deleted-users|employee|invitation|department/i.test(file + name)) return 2;
  if (/admin/i.test(file + name)) return 6;
  return /\/script\.js$/.test(file) ? 0 : 8;
}

function describe(name, sourceLine) {
  const words = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase().trim();
  if (words.length < 3 || !words.includes(' ')) {
    return 'Local binding. See the source statement below.';
  }
  const isFunction = new RegExp('\\bfunction\\s+' + name.replaceAll('$', '\\$') + '\\b').test(sourceLine);
  return isFunction ? 'Function to ' + words + '.' : 'Local identifier for ' + words + '.';
}

async function outsideWorktree(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const gitEntry = await access(path.join(current, '.git')).then(() => true, error => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    });
    if (gitEntry) throw new Error('Private build artifacts must stay outside Git worktrees: ' + directory);
    if (current === path.dirname(current)) return;
  }
}

export async function createPrivateMappings(profile) {
  const directory = path.resolve(process.env.ACE_PRIVATE_MAP_DIR || path.join(homedir(), 'OneDrive', 'Documents', 'obfuscation'));
  await outsideWorktree(directory);
  await mkdir(directory, { recursive: true });
  const canonicalDirectory = await realpath(directory);
  await outsideWorktree(canonicalDirectory);
  const output = path.join(canonicalDirectory, 'source-maps');
  await mkdir(output, { recursive: true });
  const canonicalOutput = await realpath(output);
  if (path.dirname(canonicalOutput) !== canonicalDirectory) throw new Error('The private source-maps folder must stay under ' + canonicalDirectory);
  const supplemental = JSON.parse(await readFile(path.join(canonicalDirectory, 'semantic.reverse-map.local.json'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '[]';
  }));
  const corrections = new Map();
  for (const entry of supplemental) {
    const key = [entry.asset, entry.hash, entry.generatedLine, entry.generatedColumn].join(':');
    if (corrections.has(key)) throw new Error('Duplicate private mapping correction: ' + key);
    corrections.set(key, entry);
  }
  const groups = sections.map(() => []);
  const bundles = [];
  const properties = [];
  const literals = [];
  const unresolved = [];

  return {
    async record(asset, hash, code, rawMap, nameCache, strings) {
      const map = JSON.parse(rawMap);
      let mapName = hash + '.js.map';
      map.file = asset;
      const content = JSON.stringify(map) + '\n';
      try {
        await writeFile(path.join(canonicalOutput, mapName), content, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await readFile(path.join(canonicalOutput, mapName), 'utf8') !== content) {
          const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
          mapName = hash + '-' + digest + '.js.map';
          await writeFile(path.join(canonicalOutput, mapName), content, { flag: 'wx' }).catch(async collision => {
            if (collision.code !== 'EEXIST' || await readFile(path.join(canonicalOutput, mapName), 'utf8') !== content) throw collision;
          });
        }
      }
      bundles.push([asset, mapName]);
      for (const [key, emitted] of Object.entries(nameCache.props?.props || {})) {
        properties.push([key.slice(1), emitted, asset]);
      }
      for (const purpose of strings) literals.push([asset, purpose]);
      const resolved = new Set();
      const originalLines = map.sourcesContent.map(source => source.split(/\r?\n/));
      const emittedLines = code.split('\n');
      const seen = new Set();
      decode(map.mappings).forEach((segments, line) => {
        for (const [column, source, originalLine, originalColumn, nameIndex] of segments) {
          if (nameIndex === undefined) continue;
          const name = map.names[nameIndex];
          const emitted = /^_0x[0-9a-z]+\b/.exec(emittedLines[line].slice(column))?.[0];
          const statement = originalLines[source][originalLine];
          if (!emitted || emitted === name || !statement.slice(originalColumn).startsWith(name)) continue;
          const file = map.sources[source];
          resolved.add(line + ':' + column);
          const key = [file, originalLine, originalColumn, name, emitted].join(':');
          if (seen.has(key)) continue;
          seen.add(key);
          groups[sectionFor(file, name)].push([
            name, emitted, file + ':' + (originalLine + 1), asset + ':' + (line + 1) + ':' + (column + 1),
            (/\bfunction\s*\*?\s*$/.test(statement.slice(0, originalColumn)) ? 'Function' :
              /\bclass\s*$/.test(statement.slice(0, originalColumn)) ? 'Class' :
              /\bconst\s*$/.test(statement.slice(0, originalColumn)) ? 'Constant' : 'Binding or reference'),
            describe(name, statement)
          ]);
        }
      });
      for (const token of tokenizer(code, { ecmaVersion: 'latest', locations: true })) {
        if (token.type.label !== 'name' || !/^_0x[0-9a-z]+$/.test(token.value)) continue;
        const { line, column } = token.loc.start;
        const position = (line - 1) + ':' + column;
        const correctionKey = [asset, hash, line, column + 1].join(':');
        const correction = corrections.get(correctionKey);
        if (!correction) {
          if (!resolved.has(position)) unresolved.push([asset, token.value, line + ':' + (column + 1)]);
          continue;
        }
        const sourceIndex = map.sources.indexOf(correction.file);
        const statement = originalLines[sourceIndex]?.[correction.originalLine - 1];
        const original = statement?.slice(correction.originalColumn - 1).match(/^[\w$]+/)?.[0];
        if (resolved.has(position) || token.value !== correction.alias || original !== correction.original) {
          throw new Error('Private mapping correction failed source and output validation: ' + correctionKey);
        }
        groups[sectionFor(correction.file, correction.original)].push([
          correction.original, token.value, correction.file + ':' + correction.originalLine,
          asset + ':' + line + ':' + (column + 1), correction.type, correction.purpose
        ]);
        corrections.delete(correctionKey);
      }
    },

    async writeDocument(audit) {
      const activeAssets = new Set(bundles.map(([asset, name]) => asset + ':' + name.split(/[.-]/)[0]));
      for (const entry of corrections.values()) {
        if (activeAssets.has(entry.asset + ':' + entry.hash)) throw new Error('Private mapping correction did not match a generated identifier: ' + entry.asset);
      }
      const lines = [
        '# Private production identifier map', '',
        '## Project and obfuscation overview', '',
        'ACE Clock In / Out uses classic browser scripts plus an ES module for the Three.js game.',
        'Generated by npm run build:local. Keep this file and the source maps local.',
        'Identifiers can repeat in different scopes. Use the generated location and matching map to resolve a specific occurrence.',
        'The maps contain the full original first-party JavaScript, including bindings that were preserved and expressions optimized away from the listing.',
        'Vendor code is copied as supplied and excluded from this guide.', '',
        '## Obfuscation configuration', '',
        'Seed: ' + JSON.stringify(profile.seed),
        'Identifier strategy: ' + profile.strategy + '. Property, string and branch passes: ' + [profile.mangleProperties, profile.encodeStrings, profile.branchExpressions].join(', ') + '.', '',
        '## Build information and mapping version', '',
        'Mapping version 2. Reproduce with the same source revision, lockfile, public API URL and configuration. Asset hashes identify the exact shipped scripts.', '',
        '## Bundle source maps', '',
        '| Production asset | Local map under source-maps/ |', '| --- | --- |',
        ...bundles.map(([asset, map]) => '| ' + asset + ' | ' + map + ' |')
      ];
      lines.push('', '## Important execution flows', '',
        'The browser verifies the session before it loads the workspace. Clock capture and synchronization are tracked separately from the dashboard history.', '',
        '## Authentication and session management', '',
        'The authentication bundle restores Supabase sessions, refreshes an expired token, and attaches the current token to authorized requests.', '',
        '## API communication', '',
        'API paths, header names, request and response keys, and externally visible error text retain their runtime values.', '',
        '## Database and Supabase integration', '',
        'Database and Supabase field names are preserved. The backend and third-party SDK are outside these transformations.', '',
        '## Application state management', '',
        'Cross-script globals, storage keys and application event names remain stable. Clock-outbox storage stays readable for development.', '',
        '## Excluded identifiers and properties', '',
        'Classic script globals and exported module names stay stable. Property mangling is limited to the two audited analytics boundary fields listed below.', '',
        '## Property mapping', '',
        ...properties.map(([name, emitted, asset]) => '- ' + name + ' → ' + emitted + ' in ' + asset + '. Internal analytics date-range boundary.'), '',
        '## String transformation documentation', '',
        ...literals.map(([asset, purpose]) => '- ' + asset + ': ' + purpose), '',
        '## Control-flow transformation documentation', '',
        'Terser performs its safe conditional simplifications, boolean rewrites, and constant folding. There is no custom dispatcher, dead code, or branch flattening.', '',
        '## Function mapping', '',
        'Search the type column below for Function. The embedded original source contains complete signatures, return logic, dependencies, and effects.', '',
        '## Variable and constant mapping', '',
        'Search for Constant or Binding or reference in the type column below.', '',
        '## Class mapping', '',
        'Search for Class in the type column below. The original source also preserves private and public members and superclass information.', '',
        '## Identifier mapping');
      for (const [index, rows] of groups.entries()) {
        lines.push('', '### ' + sections[index], '');
        if (!rows.length) {
          lines.push('No renamed identifiers matched this category.');
          continue;
        }
        lines.push('| Original | Obfuscated | Source | Generated location | Type | Purpose |', '| --- | --- | --- | --- | --- | --- |');
        for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
      }
      lines.push('', '## Application-wide JavaScript audit', '',
        'Discovered project files: ' + audit.length + '. Included: ' + audit.filter(([, disposition]) => disposition === 'Included').length + '.',
        'Confirmed identifier mapping rows: ' + groups.reduce((count, rows) => count + rows.length, 0) + '.',
        'Property mappings: ' + properties.length + '. Escaped literal occurrences: ' + literals.length + '. Unresolved identifier occurrences: ' + unresolved.length + '.',
        'The Terser compressor does not emit individual branch rewrite counts.', '',
        '| File | Disposition | Explanation |', '| --- | --- | --- |',
        ...audit.map(row => '| ' + row.join(' | ') + ' |'), '',
        'Supabase, XLSX and Three.js dependencies are copied separately as vendor assets.', '',
        '## Debugging instructions', '',
        'Match the hashed bundle to its private source map, then follow the generated line and column to the original token or statement. The original source is embedded in each map.', '',
        '## Known limitations', '',
        'Identifier types and purposes in the tables are hints based on the source location. Read the embedded source for signatures, return values, side effects, and dependencies.',
        'The following generated tokens lack exact named anchors after compression. The private audit lists their same-scope bindings.', '',
        '| Bundle | Identifier | Generated line:column |', '| --- | --- | --- |',
        ...unresolved.map(row => '| ' + row.join(' | ') + ' |'), '',
        '## Update history', '',
        '- Version 1: basic binding mangling and private maps. See history/SEMANTIC_MAP.before-advanced.local.md.',
        '- Version 2: seeded naming, audited properties, escaped timeout strings, and configurable safe branch expressions.');
      const guide = path.join(canonicalDirectory, 'SEMANTIC_MAP.local.md');
      const existing = await lstat(guide).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing && (!existing.isFile() || existing.nlink !== 1)) throw new Error('Private guide must be a regular, unlinked file: ' + guide);
      await writeFile(guide, lines.join('\n') + '\n');
    }
  };
}
