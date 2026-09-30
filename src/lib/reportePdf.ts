import { supabase } from './supabase';
import { traerTodo } from './consultas';
import { fmtFecha, fmtFechaHora, fmtNumero } from './formato';
import type { Cuenta, Periodo, VConflicto, VLectura } from '@/types/database';

// Reporte de fin de período en PDF: resumen, avance por ruta y por operador,
// alertas, conflictos y cuentas sin leer. Se arma en el navegador (jsPDF).

const MOTIVOS: Record<string, string> = {
  ya_leida: 'Cuenta ya leída',
  periodo_cerrado: 'Período cerrado',
  reemplazada: 'Reemplazada',
};

function tipoAlerta(l: VLectura): string {
  return [
    l.alerta_menor_anterior && 'Menor a la anterior',
    l.alerta_consumo_anomalo && 'Consumo anómalo',
    l.alerta_sin_lectura && `Sin lectura${l.observacion ? `: ${l.observacion}` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export async function descargarReportePeriodo(periodo: Periodo): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, lecturas, conflictos, pendientes] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    traerTodo<VLectura>((d, h) => supabase.from('v_lecturas').select('*').eq('periodo_id', periodo.id).order('numero_cuenta').range(d, h)),
    traerTodo<VConflicto>((d, h) => supabase.from('v_conflictos').select('*').eq('periodo_id', periodo.id).order('created_at').range(d, h)),
    periodo.activo
      ? traerTodo<Cuenta>((d, h) => supabase.rpc('cuentas_pendientes', { p_periodo_id: periodo.id }).order('numero_cuenta').range(d, h))
      : Promise.resolve([] as Cuenta[]),
  ]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ancho = doc.internal.pageSize.getWidth();
  const color: [number, number, number] = [3, 105, 161];
  let y = 16;

  doc.setFont('helvetica', 'bold').setFontSize(16).text(`Reporte de lecturas · ${periodo.nombre}`, 14, y);
  y += 6;
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9)
    .setTextColor(100)
    .text(
      `COOPSAR · Período ${periodo.activo ? 'abierto' : 'cerrado'} · desde el ${fmtFecha(periodo.fecha_inicio)}` +
        (periodo.fecha_cierre ? ` hasta el ${fmtFecha(periodo.fecha_cierre)}` : '') +
        ` · generado el ${fmtFechaHora(new Date().toISOString())}`,
      14,
      y,
    )
    .setTextColor(0);
  y += 6;

  const alertas = lecturas.filter((l) => l.alerta_menor_anterior || l.alerta_consumo_anomalo || l.alerta_sin_lectura);
  const sinLectura = lecturas.filter((l) => l.sin_lectura).length;
  const consumoTotal = lecturas.reduce((s, l) => s + (l.consumo !== null && l.consumo > 0 ? Number(l.consumo) : 0), 0);
  const conflictosPendientes = conflictos.filter((c) => !c.resuelto).length;

  const estilo = { fontSize: 8, cellPadding: 1.5 };
  const cabecera = { fillColor: color, textColor: 255, fontStyle: 'bold' as const };
  const titulo = (texto: string) => {
    const ultimo = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    y = (ultimo ?? y) + 9;
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('helvetica', 'bold').setFontSize(12).text(texto, 14, y);
    y += 2;
  };

  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 2 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    body: [
      ['Cuentas leídas', fmtNumero(lecturas.length)],
      ...(periodo.activo ? [['Cuentas pendientes', fmtNumero(pendientes.length)]] : []),
      ['Sin lectura', fmtNumero(sinLectura)],
      ['Lecturas con alerta', fmtNumero(alertas.length)],
      ['Conflictos pendientes / resueltos', `${fmtNumero(conflictosPendientes)} / ${fmtNumero(conflictos.length - conflictosPendientes)}`],
      ['Consumo total', fmtNumero(consumoTotal)],
    ],
    tableWidth: 110,
  });

  // ---- Por ruta
  const rutas = new Map<string, { leidas: number; sin: number; alertas: number; consumo: number; pendientes: number }>();
  const fila = (r: string) => {
    if (!rutas.has(r)) rutas.set(r, { leidas: 0, sin: 0, alertas: 0, consumo: 0, pendientes: 0 });
    return rutas.get(r)!;
  };
  for (const l of lecturas) {
    const f = fila(l.ruta);
    f.leidas++;
    if (l.sin_lectura) f.sin++;
    if (l.alerta_menor_anterior || l.alerta_consumo_anomalo || l.alerta_sin_lectura) f.alertas++;
    if (l.consumo !== null && l.consumo > 0) f.consumo += Number(l.consumo);
  }
  for (const c of pendientes) fila(c.ruta).pendientes++;
  titulo('Por ruta');
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: estilo,
    headStyles: cabecera,
    head: [['Ruta', 'Leídas', ...(periodo.activo ? ['Pendientes'] : []), 'Sin lectura', 'Con alerta', 'Consumo']],
    body: [...rutas.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
      .map(([r, f]) => [r || 'Sin ruta', fmtNumero(f.leidas), ...(periodo.activo ? [fmtNumero(f.pendientes)] : []), fmtNumero(f.sin), fmtNumero(f.alertas), fmtNumero(f.consumo)]),
  });

  // ---- Por operador
  const operadores = new Map<string, { lecturas: number; sin: number; alertas: number; primera: string; ultima: string }>();
  for (const l of lecturas) {
    const n = l.operador_nombre ?? 'Sin nombre';
    const f = operadores.get(n) ?? { lecturas: 0, sin: 0, alertas: 0, primera: l.fecha_lectura, ultima: l.fecha_lectura };
    f.lecturas++;
    if (l.sin_lectura) f.sin++;
    if (l.alerta_menor_anterior || l.alerta_consumo_anomalo || l.alerta_sin_lectura) f.alertas++;
    if (l.fecha_lectura < f.primera) f.primera = l.fecha_lectura;
    if (l.fecha_lectura > f.ultima) f.ultima = l.fecha_lectura;
    operadores.set(n, f);
  }
  titulo('Por operador');
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: estilo,
    headStyles: cabecera,
    head: [['Operador', 'Lecturas', 'Sin lectura', 'Con alerta', 'Primera', 'Última']],
    body: [...operadores.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([n, f]) => [n, fmtNumero(f.lecturas), fmtNumero(f.sin), fmtNumero(f.alertas), fmtFechaHora(f.primera), fmtFechaHora(f.ultima)]),
  });

  // ---- Alertas
  titulo(`Alertas (${alertas.length})`);
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: estilo,
    headStyles: cabecera,
    head: [['Cuenta', 'Titular', 'Ruta', 'Operador', 'Anterior', 'Actual', 'Consumo', 'Alerta', 'Fecha y hora']],
    body: alertas.length
      ? alertas.map((l) => [
          l.numero_cuenta,
          l.titular,
          l.ruta,
          l.operador_nombre ?? '',
          fmtNumero(l.lectura_anterior),
          l.sin_lectura ? '—' : fmtNumero(l.lectura_actual),
          fmtNumero(l.consumo),
          tipoAlerta(l),
          fmtFechaHora(l.fecha_lectura),
        ])
      : [['Sin alertas en este período.', '', '', '', '', '', '', '', '']],
  });

  // ---- Conflictos
  titulo(`Conflictos (${conflictos.length})`);
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    styles: estilo,
    headStyles: cabecera,
    head: [['Cuenta', 'Titular', 'Operador', 'Lectura', 'Motivo', 'Estado', 'Fecha y hora']],
    body: conflictos.length
      ? conflictos.map((c) => [
          c.numero_cuenta,
          c.titular,
          c.operador_nombre ?? '',
          c.sin_lectura ? 'Sin lectura' : fmtNumero(c.lectura_actual),
          MOTIVOS[c.motivo] ?? c.motivo,
          !c.resuelto ? 'Pendiente' : c.resolucion === 'reemplaza' ? `Quedó esta (${fmtFechaHora(c.resuelto_at)})` : `Descartada (${fmtFechaHora(c.resuelto_at)})`,
          fmtFechaHora(c.fecha_lectura),
        ])
      : [['Sin conflictos en este período.', '', '', '', '', '', '']],
  });

  // ---- Pendientes
  if (periodo.activo && pendientes.length) {
    titulo(`Cuentas sin leer (${pendientes.length})`);
    autoTable(doc, {
      startY: y,
      theme: 'striped',
      styles: estilo,
      headStyles: cabecera,
      head: [['Cuenta', 'Titular', 'Dirección', 'Medidor', 'Ruta']],
      body: pendientes.map((c) => [c.numero_cuenta, c.titular, c.direccion, c.medidor, c.ruta]),
    });
  }

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(8)
      .setTextColor(120)
      .text(`${periodo.nombre} · página ${i} de ${paginas}`, ancho - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }

  doc.save(`reporte_${periodo.nombre.toLowerCase().replace(/\s+/g, '_')}.pdf`);
}
