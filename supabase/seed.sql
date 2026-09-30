-- =====================================================================
-- Datos de ejemplo: 10 cuentas y un período activo.
-- Se puede ejecutar en el SQL Editor de Supabase después de las migraciones.
-- =====================================================================

insert into public.cuentas
  (numero_cuenta, titular, direccion, medidor, ultima_lectura, fecha_ultima_lectura, ultimo_consumo)
values
  ('10001', 'García, María Laura',     'Av. San Martín 1250',        'MED-458721', 15230, '2026-09-01', 32),
  ('10002', 'Fernández, Juan Carlos',  'Belgrano 845',               'MED-458722',  8741, '2026-09-01', 25),
  ('10003', 'López, Ana Sofía',        'Mitre 312, Dpto. 2',         'MED-458723', 22105, '2026-09-01', 41),
  ('10004', 'Martínez, Roberto',       'Rivadavia 2030',             'MED-458724',  3120, '2026-09-01', 18),
  ('10005', 'Rodríguez, Claudia',      'Sarmiento 77',               'MED-458725', 11980, '2026-09-01', 29),
  ('10006', 'Gómez, Luciano',          '25 de Mayo 1540',            'MED-458726',   560, '2026-09-01', 12),
  ('10007', 'Díaz, Patricia',          'Moreno 903',                 'MED-458727', 45012, '2026-09-01', 55),
  ('10008', 'Pérez, Sergio Daniel',    'Urquiza 418, Casa 4',        'MED-458728',  9999, '2026-09-01', 36),
  ('10009', 'Sosa, Graciela',          'Pasaje Los Aromos 15',       'MED-458729',     0, null,        null),
  ('10010', 'Romero, Hugo Alberto',    'Ruta 5 Km 12 (chacra)',      'MED-458730', 99880, '2026-09-01', 150)
on conflict (numero_cuenta) do nothing;

insert into public.periodos (nombre, fecha_inicio, activo)
select 'Octubre 2026', '2026-10-01', true
where not exists (select 1 from public.periodos where activo);
