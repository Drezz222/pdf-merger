import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const workspace = read('workspace.js');
const context = vm.createContext({
  pdfjsLib: { GlobalWorkerOptions: {} },
  PDFLib: {},
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  window: {},
  localStorage: { getItem() { return null; }, setItem() {} },
  location: { href: 'https://example.test/tool.html', search: '' },
  history: { replaceState() {} },
  URL,
  console,
  setTimeout,
  clearTimeout,
  Image: class {},
  File: class {},
  Blob: class {},
  Uint8Array,
  Map,
  Set,
});
vm.runInContext(workspace, context, { filename: 'workspace.js' });

const parse = expression => Array.from(vm.runInContext(expression, context));
assert.deepEqual(parse("parseRange('1-3,5',7)"), [1, 2, 3, 5]);
assert.deepEqual(parse("parseRange('5-3',7)"), [5, 4, 3]);
assert.deepEqual(parse("parseRange('5,2,4',7)"), [5, 2, 4]);
assert.equal(vm.runInContext("validateRange('1-3,5',7)", context), '');
assert.match(vm.runInContext("validateRange('0',7)", context), /between 1 and 7/);
assert.match(vm.runInContext("validateRange('abc',7)", context), /not a valid/);

const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith('.html') && !file.startsWith('google'));
const stableHost = 'https://pdf-merger-sepia.vercel.app';
for (const file of htmlFiles) {
  const html = read(file);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
  assert.ok(canonical?.startsWith(stableHost), `${file} must have a stable canonical`);
  assert.doesNotMatch(html, /pdf-merger-[a-z0-9]+-drezz222s-projects\.vercel\.app/i, `${file} must not use an immutable preview URL`);
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
    if (href === '/') continue;
    const target = path.join(root, href.replace(/^\//, ''));
    assert.ok(fs.existsSync(target), `${file} links to missing ${href}`);
  }
}

assert.match(read('tool.html'), /noindex,follow/i);
for (const file of ['index.html', 'merge-pdf.html', 'split-pdf.html', 'sign-pdf.html', 'combine-pdf-and-images.html']) {
  assert.match(read(file), /index,follow/i, `${file} should be indexable`);
}
const sitemap = read('sitemap.xml');
assert.match(sitemap, /combine-pdf-and-images\.html/);
assert.doesNotMatch(sitemap, /tool\.html|privacy\.html/);
assert.match(read('robots.txt'), /Disallow: \/api\//);
assert.doesNotThrow(() => JSON.parse(read('vercel.json')));
assert.match(workspace, /isEvalSupported:false/);
assert.doesNotMatch(read('tool.html'), /TIFF|BMP/);
const proxy = read('api/proxy.js');
assert.match(proxy, /MAX_BYTES/);
assert.match(proxy, /isPrivateAddress/);
assert.doesNotMatch(proxy, /Access-Control-Allow-Origin/);

console.log(`Smoke checks passed: ranges, ${htmlFiles.length} HTML files, links, SEO, and security invariants.`);
