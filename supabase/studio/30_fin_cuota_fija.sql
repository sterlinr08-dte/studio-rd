-- STUDIO · 30 · Financiamiento fase 7 (réplica NEXUS PRO): método «sobre saldo» con CUOTA FIJA (sistema francés) — 2026-09-24
-- Antes: capital en partes iguales + interés sobre el saldo → la cuota bajaba cada período.
-- NEXUS (nx-fin.js amortizar): cuota fija C·i/(1−(1+i)^−n), interés sobre saldo, capital creciente.
-- Aquí se conserva el significado de los planes de STUDIO: la tasa es POR CUOTA (por período) y puede tener dos
-- fases (tasa1 para las primeras cuotas_fase1, tasa2 después). En cada fase la cuota fija se recalcula sobre el
-- saldo que queda. La última cuota ajusta los centavos. El método «plano» NO cambia.
-- Auditoría previa (2026-09-24): 0 planes, 0 solicitudes, 0 financiamientos, 0 cuotas → no afecta ningún dato.
create or replace function public.pos_fin_amortizacion(p_capital numeric, p_metodo text, p_num_cuotas integer, p_cuotas_fase1 integer, p_tasa1 numeric, p_tasa2 numeric, p_frecuencia text, p_primera_fecha date)
returns table(numero integer, fecha_venc date, capital numeric, interes numeric, cuota numeric, saldo_despues numeric)
language plpgsql
immutable
set search_path to 'public'
as $function$
declare v_base numeric; v_saldo numeric; i integer; v_cap numeric; v_int numeric; v_tasa numeric; v_f1 integer := coalesce(p_cuotas_fase1, 0);
        v_cuota numeric; v_rest integer; v_r numeric;
begin
  if coalesce(p_capital, 0) <= 0 then raise exception 'FIN_CAPITAL_INVALIDO'; end if;
  if p_num_cuotas is null or p_num_cuotas < 1 or p_num_cuotas > 120 then raise exception 'FIN_CUOTAS_INVALIDAS'; end if;
  if v_f1 < 0 or v_f1 > p_num_cuotas then raise exception 'FIN_FASE1_INVALIDA'; end if;
  if coalesce(p_tasa1, 0) < 0 or coalesce(p_tasa2, 0) < 0 then raise exception 'FIN_TASA_INVALIDA'; end if;
  if p_metodo not in ('plano', 'saldo') then raise exception 'FIN_METODO_INVALIDO'; end if;
  if p_frecuencia not in ('semanal', 'quincenal', 'mensual') then raise exception 'FIN_FRECUENCIA_INVALIDA'; end if;
  if p_primera_fecha is null then raise exception 'FIN_PRIMER_VENCIMIENTO_REQUERIDO'; end if;
  v_base := round(p_capital / p_num_cuotas, 2); v_saldo := p_capital;
  for i in 1..p_num_cuotas loop
    v_tasa := case when v_f1 > 0 and i > v_f1 then coalesce(p_tasa2, 0) else coalesce(p_tasa1, 0) end;
    if p_metodo = 'plano' then
      v_cap := case when i = p_num_cuotas then round(p_capital - v_base * (p_num_cuotas - 1), 2) else v_base end;
      v_int := round(p_capital * v_tasa / 100, 2);
    else
      if i = 1 or (v_f1 > 0 and i = v_f1 + 1) then
        v_rest := p_num_cuotas - i + 1; v_r := v_tasa / 100;
        v_cuota := case when v_r = 0 then round(v_saldo / v_rest, 2) else round(v_saldo * v_r / (1 - power(1 + v_r, -v_rest)), 2) end;
      end if;
      v_int := round(v_saldo * v_tasa / 100, 2);
      v_cap := case when i = p_num_cuotas then round(v_saldo, 2) else least(round(v_cuota - v_int, 2), round(v_saldo, 2)) end;
    end if;
    v_saldo := round(v_saldo - v_cap, 2);
    numero := i;
    fecha_venc := case p_frecuencia when 'semanal' then p_primera_fecha + ((i - 1) * 7) when 'quincenal' then p_primera_fecha + ((i - 1) * 15) else (p_primera_fecha + make_interval(months => i - 1))::date end;
    capital := v_cap; interes := v_int; cuota := v_cap + v_int; saldo_despues := greatest(v_saldo, 0);
    return next;
  end loop;
end $function$;
