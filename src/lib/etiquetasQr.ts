import type { Cuenta } from '@/types/database';

// Etiquetas autoadhesivas con código QR para pegar en cada medidor.
// Hoja A4 de 3 × 8 (70 × 37 mm). El QR dice "CUENTA:<número>" y el lector
// de la app lo reconoce; también sirve el código de barras que ya traiga el
// medidor, si coincide con el número de medidor cargado.

const COLUMNAS = 3;
const FILAS = 8;
const ANCHO = 70;
const ALTO = 37;

type CuentaEtiqueta = Pick<Cuenta, 'numero_cuenta' | 'titular' | 'direccion' | 'medidor' | 'ruta'>;

export async function descargarEtiquetasQr(cuentas: CuentaEtiqueta[], nombre = 'etiquetas_qr'): Promise<void> {
  const [{ jsPDF }, QRCode] = await Promise.all([import('jspdf'), import('qrcode')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margenX = (doc.internal.pageSize.getWidth() - COLUMNAS * ANCHO) / 2;
  const margenY = (doc.internal.pageSize.getHeight() - FILAS * ALTO) / 2;
  const recortar = (texto: string, ancho: number) => (doc.splitTextToSize(texto, ancho) as string[])[0] ?? '';

  for (let i = 0; i < cuentas.length; i++) {
    const c = cuentas[i];
    const lugar = i % (COLUMNAS * FILAS);
    if (i > 0 && lugar === 0) doc.addPage();
    const x = margenX + (lugar % COLUMNAS) * ANCHO;
    const y = margenY + Math.floor(lugar / COLUMNAS) * ALTO;

    const qr = await QRCode.toDataURL(`CUENTA:${c.numero_cuenta}`, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
    doc.addImage(qr, 'PNG', x + 3, y + 4, 29, 29);

    const tx = x + 34;
    const ancho = ANCHO - 36;
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0).text(recortar(c.numero_cuenta, ancho), tx, y + 10);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text(recortar(c.titular, ancho), tx, y + 15);
    doc.text(recortar(c.direccion, ancho), tx, y + 19);
    doc.text(recortar(`Medidor ${c.medidor}`, ancho), tx, y + 23);
    if (c.ruta) doc.text(recortar(c.ruta, ancho), tx, y + 27);
    doc.setFontSize(6).setTextColor(120).text('COOPSAR', tx, y + 32).setTextColor(0);
  }

  doc.save(`${nombre}.pdf`);
}
