-- 38 · Bandeja STUDIO: conectar el WhatsApp de STUDIO (829-624-7623) que el dueño enlazó en Zernio (28-sep-2026).
-- · crm_secretos: secreto de firma del webhook de Zernio, generado aquí y leído solo por crm-webhook (service_role).
-- · crm_canales: la línea de WhatsApp de STUDIO ENCENDIDA; el Instagram studio__rd registrado APAGADO hasta que el dueño lo pida.
create table if not exists public.crm_secretos (
  nombre text primary key,
  valor text not null,
  created_at timestamptz not null default now()
);
alter table public.crm_secretos enable row level security;
revoke all on public.crm_secretos from anon, authenticated;

insert into public.crm_secretos (nombre, valor)
select 'zernio_webhook', encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from public.crm_secretos where nombre = 'zernio_webhook');

insert into public.crm_canales (organizacion_id, plataforma, zernio_account_id, nombre, identificador, activo)
select (select organizacion_id from public.pos_config limit 1), 'whatsapp', '6aba77fb5eadc10eaa909a1c', 'STUDIO WhatsApp', '+18296247623', true
where not exists (select 1 from public.crm_canales where zernio_account_id = '6aba77fb5eadc10eaa909a1c');

insert into public.crm_canales (organizacion_id, plataforma, zernio_account_id, nombre, identificador, activo)
select (select organizacion_id from public.pos_config limit 1), 'instagram', '6ab97957292530aa2fe7ba86', 'STUDIO Instagram', 'studio__rd', false
where not exists (select 1 from public.crm_canales where zernio_account_id = '6ab97957292530aa2fe7ba86');
