-- STUDIO · 22 · Asientos de los 574 cobros migrados (pos_abonos) — autorizado por el dueño 2026-09-23. APLICADO.
-- Idempotente: solo abonos sin asiento (origen_id). Cada asiento: 2 líneas cuadradas.
--   Efectivo (117)              → Debe 1101 Caja   / Haber 1103 CxC            tipo 'cobro'
--   Transferencia (280)         → Debe 1102 Banco  / Haber 1103 CxC            tipo 'cobro'
--   Ajuste de migración (78)    → Debe 1102 Banco  / Haber 1103 (negativos: al revés)  tipo 'cobro'
--   Nota de crédito (47) y Otro (52) → Debe 4104 Rebajas y ajustes autorizados a clientes / Haber 1103  tipo 'rebaja_cliente'
-- 4104 se crea como ingreso de naturaleza acreedora: su saldo deudor RESTA en el Estado de Resultados.
-- Resultado verificado: 0 cobros sin asiento, 0 asientos descuadrados, 1103 contable = CxC de la app = 30,201,813.
insert into pos_cuentas (organizacion_id, codigo, nombre, tipo, naturaleza, activo)
  values ('e404d1c4-24c5-4e17-88f6-84bef09d6d19','4104','Rebajas y ajustes autorizados a clientes','ingreso','acreedora',true)
  on conflict (organizacion_id, codigo) do nothing;
-- (bloques DO ejecutados: ver bitácora 2026-09-23-1100-claude.md para el SQL exacto de las dos tandas)
