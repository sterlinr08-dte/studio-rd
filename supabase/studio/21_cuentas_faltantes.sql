-- STUDIO · 21 · Cuentas contables que las automatizaciones usan y no existían (auditoría 2026-09-23). APLICADO.
-- El plan de STUDIO solo tenía las 12 cuentas de pos_asegurar_cuentas_operativas. Sin estas, el motor
-- guardarAsientoBalanceado() descartaba (Debe ≠ Haber) los asientos de: gastos (Contabilidad → Registrar gasto),
-- salidas de caja y descuadre de cierre (6104), nómina (6101 / 2103 / 2104). Nombres y tipos = PLAN_BASE del POS.
-- 2102 «ITBIS por pagar» NO se crea a propósito: en STUDIO el servidor registra la venta completa en 4101.
insert into public.pos_cuentas (organizacion_id, codigo, nombre, tipo, naturaleza, activo) values
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '2103', 'Sueldos por pagar', 'pasivo', 'acreedora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '2104', 'Retenciones por pagar (TSS/ISR)', 'pasivo', 'acreedora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '3101', 'Capital', 'capital', 'acreedora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '3102', 'Resultados acumulados', 'capital', 'acreedora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '6101', 'Sueldos y salarios', 'gasto', 'deudora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '6102', 'Alquiler', 'gasto', 'deudora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '6103', 'Servicios (luz, agua, internet)', 'gasto', 'deudora', true),
  ('e404d1c4-24c5-4e17-88f6-84bef09d6d19', '6104', 'Gastos varios', 'gasto', 'deudora', true)
on conflict (organizacion_id, codigo) do nothing;
