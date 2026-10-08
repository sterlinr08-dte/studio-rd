-- 52_seguridad_ventas_cajas.sql — STUDIO RD (08-oct-2026). Arreglos de la auditoría de seguridad
-- (bitácoras 2026-10-08-0410-claude.md y la de esta entrega). NO APLICADA: espera autorización del dueño.
--
-- Problema (alto): la política pos_ventas_admin es FOR ALL y solo pide «tener un rol». La regla «solo el
-- administrador o el gerente anula» vivía únicamente en la pantalla; desde la API cualquier empleado podía
-- anular, cambiar montos o borrar una factura (y con ella sus líneas, por el ON DELETE CASCADE).
-- Problema (medio): igual con pos_cajas y pos_caja_movimientos: cualquier empleado podía borrar cajas
-- cerradas y movimientos de efectivo de otros.
--
-- Arreglo: candados en el servidor (disparadores BEFORE), con el mismo patrón de pos_abonos (migración 37):
--   · pos_ventas
--       - Vender sigue igual: INSERT (pos_registrar_venta_atomica) y los cambios normales del POS
--         (NCF la primera vez, inventario_aplicado, vencimiento del crédito, unir clientes, caja al borrar caja).
--       - Cambiar el estado (anular o desanular), los montos, los pagos, la fecha o un NCF ya puesto:
--         solo admin y gerente.
--       - Borrar: solo el administrador (Ajustes → «borrar datos de prueba»). Nadie más; se anula.
--   · pos_venta_items: cambiar líneas solo admin/gerente; borrarlas solo el administrador.
--   · pos_cajas: borrar solo el administrador.
--   · pos_caja_movimientos: cambiar o borrar solo si la caja es tuya y está abierta (la misma regla de
--     pos_eliminar_movimiento_mi_caja, que sigue funcionando); el administrador puede borrar.
--   El servidor sin usuario (Edge Functions con clave de servicio, SQL del dueño) y las RPC del fiado
--   (marca nx.fin_rpc) pasan, igual que en la 37 (nx_fin_privilegiado).
--
-- No borra políticas, no cambia permisos ni toca datos. Pantalla: 59.93 esconde «Anular» en el Historial a quien
-- no es admin/gerente (antes el botón salía y el servidor lo aceptaba).
-- Prueba: supabase/studio/pruebas/52_prueba_seguridad_ventas_cajas.sql (correrla DESPUÉS de este cuerpo, en la misma
-- transacción, como la 37). Reversa al final.

set local lock_timeout = '5s';

-- ── 1. Facturas: anular, montos y borrar ────────────────────────────────────────────────────────────────────────
create or replace function public.pos_ventas_aa_guard_directo() returns trigger
language plpgsql set search_path = public as $$
declare v_rol text;
begin
  if public.nx_fin_privilegiado() then return coalesce(new, old); end if;
  v_rol := public.mi_rol();
  if tg_op = 'DELETE' then
    if v_rol = 'admin' then return old; end if;
    raise exception 'VENTA_NO_SE_BORRA' using detail = 'Las facturas no se borran: se anulan (solo administrador o gerente)';
  end if;
  -- UPDATE
  if v_rol in ('admin', 'gerente') then return new; end if;
  if new.estado is distinct from old.estado then
    raise exception 'VENTA_ANULAR_SOLO_ADMIN' using detail = 'Solo el administrador o el gerente puede anular una factura';
  end if;
  if new.total is distinct from old.total or new.subtotal is distinct from old.subtotal
     or new.itbis is distinct from old.itbis or new.descuento is distinct from old.descuento
     or new.pagos is distinct from old.pagos or new.pagado_efectivo is distinct from old.pagado_efectivo
     or new.pagado_tarjeta is distinct from old.pagado_tarjeta or new.pagado_transferencia is distinct from old.pagado_transferencia
     or new.pagado_otro is distinct from old.pagado_otro or new.credito_monto is distinct from old.credito_monto
     or new.a_credito is distinct from old.a_credito or new.fecha is distinct from old.fecha
     or new.organizacion_id is distinct from old.organizacion_id
     or (old.ncf is not null and new.ncf is distinct from old.ncf) then
    raise exception 'VENTA_MONTOS_SOLO_ADMIN' using detail = 'Los montos, pagos, fecha y NCF de una factura guardada solo los cambia el administrador o el gerente';
  end if;
  return new;
end $$;
create or replace trigger pos_ventas_aa_guard_directo before update or delete on public.pos_ventas
  for each row execute function public.pos_ventas_aa_guard_directo();

-- ── 2. Líneas de la factura ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.pos_venta_items_aa_guard_directo() returns trigger
language plpgsql set search_path = public as $$
declare v_rol text;
begin
  if public.nx_fin_privilegiado() then return coalesce(new, old); end if;
  v_rol := public.mi_rol();
  if tg_op = 'DELETE' and v_rol = 'admin' then return old; end if;
  if tg_op = 'UPDATE' and v_rol in ('admin', 'gerente') then return new; end if;
  raise exception 'VENTA_LINEAS_SOLO_ADMIN' using detail = 'Las líneas de una factura guardada no se cambian ni se borran; se anula la factura';
end $$;
create or replace trigger pos_venta_items_aa_guard_directo before update or delete on public.pos_venta_items
  for each row execute function public.pos_venta_items_aa_guard_directo();

-- ── 3. Cajas: borrar solo el administrador ──────────────────────────────────────────────────────────────────────
create or replace function public.pos_cajas_aa_guard_borrar() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.nx_fin_privilegiado() or public.mi_rol() = 'admin' then return old; end if;
  raise exception 'CAJA_NO_SE_BORRA' using detail = 'Las cajas no se borran (solo el administrador)';
end $$;
create or replace trigger pos_cajas_aa_guard_borrar before delete on public.pos_cajas
  for each row execute function public.pos_cajas_aa_guard_borrar();

-- ── 4. Movimientos de caja: solo los de TU caja abierta ─────────────────────────────────────────────────────────
-- Mira la caja de ANTES (old.caja_id): así tampoco se puede sacar un movimiento de una caja cerrada pasándolo a otra.
create or replace function public.pos_caja_mov_aa_guard_directo() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.nx_fin_privilegiado() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and public.mi_rol() = 'admin' then return old; end if;
  if exists (select 1 from public.pos_cajas c
              where c.id = old.caja_id and c.usuario_id = auth.uid() and c.estado = 'abierta'
                and c.organizacion_id = public.mi_organizacion()) then
    return coalesce(new, old);
  end if;
  raise exception 'CAJA_MOVIMIENTO_NO_ELIMINABLE' using detail = 'Solo se cambian o borran movimientos de tu propia caja abierta';
end $$;
create or replace trigger pos_caja_mov_aa_guard_directo before update or delete on public.pos_caja_movimientos
  for each row execute function public.pos_caja_mov_aa_guard_directo();

-- Nota: no se quita EXECUTE a estas funciones (como en la 37): son de disparador y la API no puede llamarlas.

-- Ya existía y se mantiene: cualquier cambio a una venta atada a una caja AJENA o CERRADA lo frena
-- nx_validar_caja_propietario (CAJA_AJENA_O_CERRADA), también al administrador. No se cambia aquí; ver bitácora.

-- PENDIENTE (aparte, a mano, como dice la 37): quitar TRUNCATE a anon/authenticated en estas 4 tablas.
-- PostgREST no ofrece TRUNCATE, así que hoy no es un camino abierto; la herramienta lo trata como destructivo.

-- REVERSA (manual):
--   drop trigger pos_ventas_aa_guard_directo on public.pos_ventas;
--   drop trigger pos_venta_items_aa_guard_directo on public.pos_venta_items;
--   drop trigger pos_cajas_aa_guard_borrar on public.pos_cajas;
--   drop trigger pos_caja_mov_aa_guard_directo on public.pos_caja_movimientos;
--   drop function public.pos_ventas_aa_guard_directo(), public.pos_venta_items_aa_guard_directo(),
--                 public.pos_cajas_aa_guard_borrar(), public.pos_caja_mov_aa_guard_directo();
