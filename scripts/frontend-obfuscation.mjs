import { createHash } from 'node:crypto';
import { tokenizer } from 'acorn';
import { decode, encode } from '@jridgewell/sourcemap-codec';

const analyticsProperties = ['periodStart', 'periodEnd'];
const privateMessages = new Map([
  ['The ACE service did not respond in time.', 'Timeout error when an ACE request is aborted.'],
  ['Authentication took too long.', 'Default error for a timed-out authentication operation.'],
  ['The ACE configuration response took too long.', 'Timeout while decoding the service configuration response.']
]);

function identifierGenerator(seed, strategy, prefix) {
  const digest = createHash('sha256').update(seed + ':' + prefix).digest();
  const multiplier = digest.readUInt32LE(0) | 1;
  const offset = digest.readUInt32LE(4);
  return {
    get(index) {
      // Odd multiplication is a permutation modulo 2^32.
      if (index > 0xffffffff) throw new Error('Identifier index exceeded its supported range');
      const value = (Math.imul(index, multiplier) + offset) >>> 0;
      return strategy === 'hex' ? prefix + value.toString(16) : prefix + value.toString(36);
    }
  };
}

export function createObfuscationProfile(env = process.env) {
  const seed = env.ACE_OBFUSCATION_SEED ?? 'ace-frontend-v2';
  const strategy = env.ACE_OBFUSCATION_NAMES ?? 'base36';
  if (!['hex', 'base36'].includes(strategy)) throw new Error('ACE_OBFUSCATION_NAMES must be hex or base36');
  const encodeStrings = env.ACE_OBFUSCATION_STRINGS !== '0';
  const mangleProperties = env.ACE_OBFUSCATION_PROPERTIES !== '0';
  const branchExpressions = env.ACE_OBFUSCATION_BRANCHES !== '0';
  return { seed, strategy, encodeStrings, mangleProperties, branchExpressions };
}

export function obfuscationOptions(profile, files, toplevel) {
  const seed = profile.seed + ':' + files.join(',');
  const propertyNames = profile.mangleProperties && files.length === 1 && files[0] === 'frontend/js/script.js'
    ? analyticsProperties : [];
  const nameCache = {};
  return {
    propertyNames,
    nameCache,
    compress: {
      defaults: true, passes: 3,
      conditionals: profile.branchExpressions,
      booleans: profile.branchExpressions,
      evaluate: profile.branchExpressions
    },
    mangle: {
      toplevel,
      nth_identifier: identifierGenerator(seed, profile.strategy, '_0x'),
      ...(propertyNames.length ? {
        properties: {
          regex: /^(?:periodStart|periodEnd)$/,
          keep_quoted: 'strict',
          nth_identifier: identifierGenerator(seed, profile.strategy, '_0p')
        }
      } : {})
    }
  };
}

export function encodePrivateLiterals(result, enabled) {
  if (!enabled) return { ...result, strings: [] };
  const replacements = [];
  for (const token of tokenizer(result.code, { ecmaVersion: 'latest', locations: true })) {
    if (token.type.label !== 'string' || !privateMessages.has(token.value)) continue;
    const text = '"' + token.value.split('').map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"';
    replacements.push({ start: token.start, end: token.end, line: token.loc.start.line - 1,
      column: token.loc.start.column, length: token.end - token.start, text, purpose: privateMessages.get(token.value) });
  }
  if (!replacements.length) return { ...result, strings: [] };
  let code = '';
  let cursor = 0;
  for (const edit of replacements) {
    code += result.code.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  code += result.code.slice(cursor);
  let map = result.map;
  if (map) {
    const data = JSON.parse(map);
    const mappings = decode(data.mappings);
    for (const line of new Set(replacements.map(edit => edit.line))) {
      const edits = replacements.filter(edit => edit.line === line);
      mappings[line] = mappings[line].flatMap(segment => {
        const column = segment[0];
        if (edits.some(edit => column > edit.column && column < edit.column + edit.length)) return [];
        const shift = edits.filter(edit => column >= edit.column + edit.length)
          .reduce((total, edit) => total + edit.text.length - edit.length, 0);
        return [[column + shift, ...segment.slice(1)]];
      });
    }
    data.mappings = encode(mappings);
    map = JSON.stringify(data);
  }
  return { code, map, strings: replacements.map(({ purpose }) => purpose) };
}
