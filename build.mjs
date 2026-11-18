// Builds one self-contained HTML file: dist/PianoStars-MR-v<version>.html (and dist/index.html).
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const version = process.argv[2] || '0.1.0';
const test = process.argv.includes('--test');
fs.mkdirSync('dist', { recursive: true });
const r = await esbuild.build({
  entryPoints: [test ? 'test/entry.js' : 'src/app.js'],
  bundle: true,
  format: 'iife',
  minify: !test,
  write: false,
  target: ['chrome110'],
  loader: { '.wjs': 'text', '.json': 'json' },
  legalComments: 'none',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8').replace('<script>/*APP*/</script>', () => '<script>' + js + '</script>');
if (test) {
  fs.writeFileSync('dist/test.html', html);
  console.log('dist/test.html', (html.length / 1024).toFixed(0) + ' KB');
} else {
  fs.writeFileSync(`dist/PianoStars-MR-v${version}.html`, html);
  fs.writeFileSync('dist/index.html', html);
  console.log(`dist/PianoStars-MR-v${version}.html`, (html.length / 1024).toFixed(0) + ' KB');
}
