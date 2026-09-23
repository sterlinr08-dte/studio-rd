-- STUDIO · 20 · Ajustes de la auditoría general (2026-09-23). APLICADO en edbknlkjnlfmkkiizdbe.
-- Asesor de seguridad «Function Search Path Mutable»: el trigger de Reacondicionado no fijaba search_path.
alter function public.pos_reacond_touch() set search_path to 'public';
