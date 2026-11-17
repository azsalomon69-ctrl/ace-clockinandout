import { parse } from 'acorn';

function bindings(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindings(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindings(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindings);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => bindings(property.type === 'RestElement' ? property.argument : property.value));
  return [];
}

export function topLevelNames(tree) {
  return new Set(tree.body.flatMap(node => {
    if (node.type === 'VariableDeclaration') return node.declarations.flatMap(item => bindings(item.id));
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') return bindings(node.id);
    return [];
  }));
}

const identifiersIn = text => new Set(text.match(/[$\w]+/g) || []);

function findRuntimeNames(ast) {
  const names = new Set();
  let dynamicCode = false;
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      for (const word of identifiersIn(node.value)) names.add(word);
    }
    if (node.type === 'TemplateElement') {
      for (const word of identifiersIn(node.value.raw)) names.add(word);
    }
    if (node.type === 'MemberExpression' && !node.computed) names.add(node.property.name);
    if (['CallExpression', 'NewExpression'].includes(node.type) &&
        ['eval', 'Function'].includes(node.callee.name || node.callee.property?.name)) dynamicCode = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  }
  visit(ast);
  return { names, dynamicCode };
}

export function classicBindingPolicy(file, source, consumers) {
  const tree = parse(source, { ecmaVersion: 'latest' });
  const runtime = findRuntimeNames(tree);
  const references = new Map();
  for (const [consumer, code] of consumers) {
    if (consumer === file) continue;
    for (const word of identifiersIn(code)) {
      if (!references.has(word)) references.set(word, []);
      references.get(word).push(consumer);
    }
  }
  return [...topLevelNames(tree)].sort().map(name => {
    const seenIn = references.get(name);
    if (runtime.dynamicCode) return [name, 'Preserved', 'Dynamic JavaScript evaluation in this file'];
    if (seenIn) return [name, 'Preserved', 'Cross-file reference or string in ' + seenIn.join(', ')];
    if (runtime.names.has(name)) return [name, 'Preserved', 'Member name or runtime string in the declaring file'];
    return [name, 'Eligible', 'Private classic-script binding'];
  });
}

export function reserveClassicGlobals(nameCache, policy) {
  // Identity mappings preserve shared globals without reserving same-named locals.
  const shared = policy.filter(([, status]) => status === "Preserved");
  nameCache.vars = { props: Object.fromEntries(shared.map(([name]) => ["$" + name, name])) };
}
