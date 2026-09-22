-- STUDIO · 15 · bandera del Inbox de WhatsApp (2026-09-22)
-- El frontend (parches-whatsapp.js) solo carga el Inbox corporativo si esta bandera es true.
-- Queda en false hasta que STUDIO tenga su propio backend de WhatsApp (tablas whatsapp_*, RPC,
-- Edge Functions y número propio). No crea contabilidad ni datos.
alter table public.pos_config add column if not exists whatsapp_inbox boolean not null default false;
comment on column public.pos_config.whatsapp_inbox is 'Muestra el Inbox de WhatsApp (parches-whatsapp-*). Requiere backend whatsapp_* propio.';
