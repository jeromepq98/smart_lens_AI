import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const vendor = path.join(root, 'public', 'assets', 'vendor');

function copy(relativeSource, relativeDestination) {
  const source = path.join(root, relativeSource);
  const destination = path.join(root, relativeDestination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

const files = [
  ['node_modules/bootstrap/dist/css/bootstrap.min.css', 'public/assets/vendor/bootstrap/bootstrap.min.css'],
  ['node_modules/bootstrap/dist/js/bootstrap.bundle.min.js', 'public/assets/vendor/bootstrap/bootstrap.bundle.min.js'],
  [
    'node_modules/bootstrap-icons/font/bootstrap-icons.css',
    'public/assets/vendor/bootstrap-icons/bootstrap-icons.css',
  ],
  [
    'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2',
    'public/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2',
  ],
  [
    'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff',
    'public/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff',
  ],
  ['node_modules/cropperjs/dist/cropper.min.css', 'public/assets/vendor/cropper/cropper.min.css'],
  ['node_modules/cropperjs/dist/cropper.min.js', 'public/assets/vendor/cropper/cropper.min.js'],
  ['node_modules/jspdf/dist/jspdf.umd.js', 'public/assets/vendor/jspdf/jspdf.umd.js'],
];

for (const [source, destination] of files) {
  copy(source, destination);
  console.log(`copied ${destination}`);
}

console.log(`Vendored ${files.length} files.`);
