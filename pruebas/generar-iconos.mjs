import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const DIR = '/mnt/project-files/app-tom-estados/public/icons';
// Los SVG de public/icons (icono.svg e icono-maskable.svg) se arman con el isotipo de public/logo/isotipo.svg.
const svg = fs.readFileSync(`${DIR}/icono.svg`, 'utf8');
const svgMaskable = fs.readFileSync(`${DIR}/icono-maskable.svg`, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
for (const [archivo, fuente, tam, fondo] of [
  ['icono-192.png', svg, 192, false], ['icono-512.png', svg, 512, false],
  ['icono-maskable-512.png', svgMaskable, 512, true], ['apple-touch-icon.png', svgMaskable, 180, true],
]) {
  await p.setViewportSize({ width: tam, height: tam });
  await p.setContent(`<html><body style="margin:0;background:transparent">${fuente.replace('<svg ', `<svg width="${tam}" height="${tam}" `)}</body></html>`);
  await p.screenshot({ path: `${DIR}/${archivo}`, omitBackground: !fondo, clip: { x: 0, y: 0, width: tam, height: tam } });
}
await b.close();
console.log('ok');
