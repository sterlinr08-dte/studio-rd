-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 36 · Financiamiento: el VENDEDOR (u otro rol) cobra cuotas SI SU ROL LO TIENE ACTIVADO   *** APLICADA 30-sep-2026 ***
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ESTADO: APLICADA el 30-sep-2026 (~01:20 UTC) en edbknlkjnlfmkkiizdbe vía apply_migration «36_fin_cobro_por_rol», tras comprobar md5 del trigger (d8381d58…) y políticas sin cambios. Verificado: trigger con fin_cobrar, pos_acceso_select + pos_acceso_admin, pos_fin_pagos_insert abierto a roles de la org.
-- Decisiones del dueño: 29-sep-2026 «el vendedor cobra cuotas»; 30-sep-2026 precisa: «el vendedor por rol
-- depende si está habilitado o no». Por eso el cobro NO se abre a todo vendedor: se abre a cualquier rol cuyo
-- registro en pos_acceso tenga el permiso especial 'fin_cobrar' (casilla «Cobrar cuotas de financiamiento» en
-- Permisos por rol). Admin, gerente y cajero cobran siempre, como hasta hoy.
--
-- Qué cambia:
--   1. Trigger pos_fin_validar_pago_insert(): un rol distinto de admin/gerente/cajero solo puede insertar un
--      pago (tipo 'pago') si pos_acceso(org, rol).modulos contiene 'fin_cobrar'; si no → FIN_COBRO_SIN_PERMISO.
--      La REVERSA sigue siendo solo admin/gerente (rama tipo='reversa', sin cambios).
--   2. Política RLS pos_fin_pagos_insert: cualquier usuario con rol de la organización (el trigger decide).
--   3. pos_acceso (quién puede cambiar permisos): antes CUALQUIER rol de la organización podía escribir en esa
--      tabla (política pos_acceso_admin «for all» con mi_rol() is not null), o sea un vendedor podía darse
--      permisos a sí mismo. Ahora: leer = cualquier rol de la organización (el menú lo necesita);
--      crear/cambiar/borrar = solo admin y gerente.
-- Lo que NO cambia:
--   · pos_fin_registrar_pago_v2 (no tiene lista de roles: se apoya en el trigger y la RLS).
--   · Efectivo sigue exigiendo caja abierta DEL MISMO USUARIO (FIN_CAJA_CERRADA). Transferencia y tarjeta no.
--   · pos_fin_reversar_pago y pos_fin_condonar_mora: solo admin/gerente.
--
-- Objetos EN VIVO que se reemplazan (leídos el 30-sep-2026 en edbknlkjnlfmkkiizdbe, solo lectura):
--   · public.pos_fin_validar_pago_insert(): pg_get_functiondef md5 d8381d587f3e19237e9232b5d3d22ecb (sin cambios
--     desde la lectura del 29-sep; = 14_financiamiento_v2.sql §8 salvo comentarios).
--   · policy pos_fin_pagos_insert: ((mi_rol() = ANY (ARRAY['admin','gerente','cajero'])) AND (organizacion_id = mi_organizacion())).
--   · policy pos_acceso_admin (for all): using ((mi_rol() IS NOT NULL) AND (organizacion_id = mi_organizacion()))
--     with check ((mi_rol() IS NOT NULL) AND ((organizacion_id IS NULL) OR (organizacion_id = mi_organizacion()))) = 08_rls.sql:95.
--   · Datos al leer: 0 filas en pos_acceso (el sistema usa los roles por defecto), 0 pos_fin_pagos.
-- Reversa: volver a correr 14 §8, la política de 08_rls.sql:131 y la de 08_rls.sql:95.
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
  if v_rol is null then raise exception 'FIN_SIN_PERMISO'; end if;
  if v_org is null then raise exception 'FIN_ORG_REQUERIDA'; end if;
  -- 36 (dueño 30-sep-2026): otro rol (p. ej. vendedor) cobra solo si su rol tiene 'fin_cobrar' en pos_acceso.
  if v_rol not in ('admin','gerente','cajero') then
    if new.tipo is distinct from 'pago' or not exists (select 1 from public.pos_acceso a
         where a.organizacion_id=v_org and a.rol=v_rol and a.modulos ? 'fin_cobrar') then
      raise exception 'FIN_COBRO_SIN_PERMISO';
    end if;
  end if;
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

-- 2) Política de INSERT en pos_fin_pagos (antes 08_rls.sql:131): el trigger decide qué rol cobra ------------
drop policy if exists pos_fin_pagos_insert on public.pos_fin_pagos;
create policy pos_fin_pagos_insert on public.pos_fin_pagos as permissive for insert to authenticated
  with check (((mi_rol() IS NOT NULL) AND (organizacion_id = mi_organizacion())));

-- 3) pos_acceso: todos leen, solo admin/gerente cambian permisos (antes 08_rls.sql:95) ----------------------
drop policy if exists pos_acceso_admin on public.pos_acceso;
create policy pos_acceso_select on public.pos_acceso as permissive for select to public
  using (((mi_rol() IS NOT NULL) AND (organizacion_id = mi_organizacion())));
create policy pos_acceso_admin on public.pos_acceso as permissive for all to public
  using (((mi_rol() = ANY (ARRAY['admin'::text, 'gerente'::text])) AND (organizacion_id = mi_organizacion())))
  with check (((mi_rol() = ANY (ARRAY['admin'::text, 'gerente'::text])) AND ((organizacion_id IS NULL) OR (organizacion_id = mi_organizacion()))));

commit;

-- Verificación sugerida después de aplicar (solo lectura):
--   select prosrc like '%fin_cobrar%' from pg_proc where proname='pos_fin_validar_pago_insert';        -- true
--   select polname, polcmd from pg_policy where polrelid='public.pos_acceso'::regclass;               -- select + admin
