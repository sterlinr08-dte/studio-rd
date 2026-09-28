-- 39 · Bandeja STUDIO: responder citando un mensaje (28-sep-2026, entrega 1 de la paridad con Bayol Cell).
-- responde_a_id apunta al mensaje citado (propio o del cliente). Lo llenan crm-enviar (al responder desde la bandeja)
-- y crm-webhook (cuando el cliente cita un mensaje desde su WhatsApp: metadata.quotedMessageId).
alter table public.crm_mensajes add column if not exists responde_a_id uuid references public.crm_mensajes(id) on delete set null;
create index if not exists crm_msg_responde_idx on public.crm_mensajes(responde_a_id) where responde_a_id is not null;
