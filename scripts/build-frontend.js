// Akio <3: Project source maintained by Akio Zaki Salomon.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { classicBindingPolicy, reserveClassicGlobals, topLevelNames } from './classic-browser-bindings.mjs';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import { deduplicateAssetScripts } from './html-transforms.mjs';
import { discoverJavaScript, auditJavaScript } from './frontend-coverage.mjs';
import { createPrivateMappings } from './private-semantic-maps.mjs';
import { createObfuscationProfile, obfuscationOptions, encodePrivateLiterals } from './frontend-obfuscation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
const dist = path.join(root, 'dist');
const profile = createObfuscationProfile();
const bundledSources = new Map();
const bindingAudit = [];
const generatedGlobals = new Set();
const privateMappings = process.argv.includes('--local-maps') ? await createPrivateMappings(profile) : null;
const sourceHash = source => createHash('sha256').update(source).digest('hex').slice(0, 16);
const filesIn = async directory => (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .sort();
const apiUrl = String(process.env.ACE_API_URL || process.env.ACE_API_URL_FALLBACK || '').replace(/\/$/, '');
if (!apiUrl) throw new Error('Missing ACE_API_URL and ACE_API_URL_FALLBACK. Set one before building the frontend.');
try {
  const parsed = new URL(apiUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
} catch {
  throw new Error('ACE_API_URL or ACE_API_URL_FALLBACK must be a valid HTTP(S) URL.');
}

async function emitScript(sources, { toplevel = false, module = false, asset, policy } = {}) {
  const files = Object.keys(sources);
  const options = obfuscationOptions(profile, files, toplevel);
  if (policy) reserveClassicGlobals(options.nameCache, policy);
  const minified = await minifyJs(sources, {
    module, compress: options.compress, mangle: options.mangle, nameCache: options.nameCache,
    format: { comments: false },
    sourceMap: privateMappings ? { includeSources: true } : false
  });
  const result = encodePrivateLiterals(minified, profile.encodeStrings && files.includes('frontend/js/supabase-auth.js'));
  if (!result.code) throw new Error("Could not minify " + Object.keys(sources).join(", "));
  if (!module) {
    const globals = topLevelNames(parse(result.code, { ecmaVersion: "latest" }));
    for (const name of globals) {
      if (!/^_0x[0-9a-z]+$/.test(name)) continue;
      if (generatedGlobals.has(name)) throw new Error("Generated browser global collides across classic scripts: " + name);
      generatedGlobals.add(name);
    }
    if (policy) {
      for (const [name, status, reason] of policy) {
        const generated = options.nameCache.vars?.props?.["$" + name];
        if (status === "Eligible" && globals.has(name)) throw new Error("Private browser binding stayed readable: " + name);
        const renamed = generated && generated !== name;
        bindingAudit.push([files[0], name, renamed ? generated : "—", renamed ? "Renamed" : status, reason]);
      }
    }
  }
  const hash = sourceHash(result.code);
  const target = asset || "assets/js/" + hash + ".js";
  await writeFile(path.join(dist, target), result.code);
  for (const file of files) bundledSources.set(file, target);
  await privateMappings?.record(target, hash, result.code, result.map, options.nameCache, result.strings);
  return target;
}

const browserModuleAssets = ["assets/whack-a-mole/scene.js", "assets/tour-devices/scene.js"];

async function buildScripts() {
  const output = new Map();
  const destination = path.join(dist, 'assets', 'js');
  await mkdir(destination, { recursive: true });
  const sourceDirectory = path.join(frontend, 'js');
  const supabaseSource = await readFile(path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), 'utf8');
  const supabaseTarget = `assets/js/${sourceHash(supabaseSource)}.js`;
  await writeFile(path.join(dist, supabaseTarget), supabaseSource);
  output.set('js/supabase.js', supabaseTarget);
  const xlsxSource = await readFile(path.join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), 'utf8');
  const xlsxTarget = `assets/js/${sourceHash(xlsxSource)}.js`;
  await writeFile(path.join(dist, xlsxTarget), xlsxSource);
  output.set('js/xlsx.js', xlsxTarget);
  // These two files only attach configuration/helpers to window and do not
  // execute page logic, so combining them preserves their current behavior
  // while reducing the number of deployed readable entry points.
  const coreTarget = await emitScript({
    "generated/ace-production-banner.js": `console.warn("%cSTOP!%c\\n\\nIf you did something we'll know :>%c ","color:#ff1f1f;font-size:64px;font-weight:900;line-height:1;text-shadow:0 2px 0 #7a0000;","color:#d7d7d7;font-size:16px;font-weight:700;line-height:1.5;","font-size:1px;display:block;width:200px;height:200px;padding:0;background:url('https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyam1la3FmeXkzdnV1dHFoZW1nbTV0OWhrNWc1ZXY3MnRjYTc3Y3NoMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/VbnUQpnihPSIgIXuZv/200w.gif') center/contain no-repeat;");`,
    "generated/api-config.js": `window.ACE_API_URL = window.ACE_API_URL || ${JSON.stringify(apiUrl)};`,
    "frontend/js/supabase-auth.js": await readFile(path.join(sourceDirectory, "supabase-auth.js"), "utf8")
  }, { toplevel: true });
  output.set('js/api-config.js', coreTarget);
  output.set('js/supabase-auth.js', coreTarget);

  const scripts = (await filesIn(sourceDirectory)).filter(file => file.endsWith(".js"));
  const consumers = await Promise.all([
    ...scripts.map(file => "frontend/js/" + file),
    ...(await filesIn(frontend)).filter(file => file.endsWith(".html")).map(file => "frontend/" + file),
    ...browserModuleAssets.map(asset => "frontend/" + asset)
  ].map(async file => [file, await readFile(path.join(root, file), "utf8")]));
  const sourceByFile = new Map(consumers);
  for (const file of scripts) {
    if (["api-config.js", "supabase-auth.js"].includes(file)) continue;
    const location = "frontend/js/" + file;
    const source = sourceByFile.get(location);
    const policy = classicBindingPolicy(location, source, consumers);
    const target = await emitScript({ [location]: source }, { toplevel: true, policy });
    output.set("js/" + file, target);
  }
  for (const asset of browserModuleAssets) {
    const source = await readFile(path.join(frontend, asset), "utf8");
    await emitScript({ ["frontend/" + asset]: source }, { module: true, asset });
  }
  return output;
}

async function buildStyles() {
  const output = new Map();
  const destination = path.join(dist, 'assets', 'css');
  await mkdir(destination, { recursive: true });
  for (const file of (await filesIn(path.join(frontend, 'css'))).filter(file => file.endsWith('.css'))) {
    const source = await readFile(path.join(frontend, 'css', file), 'utf8');
    const result = new CleanCSS({ level: 2, sourceMap: false }).minify(source);
    if (result.errors.length) throw new Error(`Could not minify css/${file}: ${result.errors.join('; ')}`);
    // Source styles live in /css while emitted styles live in /assets/css.
    // Preserve source-relative asset URLs during development, then adjust them
    // for the extra directory level in the production bundle.
    const styles = result.styles.replace(/url\((['"]?)\.\.\/assets\//g, 'url($1../../assets/');
    const target = `assets/css/${sourceHash(styles)}.css`;
    await writeFile(path.join(dist, target), styles);
    output.set(`css/${file}`, target);
  }
  return output;
}

async function buildPages(assetMap) {
  for (const file of (await filesIn(frontend)).filter(file => file.endsWith('.html'))) {
    const source = await readFile(path.join(frontend, file), 'utf8');
    const withProductionAssets = source.replace(/\b(src|href)=(['"])((?:\.\/|\/)?(?:js|css)\/[^?'"\s]+)(?:\?[^'"]*)?\2/gi, (match, attribute, quote, sourcePath) => {
      const normalized = sourcePath.replace(/^(?:\.\/|\/)/, '');
      const target = assetMap.get(normalized);
      return target ? `${attribute}=${quote}${sourcePath.startsWith('/') ? '/' : ''}${target}${quote}` : match;
    });
    const xlsxTarget = assetMap.get('js/xlsx.js');
    const appScriptTarget = assetMap.get('js/script.js');
    const withXlsxBundle = source.includes('js/script.js')
      ? withProductionAssets.replace(`<script src="${appScriptTarget}"></script>`, `<script src="${xlsxTarget}"></script><script src="${appScriptTarget}"></script>`)
      : withProductionAssets;
    const deduplicatedScripts = deduplicateAssetScripts(withXlsxBundle);
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
    if(file==='shift-planning.html'){await mkdir(path.join(dist,'shift-planning'),{recursive:true});await writeFile(path.join(dist,'shift-planning','index.html'),output);}
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(frontend, 'assets'), path.join(dist, 'assets'), {
  recursive: true,
  filter: source => !/(?:\.map|\.local\.[^/\\]+)$/i.test(source) && path.basename(source) !== '.semantic-local'
});
await mkdir(path.join(dist, 'vendor', 'three'), { recursive: true });
for (const file of ['three.module.min.js', 'three.core.min.js']) {
  await cp(path.join(root, 'node_modules', 'three', 'build', file), path.join(dist, 'vendor', 'three', file));
}
await cp(path.join(root, 'node_modules', 'three', 'LICENSE'), path.join(dist, 'vendor', 'three', 'LICENSE'));
for (const addon of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'environments/RoomEnvironment.js']) {
  const target = path.join(dist, 'vendor', 'three', addon);
  await mkdir(path.dirname(target), { recursive: true });
  const source = await readFile(path.join(root, 'node_modules', 'three', 'examples', 'jsm', addon), 'utf8');
  await writeFile(target, source.replace("from 'three';", "from '../three.module.min.js';"));
}
const assetMap = new Map([...(await buildScripts()), ...(await buildStyles())]);
await buildPages(assetMap);
await cp(path.join(frontend, '_headers'), path.join(dist, '_headers'));
const browserFiles = await discoverJavaScript(frontend, 'frontend/');
auditJavaScript(browserFiles, bundledSources);
if (privateMappings) await privateMappings.writeDocument(auditJavaScript(await discoverJavaScript(root), bundledSources), bindingAudit);
console.log(`Built ${dist} with ${assetMap.size} minified, hashed frontend assets and Cloudflare headers.`);
