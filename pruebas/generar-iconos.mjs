import { createRequire } from 'module';
import fs from 'fs';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const DIR = '/mnt/project-files/app-tom-estados/public/icons';
const svg = fs.readFileSync(`${DIR}/icono.svg`, 'utf8');
// Versión "maskable": fondo completo y el dibujo achicado al 80% (zona segura)
const svgMaskable = svg
  .replace('<rect width="512" height="512" rx="112" fill="url(#fondo)"/>', '<rect width="512" height="512" fill="url(#fondo)"/><g transform="translate(51.2 51.2) scale(0.8)">')
  .replace('</svg>', '</g></svg>');
fs.writeFileSync(`${DIR}/icono-maskable.svg`, svgMaskable);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
for (const [archivo, fuente, tam, fondo] of [
  ['medidor-192.png', svg, 192, false], ['medidor-512.png', svg, 512, false],
  ['medidor-maskable-512.png', svgMaskable, 512, true], ['medidor-apple-touch.png', svgMaskable, 180, true],
]) {
  await p.setViewportSize({ width: tam, height: tam });
  await p.setContent(`<html><body style="margin:0;background:transparent">${fuente.replace('<svg ', `<svg width="${tam}" height="${tam}" `)}</body></html>`);
  await p.screenshot({ path: `${DIR}/${archivo}`, omitBackground: !fondo, clip: { x: 0, y: 0, width: tam, height: tam } });
}
await b.close();
console.log('ok');
