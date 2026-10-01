import { parse, serialize } from 'parse5';

// Operate on parsed elements so quoted attributes and malformed markup cannot
// turn a partial string deletion into a new executable tag.
function transform(html, remove) {
  const document = parse(html);
  const visit = parent => {
    parent.childNodes = (parent.childNodes || []).filter(node => !remove(node));
    for (const node of parent.childNodes) {
      visit(node);
      if (node.content) visit(node.content);
    }
  };
  visit(document);
  return serialize(document);
}

export const removeScripts = html => transform(html, node => node.tagName === 'script');

export function deduplicateAssetScripts(html) {
  const emitted = new Set();
  return transform(html, node => {
    if (node.tagName !== 'script') return false;
    const source = node.attrs.find(attribute => attribute.name === 'src')?.value;
    if (!source?.startsWith('assets/js/')) return false;
    if (emitted.has(source)) return true;
    emitted.add(source);
    return false;
  });
}
