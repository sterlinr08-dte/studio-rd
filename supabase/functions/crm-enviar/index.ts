// crm-enviar — STUDIO · CRM Fase 2 (24-sep-2026). Envía UNA respuesta escrita por un empleado en la bandeja del CRM
// (WhatsApp, Instagram o Facebook) a través de Zernio. Réplica de whatsapp-enviar / instagram-enviar de BAYOL CELL con:
//   · autorización con la RLS del propio usuario: si la conversación no es visible para él, no se envía (Bayol lo
//     decidía con user_metadata, editable por el usuario);
//   · el mensaje se registra ANTES de llamar a Zernio con una clave de idempotencia única (F17): un doble clic o un
//     reintento de red no envía dos veces; si Zernio falla queda «fallido» con el error;
//   · WhatsApp: fuera de la ventana de 24 h desde el último mensaje del cliente no se permite texto libre (regla de Meta);
//   · canal apagado o sin ZERNIO_API_KEY → no se envía nada.
// Nunca envía por su cuenta: solo cuando un empleado pulsa Enviar en la app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ZERNIO_API_KEY = Deno.env.get("ZERNIO_API_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
const ATT: Record<string, string> = { imagen: "image", video: "video", audio: "audio", documento: "file" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function zernio(convId: string, accountId: string, campos: Record<string, unknown>, idem: string) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(`https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(convId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${ZERNIO_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify({ accountId, ...campos }), signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => null);
    // «Conversation not found» es inequívoco (Zernio no envió nada): se reintenta, como en Bayol.
    if (r.status === 404 && data?.code === "CONVERSATION_NOT_FOUND" && intento < 2) { await new Promise((s) => setTimeout(s, 1500)); continue; }
    return { ok: r.ok && !!data?.success, status: r.status, data };
  }
  return { ok: false, status: 404, data: { code: "CONVERSATION_NOT_FOUND" } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json({ ok: false, error: "no_autenticado" }, 401);

  let b: Record<string, unknown>; try { b = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }
  const convId = String(b.conversacion_id ?? ""), texto = String(b.texto ?? "").trim(), idem = String(b.idempotency_key ?? "");
  const adjPath = b.adjunto_path ? String(b.adjunto_path) : null, adjTipo = String(b.adjunto_tipo ?? "documento"), adjNombre = b.adjunto_nombre ? String(b.adjunto_nombre) : null;
  if (!UUID.test(convId) || !UUID.test(idem)) return json({ ok: false, error: "datos_invalidos" }, 400);
  if (!texto && !adjPath) return json({ ok: false, error: "mensaje_vacio" }, 400);
  if (texto.length > 4000) return json({ ok: false, error: "mensaje_largo" }, 400);
  if (adjPath && !adjPath.startsWith("salientes/")) return json({ ok: false, error: "adjunto_invalido" }, 400);

  // Visibilidad con la RLS del usuario (admin/gerente todo; vendedor lo suyo y lo libre).
  const { data: conv } = await userDb.from("crm_conversaciones").select("id, organizacion_id, canal_id, plataforma, zernio_conversation_id, ultimo_inbound_at").eq("id", convId).maybeSingle();
  if (!conv) return json({ ok: false, error: "sin_permiso" }, 403);

  // Doble clic / reintento: si ya existe esa clave, se devuelve lo que pasó sin volver a enviar.
  const { data: previo } = await db.from("crm_mensajes").select("id, estado, error").eq("idempotency_key", idem).maybeSingle();
  if (previo) return json({ ok: previo.estado !== "fallido", repetido: true, mensaje_id: previo.id, estado: previo.estado, error: previo.error });

  const { data: canal } = await db.from("crm_canales").select("id, activo, zernio_account_id, plataforma").eq("id", conv.canal_id).single();
  if (!canal?.activo) return json({ ok: false, error: "canal_apagado", mensaje: "Este canal está apagado en el CRM." }, 409);
  if (!ZERNIO_API_KEY) return json({ ok: false, error: "sin_configurar", mensaje: "Falta configurar la conexión con Zernio en el servidor." }, 503);
  if (!conv.zernio_conversation_id) return json({ ok: false, error: "sin_conversacion", mensaje: "Esta conversación todavía no tiene id en Zernio." }, 409);
  if (conv.plataforma === "whatsapp") {
    const h = conv.ultimo_inbound_at ? (Date.now() - new Date(conv.ultimo_inbound_at).getTime()) / 36e5 : Infinity;
    if (h > 24) return json({ ok: false, error: "ventana_cerrada", mensaje: "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas." }, 409);
  }

  const { data: yo } = await db.from("profiles").select("usuario_sistema_id").eq("id", u.user.id).maybeSingle();
  const { data: us } = yo?.usuario_sistema_id ? await db.from("usuarios_sistema").select("nom").eq("id", yo.usuario_sistema_id).maybeSingle() : { data: null };
  const nom = us?.nom ?? null;
  const tipo = adjPath ? adjTipo : "texto";
  const reg = await db.from("crm_mensajes").insert({
    organizacion_id: conv.organizacion_id, conversacion_id: conv.id, direccion: "out", tipo, cuerpo: texto || null, media_path: adjPath,
    estado: "pendiente", idempotency_key: idem, enviado_por: yo?.usuario_sistema_id ?? null, enviado_por_nombre: nom,
  }).select("id").single();
  if (reg.error) {
    if (reg.error.code === "23505") return json({ ok: true, repetido: true });
    return json({ ok: false, error: "registro_fallido" }, 500);
  }

  const campos: Record<string, unknown> = {};
  if (adjPath) {
    const s = await db.storage.from("crm-media").createSignedUrl(adjPath, 3600);
    if (s.error || !s.data?.signedUrl) { await db.from("crm_mensajes").update({ estado: "fallido", error: "adjunto no disponible" }).eq("id", reg.data.id); return json({ ok: false, error: "adjunto_no_disponible" }, 400); }
    campos.attachmentUrl = s.data.signedUrl; campos.attachmentType = ATT[adjTipo] ?? "file";
    if (adjNombre && adjTipo === "documento") campos.attachmentName = adjNombre;
    if (texto) campos.message = texto;
  } else campos.message = texto;

  let r;
  try { r = await zernio(conv.zernio_conversation_id, canal.zernio_account_id, campos, idem); }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await db.from("crm_mensajes").update({ estado: "fallido", error: ("sin respuesta de Zernio: " + m).slice(0, 500) }).eq("id", reg.data.id);
    return json({ ok: false, error: "zernio_sin_respuesta", mensaje: "Zernio no respondió; revisa en el teléfono si el mensaje salió antes de reintentar." }, 504);
  }
  if (!r.ok) {
    await db.from("crm_mensajes").update({ estado: "fallido", error: JSON.stringify(r.data ?? r.status).slice(0, 500) }).eq("id", reg.data.id);
    return json({ ok: false, error: "zernio_error", status: r.status }, 502);
  }
  const pid = r.data?.data?.messageId ?? null;
  await db.from("crm_mensajes").update({ estado: "enviado", proveedor_msg_id: pid }).eq("id", reg.data.id);
  return json({ ok: true, mensaje_id: reg.data.id });
});
