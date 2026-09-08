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
  const sourceDirectory = path.join(root, 'js');
  // These two files only attach configuration/helpers to window and do not
  // execute page logic, so combining them preserves their current behavior
  // while reducing the number of deployed readable entry points.
  const coreSource = [
    await readFile(path.join(sourceDirectory, 'api-config.js'), 'utf8'),
    await readFile(path.join(sourceDirectory, 'supabase-auth.js'), 'utf8')
  ].join('\n');
  const core = await minifyJs(coreSource, {
    compress: { defaults: true, passes: 3 },
    mangle: { toplevel: true },
    format: { comments: false },
    sourceMap: false
  });
  if (!core.code) throw new Error('Could not minify the production core bundle');
  const coreCode = `console.warn("%cSTOP!%c\\n\\nIf you did something we'll know :>%c ","color:#ff1f1f;font-size:64px;font-weight:900;line-height:1;text-shadow:0 2px 0 #7a0000;","color:#d7d7d7;font-size:16px;font-weight:700;line-height:1.5;","font-size:1px;display:block;width:200px;height:200px;padding:0;background:url('https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyam1la3FmeXkzdnV1dHFoZW1nbTV0OWhrNWc1ZXY3MnRjYTc3Y3NoMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/VbnUQpnihPSIgIXuZv/200w.gif') center/contain no-repeat;");${core.code}`;
  const coreTarget = `assets/js/${sourceHash(coreCode)}.js`;
  await writeFile(path.join(dist, coreTarget), coreCode);
  output.set('js/api-config.js', coreTarget);
  output.set('js/supabase-auth.js', coreTarget);

  for (const file of (await filesIn(sourceDirectory)).filter(file => file.endsWith('.js') && !['api-config.js', 'supabase-auth.js'].includes(file))) {
    const source = await readFile(path.join(sourceDirectory, file), 'utf8');
    const result = await minifyJs(source, {
      compress: { defaults: true, passes: 3 },
      mangle: { toplevel: false },
      format: { comments: false },
      sourceMap: false
    });
    if (!result.code) throw new Error(`Could not minify js/${file}`);
    const target = `assets/js/${sourceHash(result.code)}.js`;
    await writeFile(path.join(dist, target), result.code);
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
    const emittedScripts = new Set();
    const deduplicatedScripts = withProductionAssets.replace(/<script\b([^>]*)\bsrc=(['"])([^'"]+)\2([^>]*)><\/script>/gi, (tag, before, quote, sourcePath, after) => {
      if (!sourcePath.startsWith('assets/js/') || !emittedScripts.has(sourcePath)) {
        emittedScripts.add(sourcePath);
        return tag;
      }
      return '';
    });
    const output = await minifyHtml(deduplicatedScripts, {
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
