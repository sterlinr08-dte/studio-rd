-- 50 · Clientes automáticos (dueño 06-oct-2026: «continúa con la entidad clientes»; marcó las 4 opciones:
--      Chats ↔ Cliente, Código de cliente automático, Impedir duplicados nuevos, Unir duplicados existentes).
-- Proyecto STUDIO RD (edbknlkjnlfmkkiizdbe). Skill: .claude/skills/studio-automatizaciones/SKILL.md
--
-- Antes: 400 clientes (C-00050…C-00448 del sistema anterior y 1 «CL-0001» que puso la pantalla); el código lo
-- calculaba el navegador; 24 teléfonos y 6 cédulas repetidos; de 551 chats solo 7 enlazados a su cliente (483 son
-- de Instagram y no traen teléfono: esos solo se enlazan a mano desde el chat).
--
--  1. Código automático: entidad sin código → cliente C-00449, C-00450…; proveedor PR-0001…; banco BC-0001…
--     (empleado: EM- + su código, migración 49). Nunca se repite (índice único). Editar con el código vacío lo conserva.
--     El único «CL-0001» pasa a C-00449.
--  2. Cédula repetida: no se puede crear ni poner a un cliente activo una cédula (9+ dígitos) que ya tiene otro
--     cliente activo. Los duplicados de hoy no se bloquean hasta unirlos. El teléfono repetido solo avisa (pantalla).
--  3. Chats ↔ Cliente (WhatsApp, por los últimos 10 dígitos del teléfono): un chat nuevo se enlaza con el cliente
--     que tiene ese teléfono; un cliente nuevo o con teléfono corregido recibe sus chats sin enlazar. Si hay dos
--     clientes con el mismo teléfono, no se adivina: se enlaza cuando se unan.
--  4. pos_clientes_duplicados(): grupos por cédula, teléfono o nombre, con sus movimientos (solo admin/gerente).
--  5. pos_unir_clientes(queda, quitar[]): solo el administrador. Pasa a la ficha que queda las ventas, fiados,
--     abonos, apartados, cotizaciones, prefacturas, devoluciones, documentos, financiamientos, solicitudes, CRM y chats;
--     completa sus datos vacíos con los de las otras; las otras quedan INACTIVAS (no se borran) con la nota
--     «Unido a C-…». No cambia montos: el saldo del cliente es la suma de lo que ya tenía cada ficha. Queda en auditoría.
--     No une Entidades enlazadas a un empleado.

set lock_timeout = '10s';

-- ── 1. Código automático ──
create or replace function public.pos_entidad_codigo()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_org uuid; v_pref text; v_ancho int; v_n int;
begin
  new.codigo := nullif(btrim(new.codigo), '');
  if new.codigo is null and tg_op = 'UPDATE' then new.codigo := old.codigo; end if;
  if new.codigo is not null then return new; end if;
  if new.es_cliente then v_pref := 'C-'; v_ancho := 5;
  elsif new.es_proveedor then v_pref := 'PR-'; v_ancho := 4;
  elsif new.es_banco then v_pref := 'BC-'; v_ancho := 4;
  else return new;                                         -- solo empleado: EM-<código> lo pone la migración 49
  end if;
  v_org := coalesce(new.organizacion_id, public.mi_organizacion());
  perform pg_advisory_xact_lock(hashtext('pos_clientes.codigo:' || v_pref || coalesce(v_org::text, '-')));
  select coalesce(max(substring(c.codigo from '^' || v_pref || '(\d{1,9})$')::int), 0) + 1 into v_n
    from public.pos_clientes c where c.organizacion_id is not distinct from v_org;
  new.codigo := v_pref || lpad(v_n::text, greatest(v_ancho, length(v_n::text)), '0');
  return new;
end $$;
revoke all on function public.pos_entidad_codigo() from public, anon, authenticated;
drop trigger if exists trg_zcodigo_pos_clientes on public.pos_clientes;
create trigger trg_zcodigo_pos_clientes before insert or update of codigo on public.pos_clientes
  for each row execute function public.pos_entidad_codigo();

update public.pos_clientes set codigo = 'C-' || lpad(((select max(substring(codigo from '^C-(\d+)$')::int) from public.pos_clientes) + 1)::text, 5, '0')
 where codigo = 'CL-0001';

create unique index if not exists pos_clientes_codigo_unico
  on public.pos_clientes (organizacion_id, lower(codigo)) where codigo is not null;

-- ── 2. Cédula repetida ──
create or replace function public.nx_digitos(t text) returns text language sql immutable as
$$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

create or replace function public.pos_cliente_cedula_unica()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_ced text := public.nx_digitos(new.cedula); v_otro record;
begin
  if not (new.activo and new.es_cliente) or length(v_ced) < 9 then return new; end if;
  if tg_op = 'UPDATE' and public.nx_digitos(old.cedula) = v_ced and old.activo and old.es_cliente then return new; end if;
  select codigo, nombre into v_otro from public.pos_clientes c
   where c.id <> new.id and c.activo and c.es_cliente and c.organizacion_id is not distinct from coalesce(new.organizacion_id, public.mi_organizacion())
     and public.nx_digitos(c.cedula) = v_ced limit 1;
  if found then
    raise exception 'CLIENTE_CEDULA_DUPLICADA' using detail = coalesce(v_otro.codigo, '') || ' · ' || coalesce(v_otro.nombre, ''),
      hint = 'Esa cédula ya es de otro cliente. Ábrelo o únelos en «Revisar duplicados».';
  end if;
  return new;
end $$;
revoke all on function public.pos_cliente_cedula_unica() from public, anon, authenticated;
drop trigger if exists trg_zcedula_pos_clientes on public.pos_clientes;
create trigger trg_zcedula_pos_clientes before insert or update of cedula, es_cliente, activo on public.pos_clientes
  for each row execute function public.pos_cliente_cedula_unica();

-- ── 3. Chats ↔ Cliente ──
create or replace function public.nx_tel10(t text) returns text language sql immutable as
$$ select case when length(public.nx_digitos(t)) >= 10 then right(public.nx_digitos(t), 10) end $$;

create or replace function public.nx_cliente_por_tel(p_org uuid, p_tel text) returns uuid language sql stable security definer set search_path = public as
$$ select case when count(*) = 1 then (array_agg(c.id))[1] end
     from public.pos_clientes c
    where c.activo and c.organizacion_id is not distinct from p_org and public.nx_tel10(p_tel) is not null
      and public.nx_tel10(c.telefono) = public.nx_tel10(p_tel) $$;
revoke all on function public.nx_cliente_por_tel(uuid, text) from public, anon, authenticated;

create or replace function public.crm_conv_enlazar_cliente()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.cliente_id is null and new.telefono_e164 is not null then
    new.cliente_id := public.nx_cliente_por_tel(new.organizacion_id, new.telefono_e164);
  end if;
  return new;
end $$;
revoke all on function public.crm_conv_enlazar_cliente() from public, anon, authenticated;
drop trigger if exists trg_zcliente_crm_conv on public.crm_conversaciones;
create trigger trg_zcliente_crm_conv before insert or update of telefono_e164 on public.crm_conversaciones
  for each row execute function public.crm_conv_enlazar_cliente();

create or replace function public.pos_cliente_enlazar_chats()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not new.activo or public.nx_tel10(new.telefono) is null then return null; end if;
  if tg_op = 'UPDATE' and public.nx_tel10(old.telefono) is not distinct from public.nx_tel10(new.telefono) and old.activo then return null; end if;
  if public.nx_cliente_por_tel(new.organizacion_id, new.telefono) is distinct from new.id then return null; end if;   -- teléfono compartido: no adivinar
  update public.crm_conversaciones set cliente_id = new.id
   where cliente_id is null and organizacion_id is not distinct from new.organizacion_id
     and public.nx_tel10(telefono_e164) = public.nx_tel10(new.telefono);
  return null;
end $$;
revoke all on function public.pos_cliente_enlazar_chats() from public, anon, authenticated;
drop trigger if exists trg_zchats_pos_clientes on public.pos_clientes;
create trigger trg_zchats_pos_clientes after insert or update of telefono, activo on public.pos_clientes
  for each row execute function public.pos_cliente_enlazar_chats();

-- chats de hoy sin cliente
update public.crm_conversaciones v set cliente_id = public.nx_cliente_por_tel(v.organizacion_id, v.telefono_e164)
 where v.cliente_id is null and v.telefono_e164 is not null and public.nx_cliente_por_tel(v.organizacion_id, v.telefono_e164) is not null;

-- ── 4. Grupos de duplicados ──
create or replace function public.pos_clientes_duplicados()
returns table (grupo text, motivo text, cliente_id uuid, codigo text, nombre text, telefono text, cedula text,
               es_empleado boolean, ventas bigint, abonos bigint, chats bigint, ultima_venta timestamptz, creado timestamptz)
language sql stable security definer set search_path = public
as $$
  with c as (
    select * from public.pos_clientes
     where activo and es_cliente and organizacion_id = public.mi_organizacion()
       and coalesce(public.mi_rol(), '') in ('admin', 'gerente')
  ), claves as (
    select id, 'ced:' || public.nx_digitos(cedula) k, 'Misma cédula' m from c where length(public.nx_digitos(cedula)) >= 9
    union all
    select id, 'tel:' || public.nx_tel10(telefono), 'Mismo teléfono' from c
     where public.nx_tel10(telefono) is not null and public.nx_tel10(telefono) !~ '(\d)\1{6}'      -- 809-000-0000 y parecidos no cuentan
    union all
    select id, 'nom:' || lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')), 'Mismo nombre' from c where length(btrim(nombre)) >= 5
  ), grupos as (
    select k, min(m) m from claves group by k having count(*) > 1
  )
  select g.k, g.m, c.id, c.codigo, c.nombre, c.telefono, c.cedula, c.es_empleado,
         (select count(*) from public.pos_ventas v where v.cliente_id = c.id),
         (select count(*) from public.pos_abonos a where a.cliente_id = c.id),
         (select count(*) from public.crm_conversaciones x where x.cliente_id = c.id),
         (select max(v.created_at) from public.pos_ventas v where v.cliente_id = c.id),
         c.created_at
    from grupos g join claves k on k.k = g.k join c on c.id = k.id
   order by g.m, g.k, c.created_at
$$;
revoke all on function public.pos_clientes_duplicados() from public, anon;
grant execute on function public.pos_clientes_duplicados() to authenticated;

-- ── 5. Unir duplicados ──
-- La validación de caja (ventas y abonos) exige una caja abierta del usuario al EDITAR una venta o un abono; al unir
-- clientes solo cambia el cliente, no la caja: se permite con el aviso nx.unir_clientes que pone pos_unir_clientes.
create or replace function public.nx_validar_caja_propietario()
returns trigger language plpgsql set search_path = public
as $$
declare v_caja public.pos_cajas%rowtype;
begin
  if new.caja_id is null or auth.role() = 'service_role' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('nx.unir_clientes', true), '') = '1'
     and new.caja_id is not distinct from old.caja_id then return new; end if;
  select * into v_caja from public.pos_cajas where id=new.caja_id;
  if v_caja.id is null or v_caja.estado <> 'abierta' or
     v_caja.organizacion_id is distinct from public.mi_organizacion() or
     v_caja.usuario_id is distinct from auth.uid() then
    raise exception 'CAJA_AJENA_O_CERRADA';
  end if;
  return new;
end;
$$;

create or replace function public.pos_unir_clientes(p_queda uuid, p_quitar uuid[])
returns json language plpgsql security definer set search_path = public
as $$
declare v_org uuid := public.mi_organizacion(); v_q public.pos_clientes%rowtype; v_o record; v_n int; v_tot jsonb := '{}'::jsonb;
        t text; v_ids uuid[]; v_quien text;
begin
  if coalesce(public.mi_rol(), '') <> 'admin' then raise exception 'SOLO_ADMIN' using hint = 'Solo el administrador une clientes.'; end if;
  select * into v_q from public.pos_clientes where id = p_queda and organizacion_id = v_org and activo;
  if v_q.id is null then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
  select array_agg(id) into v_ids from public.pos_clientes
   where id = any(p_quitar) and id <> p_queda and organizacion_id = v_org and activo;
  if v_ids is null or cardinality(v_ids) = 0 then raise exception 'NADA_QUE_UNIR'; end if;
  if exists (select 1 from public.rrhh_empleados e where e.entidad_id = any(v_ids)) then
    raise exception 'ES_EMPLEADO' using hint = 'Una de las fichas es de un empleado: esas no se unen aquí.';
  end if;
  perform set_config('nx.fin_rpc', '1', true);
  perform set_config('nx.unir_clientes', '1', true);
  foreach t in array array['pos_ventas','pos_ventas_fiado','pos_abonos','pos_apartados','pos_cotizaciones','pos_prefacturas',
      'pos_ventas_suspendidas','pos_devoluciones','pos_documentos','pos_credito_eventos','pos_financiamientos',
      'pos_fin_solicitudes','pos_fin_documentos','pos_fin_referencias','pos_crm','pos_crm_actividades','crm_conversaciones'] loop
    execute format('update public.%I set cliente_id = $1 where cliente_id = any($2)', t) using p_queda, v_ids;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_tot := v_tot || jsonb_build_object(t, v_n); end if;
  end loop;
  -- perfil de financiamiento: uno por cliente; se pasa solo si la ficha que queda no tiene
  if not exists (select 1 from public.pos_fin_perfil where cliente_id = p_queda) then
    update public.pos_fin_perfil set cliente_id = p_queda
     where id = (select id from public.pos_fin_perfil where cliente_id = any(v_ids) order by created_at desc limit 1);
  end if;
  v_quien := coalesce((select nom from public.usuarios_sistema where id = public.mi_usuario_id()), 'admin');
  -- las otras fichas quedan inactivas (no se borran)
  update public.pos_clientes set activo = false,
         notas = btrim(coalesce(notas, '') || E'\n' || 'Unido a ' || coalesce(v_q.codigo, '') || ' ' || v_q.nombre || ' el ' || to_char(now() at time zone 'America/Santo_Domingo', 'DD/MM/YYYY') || ' por ' || v_quien)
   where id = any(v_ids);
  -- la que queda completa sus datos vacíos con los de las otras (la más reciente primero)
  for v_o in select * from public.pos_clientes where id = any(v_ids) order by created_at desc loop
    update public.pos_clientes q set
      cedula = coalesce(nullif(q.cedula, ''), nullif(v_o.cedula, '')), telefono = coalesce(nullif(q.telefono, ''), nullif(v_o.telefono, '')),
      email = coalesce(nullif(q.email, ''), nullif(v_o.email, '')), direccion = coalesce(nullif(q.direccion, ''), nullif(v_o.direccion, '')),
      contacto = coalesce(nullif(q.contacto, ''), nullif(v_o.contacto, '')), representante = coalesce(nullif(q.representante, ''), nullif(v_o.representante, '')),
      limite_credito = greatest(q.limite_credito, v_o.limite_credito),
      acepta_whatsapp = coalesce(q.acepta_whatsapp, false) or coalesce(v_o.acepta_whatsapp, false),
      acepta_whatsapp_fecha = coalesce(q.acepta_whatsapp_fecha, v_o.acepta_whatsapp_fecha),
      es_proveedor = q.es_proveedor or v_o.es_proveedor, es_banco = q.es_banco or v_o.es_banco
     where q.id = p_queda;
  end loop;
  insert into public.auditoria (ts, usuario, accion, detalle, modulo, entity_table, entity_id, new_data, cliente_id, organizacion_id)
  values (to_char(now() at time zone 'America/Santo_Domingo', 'YYYY-MM-DD HH24:MI:SS'), v_quien, 'CLIENTES_UNIDOS',
          coalesce(v_q.codigo, '') || ' ' || v_q.nombre || ' ← ' || (select string_agg(coalesce(codigo, '') || ' ' || nombre, ', ') from public.pos_clientes where id = any(v_ids)),
          'Clientes', 'pos_clientes', p_queda::text, jsonb_build_object('quitados', v_ids, 'movidos', v_tot)::text, p_queda, v_org);
  return json_build_object('queda', p_queda, 'codigo', v_q.codigo, 'unidos', cardinality(v_ids), 'movidos', v_tot);
end $$;
revoke all on function public.pos_unir_clientes(uuid, uuid[]) from public, anon;
grant execute on function public.pos_unir_clientes(uuid, uuid[]) to authenticated;
