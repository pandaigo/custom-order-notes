import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'custom-order-notes';
const outZip = join(root, `${name}.zip`);
const tmp = join(root, '_zip_tmp');

if (existsSync(outZip)) unlinkSync(outZip);

const include = [
  'manifest.json',
  'background.js',
  'ExtPay.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'welcome.html',
  'lib/order-utils.js',
  'lib/csv-utils.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

if (existsSync(tmp)) execSync(`cmd /c "rmdir /s /q ${tmp}"`, { stdio: 'ignore' });

for (const file of include) {
  const src = join(root, file);
  if (!existsSync(src)) {
    console.error(`MISSING: ${file}`);
    process.exit(1);
  }
  const dest = join(tmp, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

execSync(
  `powershell -Command "Compress-Archive -Path '${join(tmp, '*')}' -DestinationPath '${outZip}' -Force"`,
  { stdio: 'inherit' }
);

execSync(`cmd /c "rmdir /s /q ${tmp}"`, { stdio: 'ignore' });

console.log(`\nCreated: ${outZip}`);
