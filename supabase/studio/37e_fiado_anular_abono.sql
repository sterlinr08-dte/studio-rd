-- 37e (APLICADA 04-oct-2026): «eliminar abono» de fiado = ANULAR con reverso (reemplaza la 37d, que borraba y nunca se
-- pudo aplicar porque la herramienta pedía confirmación por la palabra «delete» y vencía a los 60 s).
-- Solo admin/gerente. Inserta un abono negativo por el mismo monto (anula_id → el original), con su asiento inverso
-- (débito 1103, crédito 1101/1102). El saldo del cliente vuelve a como estaba y queda la traza. No borra nada.
alter table public.pos_abonos add column if not exists anula_id uuid references public.pos_abonos(id);
create unique index if not exists pos_abonos_anula_id_uq on public.pos_abonos (anula_id) where anula_id is not null;

create or replace function public.pos_fiado_eliminar_abono(p_abono_id uuid) returns jsonb
language plpgsql set search_path = public set timezone = 'America/Santo_Domingo' as $$
declare v_org uuid := mi_organizacion(); v_ab record; v_cli record; v_efe boolean; v_caja uuid; v_id uuid; v_asiento uuid; v_num text; v_quien text;
begin
  perform set_config('nx.fin_rpc', '1', true);
  if mi_rol() not in ('admin','gerente') then raise exception 'FIADO_ELIMINAR_SOLO_ADMIN'; end if;
  select * into v_ab from public.pos_abonos where id = p_abono_id and organizacion_id = v_org for update;
  if v_ab.id is null then raise exception 'FIADO_ABONO_NO_ENCONTRADO'; end if;
  if v_ab.monto <= 0 or v_ab.anula_id is not null then raise exception 'FIADO_ABONO_ES_ANULACION'; end if;
  if exists (select 1 from public.pos_abonos where anula_id = v_ab.id) then raise exception 'FIADO_ABONO_YA_ANULADO'; end if;
  select id, nombre into v_cli from public.pos_clientes where id = v_ab.cliente_id and organizacion_id = v_org;
  v_efe := lower(coalesce(nullif(trim(v_ab.metodo), ''), 'efectivo')) = 'efectivo';
  if v_efe then
    v_caja := public.pos_fin_caja_abierta(true);
    if v_caja is null then raise exception 'FIADO_CAJA_CERRADA'; end if;
  end if;
  select us.nom into v_quien from public.profiles pr join public.usuarios_sistema us on us.id = pr.usuario_sistema_id where pr.id = auth.uid() limit 1;
  v_num := 'ANUL-' || coalesce(v_ab.numero, substr(v_ab.id::text, 1, 8));
  insert into public.pos_abonos (organizacion_id, cliente_id, venta_id, monto, fecha, metodo, nota, numero, caja_id, created_by_name, anula_id)
  values (v_org, v_ab.cliente_id, v_ab.venta_id, -v_ab.monto, current_date, v_ab.metodo,
          'Anulación del abono ' || coalesce(v_ab.numero, '') || ' del ' || to_char(v_ab.fecha, 'DD/MM/YYYY'), v_num, v_caja, v_quien, v_ab.id)
  returning id into v_id;
  perform public.pos_asegurar_cuentas_operativas(v_org);
  insert into public.pos_asientos (organizacion_id, fecha, concepto, referencia, tipo, origen_id, numero)
  values (v_org, current_date, 'Anulación de abono ' || coalesce(v_cli.nombre, ''), v_num, 'cobro', v_id, 'AB-' || v_num)
  returning id into v_asiento;
  insert into public.pos_asiento_lineas (organizacion_id, asiento_id, cuenta_id, cuenta_codigo, cuenta_nombre, descripcion, debito, credito)
  select v_org, v_asiento, id, codigo, nombre, 'Restituye cuenta por cobrar (abono anulado)', v_ab.monto, 0
    from public.pos_cuentas where organizacion_id = v_org and codigo = '1103';
  insert into public.pos_asiento_lineas (organizacion_id, asiento_id, cuenta_id, cuenta_codigo, cuenta_nombre, descripcion, debito, credito)
  select v_org, v_asiento, id, codigo, nombre, case when v_efe then 'Salida de efectivo (abono anulado)' else 'Reversa medio electrónico (abono anulado)' end, 0, v_ab.monto
    from public.pos_cuentas where organizacion_id = v_org and codigo = case when v_efe then '1101' else '1102' end;
  if (select count(*) from public.pos_asiento_lineas where asiento_id = v_asiento) <> 2 then raise exception 'FIADO_CUENTAS_CONTABLES_FALTAN'; end if;
  perform set_config('nx.fin_rpc', '', true);
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_num, 'monto', v_ab.monto);
end $$;
revoke all on function public.pos_fiado_eliminar_abono(uuid) from public, anon;
grant execute on function public.pos_fiado_eliminar_abono(uuid) to authenticated, service_role;
