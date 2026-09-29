-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 36 · Financiamiento: el VENDEDOR también cobra cuotas                 *** NO APLICADA ***
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ESTADO: NO APLICADA en ninguna base. Pendiente de que el dueño autorice la publicación (sería con 59.70).
-- Decisión del dueño (29-sep-2026): el rol «vendedor» puede registrar cobros de cuotas.
--
-- Qué cambia (solo la lista de roles; nada más):
--   1. Trigger pos_fin_validar_pago_insert(): la fila de pago (tipo 'pago') acepta también 'vendedor'.
--      La REVERSA sigue siendo solo admin/gerente (misma función, rama tipo='reversa', sin cambios).
--   2. Política RLS pos_fin_pagos_insert: INSERT también para 'vendedor'.
-- Lo que NO cambia:
--   · pos_fin_registrar_pago_v2 (no tiene lista de roles: se apoya en el trigger y la RLS).
--   · Efectivo sigue exigiendo caja abierta DEL MISMO USUARIO (pos_fin_caja_abierta → FIN_CAJA_CERRADA):
--     un vendedor solo cobra en efectivo si tiene su propia caja abierta (pos_abrir_mi_caja lo permite a
--     cualquier rol; el módulo Caja del POS se le da en Permisos por rol). Transferencia y tarjeta no
--     necesitan caja.
--   · pos_fin_reversar_pago y pos_fin_condonar_mora: solo admin/gerente.
--   · Recibo y estado de cuenta: solo lectura (pos_fin_pagos_select ya es para cualquier rol).
--
-- Objetos EN VIVO que se reemplazan (leídos el 29-sep-2026 en edbknlkjnlfmkkiizdbe, solo lectura):
--   · public.pos_fin_validar_pago_insert(): pg_get_functiondef md5 d8381d587f3e19237e9232b5d3d22ecb
--     (5087 caracteres; prosrc md5 494bbe97316737db5e37bff773fd113f, 4935). Comparado línea por línea con
--     14_financiamiento_v2.sql §8: idéntico salvo 3 líneas de comentario que el repo tiene y la base no
--     (la base guarda la versión sin comentarios). La copia de abajo parte del texto del repo.
--   · policy pos_fin_pagos_insert on public.pos_fin_pagos: with check
--     ((mi_rol() = ANY (ARRAY['admin','gerente','cajero'])) AND (organizacion_id = mi_organizacion()))
--     = 08_rls.sql:131.
--   · Datos al leer: 0 pos_fin_pagos, 0 pos_financiamientos (no hay nada que migrar).
-- Reversa: volver a correr 14 §8 y la política de 08_rls.sql:131.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- 1) Trigger de validación del pago (antes 14 §8) ------------------------------------------------------
create or replace function public.pos_fin_validar_pago_insert()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_org uuid:=mi_organizacion(); v_rol text:=mi_rol(); v_estado text; v_plan uuid; v_cuota_monto numeric; v_capital numeric; v_interes numeric;
  v_venc date; v_mora_generada numeric:=0; v_exenta boolean:=false; v_v2 boolean:=false;
  v_principal_pagado numeric:=0; v_interes_pagado numeric:=0; v_mora_pagada numeric:=0; v_mora_total numeric:=0; v_mora_calc numeric:=0;
  v_cap_pend numeric:=0; v_int_pend numeric:=0; v_mora_pend numeric:=0; v_resto numeric:=0; v_orig public.pos_fin_pagos%rowtype;
begin
  -- 36 (decisión del dueño 29-sep-2026): el vendedor también registra cobros de cuotas.
  if v_rol not in ('admin','gerente','cajero','vendedor') then raise exception 'FIN_SIN_PERMISO'; end if;
  if v_org is null then raise exception 'FIN_ORG_REQUERIDA'; end if;
  if new.organizacion_id is null then new.organizacion_id:=v_org; end if;
  if new.organizacion_id<>v_org then raise exception 'FIN_ORG_INVALIDA'; end if;
  if coalesce(new.monto,0)<=0 then raise exception 'FIN_MONTO_INVALIDO'; end if;

  select f.estado, f.plan_id, c.monto, coalesce(c.capital,c.monto), coalesce(c.interes,0), c.fecha_venc, coalesce(c.mora_generada,0), coalesce(c.mora_exenta,false)
    into v_estado, v_plan, v_cuota_monto, v_capital, v_interes, v_venc, v_mora_generada, v_exenta
  from public.pos_financiamientos f join public.pos_fin_cuotas c on c.financiamiento_id=f.id and c.organizacion_id=f.organizacion_id
  where f.id=new.financiamiento_id and c.id=new.cuota_id and f.organizacion_id=v_org for update of f,c;
  if v_estado is null then raise exception 'FIN_CUOTA_INVALIDA'; end if;
  select coalesce(financiamiento_v2,false) into v_v2 from public.pos_config where organizacion_id=v_org limit 1;
  v_v2 := coalesce(v_v2,false) or v_plan is not null;

  if new.tipo='pago' then
    if v_estado<>'activo' then raise exception 'FIN_NO_ACTIVO'; end if;
    if new.reversa_de_id is not null then raise exception 'FIN_PAGO_NO_PUEDE_REFERIR_REVERSA'; end if;
    select coalesce(sum(case when tipo='pago' then monto_principal when tipo='reversa' then -monto_principal else 0 end),0),
           coalesce(sum(case when tipo='pago' then coalesce(monto_interes,0) when tipo='reversa' then -coalesce(monto_interes,0) else 0 end),0),
           coalesce(sum(case when tipo='pago' then monto_mora when tipo='reversa' then -monto_mora else 0 end),0)
      into v_principal_pagado, v_interes_pagado, v_mora_pagada from public.pos_fin_pagos where cuota_id=new.cuota_id and organizacion_id=v_org;

    -- La mora se fija (persiste) la primera vez que se paga estando vencida; luego no crece.
    if not v_exenta and v_mora_generada<=0 then
      v_mora_calc := public.pos_fin_mora_calculada(new.cuota_id, coalesce(new.fecha,current_date));
      if v_mora_calc>0 then
        v_mora_generada := v_mora_calc;
        perform set_config('nx.fin_recalc','1',true);
        update public.pos_fin_cuotas set mora_generada=v_mora_generada where id=new.cuota_id and organizacion_id=v_org;
      end if;
    end if;
    v_mora_total := case when v_exenta then greatest(v_mora_pagada,0) else greatest(v_mora_generada,0) end;
    v_cap_pend := greatest(v_capital - v_principal_pagado,0);
    v_int_pend := greatest(v_interes - v_interes_pagado,0);
    v_mora_pend := greatest(v_mora_total - v_mora_pagada,0);
    if new.monto > v_cap_pend+v_int_pend+v_mora_pend+0.01 then raise exception 'FIN_PAGO_EXCEDE_SALDO'; end if;

    if v_v2 then
      -- mora → interés → capital
      new.monto_mora := least(new.monto, v_mora_pend);
      v_resto := greatest(new.monto - new.monto_mora,0);
      new.monto_interes := least(v_resto, v_int_pend);
      v_resto := greatest(v_resto - new.monto_interes,0);
      new.monto_principal := least(v_resto, v_cap_pend);
    else
      -- legado: capital primero, mora solo al completar el capital
      new.monto_interes := 0;
      new.monto_principal := least(new.monto, v_cap_pend);
      v_resto := greatest(new.monto - new.monto_principal,0);
      if v_cap_pend - new.monto_principal <= 0.01 then new.monto_mora := least(v_resto, v_mora_pend); else new.monto_mora := 0; end if;
    end if;
    if abs((new.monto_principal+new.monto_interes+new.monto_mora)-new.monto)>0.01 then raise exception 'FIN_ASIGNACION_PAGO_INVALIDA'; end if;
  elsif new.tipo='reversa' then
    if v_rol not in ('admin','gerente') then raise exception 'FIN_REVERSA_SIN_PERMISO'; end if;
    if new.reversa_de_id is null then raise exception 'FIN_REVERSA_ORIGEN_REQUERIDO'; end if;
    select * into v_orig from public.pos_fin_pagos where id=new.reversa_de_id and organizacion_id=v_org and tipo='pago';
    if v_orig.id is null then raise exception 'FIN_PAGO_ORIGEN_INVALIDO'; end if;
    if v_orig.financiamiento_id<>new.financiamiento_id or v_orig.cuota_id<>new.cuota_id then raise exception 'FIN_REVERSA_NO_COINCIDE'; end if;
    if exists(select 1 from public.pos_fin_pagos where organizacion_id=v_org and tipo='reversa' and reversa_de_id=v_orig.id) then raise exception 'FIN_PAGO_YA_REVERSADO'; end if;
    new.monto:=v_orig.monto; new.monto_principal:=v_orig.monto_principal; new.monto_interes:=coalesce(v_orig.monto_interes,0); new.monto_mora:=v_orig.monto_mora;
  else raise exception 'FIN_TIPO_INVALIDO'; end if;
  return new;
end $function$;

-- 2) Política de INSERT en pos_fin_pagos (antes 08_rls.sql:131) -----------------------------------------
drop policy if exists pos_fin_pagos_insert on public.pos_fin_pagos;
create policy pos_fin_pagos_insert on public.pos_fin_pagos as permissive for insert to authenticated
  with check (((mi_rol() = ANY (ARRAY['admin'::text, 'gerente'::text, 'cajero'::text, 'vendedor'::text])) AND (organizacion_id = mi_organizacion())));

commit;

-- Verificación sugerida después de aplicar (solo lectura):
--   select prosrc like '%''vendedor''%' from pg_proc where proname='pos_fin_validar_pago_insert';   -- true
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy where polname='pos_fin_pagos_insert';  -- incluye vendedor
