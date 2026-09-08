import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const sourceHash = source => createHash('sha256').update(source).digest('hex').slice(0, 16);
const filesIn = async directory => (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => entry.name);

async function buildScripts() {
  const output = new Map();
  const destination = path.join(dist, 'assets', 'js');
  await mkdir(destination, { recursive: true });
  for (const file of (await filesIn(path.join(root, 'js'))).filter(file => file.endsWith('.js'))) {
    const source = await readFile(path.join(root, 'js', file), 'utf8');
    const result = await minifyJs(source, {
      compress: { defaults: true, passes: 2 },
      mangle: { toplevel: false },
      format: { comments: false },
      sourceMap: false
    });
    if (!result.code) throw new Error(`Could not minify js/${file}`);
    const productionCode = file === 'api-config.js'
      ? `console.warn("STOP!\\n\\nIf you did something we'll know :>");${result.code}`
      : result.code;
    const target = `assets/js/${sourceHash(productionCode)}.js`;
    await writeFile(path.join(dist, target), productionCode);
    output.set(`js/${file}`, target);
  }
  return output;
}

async function buildStyles() {
  const output = new Map();
  const destination = path.join(dist, 'assets', 'css');
  await mkdir(destination, { recursive: true });
  for (const file of (await filesIn(path.join(root, 'css'))).filter(file => file.endsWith('.css'))) {
    const source = await readFile(path.join(root, 'css', file), 'utf8');
    const result = new CleanCSS({ level: 2, sourceMap: false }).minify(source);
    if (result.errors.length) throw new Error(`Could not minify css/${file}: ${result.errors.join('; ')}`);
    const target = `assets/css/${sourceHash(result.styles)}.css`;
    await writeFile(path.join(dist, target), result.styles);
    output.set(`css/${file}`, target);
  }
  return output;
}

async function buildPages(assetMap) {
  for (const file of (await filesIn(root)).filter(file => file.endsWith('.html'))) {
    const source = await readFile(path.join(root, file), 'utf8');
    const withProductionAssets = source.replace(/\b(src|href)=(['"])((?:\.\/)?(?:js|css)\/[^?'"\s]+)(?:\?[^'"]*)?\2/gi, (match, attribute, quote, sourcePath) => {
      const normalized = sourcePath.replace(/^\.\//, '');
      const target = assetMap.get(normalized);
      return target ? `${attribute}=${quote}${target}${quote}` : match;
    });
    const output = await minifyHtml(withProductionAssets, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      removeRedundantAttributes: false,
      removeOptionalTags: false,
      removeAttributeQuotes: false,
      minifyCSS: false,
      minifyJS: false,
      keepClosingSlash: true
    });
    await writeFile(path.join(dist, file), output);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
const assetMap = new Map([...(await buildScripts()), ...(await buildStyles())]);
await buildPages(assetMap);
await cp(path.join(root, 'vercel.json'), path.join(dist, 'vercel.json'));
console.log(`Built ${dist} with ${assetMap.size} minified, hashed frontend assets.`);
