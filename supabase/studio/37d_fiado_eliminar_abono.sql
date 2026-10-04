-- 37d: eliminar abono de fiado (solo admin/gerente), con su asiento. Pegar completo en el SQL Editor de Supabase (STUDIO, edbknlkjnlfmkkiizdbe).
-- La herramienta automática no puede aplicarla porque pide confirmación por la palabra «delete» y vence a los 60 s.

create or replace function public.pos_fiado_eliminar_abono(p_abono_id uuid) returns jsonb
language plpgsql set search_path = public set timezone = 'America/Santo_Domingo' as $$
declare v_org uuid := mi_organizacion(); v_ab record;
begin
  perform set_config('nx.fin_rpc', '1', true);
  if mi_rol() not in ('admin','gerente') then raise exception 'FIADO_ELIMINAR_SOLO_ADMIN'; end if;
  select * into v_ab from public.pos_abonos where id = p_abono_id and organizacion_id = v_org for update;
  if v_ab.id is null then raise exception 'FIADO_ABONO_NO_ENCONTRADO'; end if;
  delete from public.pos_asientos where organizacion_id = v_org and origen_id = v_ab.id and tipo in ('cobro', 'rebaja_cliente');
  delete from public.pos_abonos where id = v_ab.id;
  perform set_config('nx.fin_rpc', '', true); return jsonb_build_object('ok', true, 'monto', v_ab.monto);
end $$;
revoke all on function public.pos_fiado_eliminar_abono(uuid) from public, anon;
grant execute on function public.pos_fiado_eliminar_abono(uuid) to authenticated, service_role;
