import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const iconsDir = path.join(process.cwd(), 'public', 'assets', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

function buildSvg(scale = 1) {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14b8a6"/>
      <stop offset="1" stop-color="#0b6e63"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#g)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <g stroke="#ffffff" stroke-width="24" stroke-linecap="round" fill="none" opacity="0.96">
      <path d="M150 208V178a28 28 0 0 1 28-28h30"/>
      <path d="M362 208V178a28 28 0 0 0-28-28h-30"/>
      <path d="M150 304v30a28 28 0 0 0 28 28h30"/>
      <path d="M362 304v30a28 28 0 0 1-28 28h-30"/>
      <circle cx="256" cy="256" r="86"/>
      <circle cx="256" cy="256" r="58" opacity="0.35"/>
    </g>
    <circle cx="256" cy="256" r="26" fill="#ffffff"/>
    <path d="M332 332l44 44" stroke="#ffffff" stroke-width="24" stroke-linecap="round"/>
  </g>
</svg>`;
}

const iconFile = path.join(iconsDir, 'icon.svg');
fs.writeFileSync(iconFile, buildSvg(1));

const outputs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 1],
  ['favicon-32.png', 32, 1],
];

for (const [name, size, scale] of outputs) {
  await sharp(Buffer.from(buildSvg(scale))).resize(size, size).png().toFile(path.join(iconsDir, name));
  console.log(`generated ${name}`);
}
