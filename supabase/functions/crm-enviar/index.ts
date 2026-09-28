// crm-enviar — STUDIO · CRM Fase 2 (24-sep-2026). Envía UNA respuesta escrita por un empleado en la bandeja del CRM
// (WhatsApp, Instagram o Facebook) a través de Zernio. Réplica de whatsapp-enviar / instagram-enviar de BAYOL CELL con:
//   · autorización con la RLS del propio usuario: si la conversación no es visible para él, no se envía (Bayol lo
//     decidía con user_metadata, editable por el usuario);
//   · el mensaje se registra ANTES de llamar a Zernio con una clave de idempotencia única (F17): un doble clic o un
//     reintento de red no envía dos veces; si Zernio falla queda «fallido» con el error;
//   · WhatsApp: fuera de la ventana de 24 h desde el último mensaje del cliente no se permite texto libre (regla de Meta);
//   · canal apagado o sin ZERNIO_API_KEY → no se envía nada.
// Nunca envía por su cuenta: solo cuando un empleado pulsa Enviar en la app.
// 28-sep-2026 (paridad con Bayol Cell, entrega 1):
//   · {accion:"plantillas", conversacion_id} → plantillas APROBADAS de la línea de WhatsApp de esa conversación;
//   · plantilla:{nombre, idioma, variables?[], variablesNombradas?[{param_name,text}]} → se envía aunque la ventana de
//     24 h esté cerrada (es justo para eso); se registra tipo «plantilla» con el texto ya rellenado;
//   · responde_a_id → cita el mensaje (replyTo a Zernio); si Zernio lo rechaza con 4xx se reintenta sin cita;
//   · si el eco del teléfono (message.sent) ya guardó ese mismo id de WhatsApp, se borra la copia y no se queda «pendiente».
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

async function zernio(convId: string, accountId: string, campos: Record<string, unknown>, idem: string, replyTo: string | null = null) {
  for (let intento = 0; intento < 3; intento++) {
    const body: Record<string, unknown> = { accountId, ...campos };
    if (replyTo) body.replyTo = replyTo;
    const r = await fetch(`https://zernio.com/api/v1/inbox/conversations/${encodeURIComponent(convId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${ZERNIO_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idem },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => null);
    // «Conversation not found» es inequívoco (Zernio no envió nada): se reintenta, como en Bayol.
    if (r.status === 404 && data?.code === "CONVERSATION_NOT_FOUND" && intento < 2) { await new Promise((s) => setTimeout(s, 1500)); continue; }
    return { ok: r.ok && !!data?.success, status: r.status, data };
  }
  return { ok: false, status: 404, data: { code: "CONVERSATION_NOT_FOUND" } };
}

// Placeholders del cuerpo de una plantilla: {{1}}, {{2}}… (posicionales) o {{nombre}} (nombrados).
function placeholders(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
async function plantillasAprobadas(accountId: string) {
  const qs = new URLSearchParams({ accountId, status: "APPROVED" });
  const r = await fetch(`https://zernio.com/api/v1/whatsapp/templates?${qs}`, { headers: { Authorization: `Bearer ${ZERNIO_API_KEY}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  const rows = (j?.templates ?? j?.data?.templates ?? []) as Record<string, unknown>[];
  if (!r.ok || !Array.isArray(rows)) return null;
  return rows.filter((t) => t?.status === "APPROVED").map((t) => {
    const comps = (t.components ?? []) as Record<string, unknown>[];
    const comp = (tipo: string) => comps.find((c) => String(c.type).toUpperCase() === tipo) as Record<string, any> | undefined;
    const body = String(comp("BODY")?.text ?? ""), footer = String(comp("FOOTER")?.text ?? ""), header = comp("HEADER");
    const vars = placeholders(body);
    return {
      nombre: t.name, idioma: t.language, categoria: t.category, cuerpo: body, pie: footer || null,
      encabezado: header && String(header.format ?? "TEXT").toUpperCase() === "TEXT" ? String(header.text ?? "") : null,
      encabezado_media: header && String(header.format ?? "TEXT").toUpperCase() !== "TEXT" ? String(header.format).toLowerCase() : null,
      variables: vars, nombradas: vars.some((v) => !/^\d+$/.test(v)),
      ejemplos: (comp("BODY")?.example?.body_text?.[0] ?? []) as string[],
    };
  });
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
  const respondeA = b.responde_a_id && UUID.test(String(b.responde_a_id)) ? String(b.responde_a_id) : null;
  const pl = b.plantilla && typeof b.plantilla === "object" ? b.plantilla as Record<string, unknown> : null;

  // Lista de plantillas aprobadas de la línea de esta conversación (solo lectura).
  if (b.accion === "plantillas") {
    if (!UUID.test(convId)) return json({ ok: false, error: "datos_invalidos" }, 400);
    const { data: cv } = await userDb.from("crm_conversaciones").select("id, canal_id, plataforma").eq("id", convId).maybeSingle();
    if (!cv) return json({ ok: false, error: "sin_permiso" }, 403);
    if (cv.plataforma !== "whatsapp") return json({ ok: true, plantillas: [] });
    if (!ZERNIO_API_KEY) return json({ ok: false, error: "sin_configurar" }, 503);
    const { data: cn } = await db.from("crm_canales").select("zernio_account_id, activo").eq("id", cv.canal_id).single();
    if (!cn?.activo) return json({ ok: false, error: "canal_apagado", mensaje: "Este canal está apagado en el CRM." }, 409);
    const lista = await plantillasAprobadas(cn.zernio_account_id);
    if (!lista) return json({ ok: false, error: "zernio_error", mensaje: "Zernio no devolvió las plantillas." }, 502);
    return json({ ok: true, plantillas: lista });
  }

  if (!UUID.test(convId) || !UUID.test(idem)) return json({ ok: false, error: "datos_invalidos" }, 400);
  if (pl && (!pl.nombre || !pl.idioma)) return json({ ok: false, error: "plantilla_invalida" }, 400);
  if (!texto && !adjPath && !pl) return json({ ok: false, error: "mensaje_vacio" }, 400);
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
  if (pl && conv.plataforma !== "whatsapp") return json({ ok: false, error: "plantilla_invalida", mensaje: "Las plantillas son solo para WhatsApp." }, 400);
  if (conv.plataforma === "whatsapp" && !pl) {
    const h = conv.ultimo_inbound_at ? (Date.now() - new Date(conv.ultimo_inbound_at).getTime()) / 36e5 : Infinity;
    if (h > 24) return json({ ok: false, error: "ventana_cerrada", mensaje: "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite plantillas aprobadas." }, 409);
  }

  const { data: yo } = await db.from("profiles").select("usuario_sistema_id").eq("id", u.user.id).maybeSingle();
  const { data: us } = yo?.usuario_sistema_id ? await db.from("usuarios_sistema").select("nom").eq("id", yo.usuario_sistema_id).maybeSingle() : { data: null };
  const nom = us?.nom ?? null;
  const tipo = pl ? "plantilla" : adjPath ? adjTipo : "texto";
  // Mensaje citado: debe ser de ESTA conversación; su id de WhatsApp va como replyTo (Instagram/Facebook no lo admiten).
  let replyTo: string | null = null, respondeOk: string | null = null;
  if (respondeA && !pl) {
    const { data: orig } = await db.from("crm_mensajes").select("id, conversacion_id, proveedor_msg_id").eq("id", respondeA).maybeSingle();
    if (orig && orig.conversacion_id === conv.id) { respondeOk = orig.id; if (conv.plataforma === "whatsapp") replyTo = orig.proveedor_msg_id ?? null; }
  }
  const reg = await db.from("crm_mensajes").insert({
    organizacion_id: conv.organizacion_id, conversacion_id: conv.id, direccion: "out", tipo, cuerpo: texto || (pl ? String(pl.nombre) : null), media_path: adjPath,
    estado: "pendiente", idempotency_key: idem, enviado_por: yo?.usuario_sistema_id ?? null, enviado_por_nombre: nom, responde_a_id: respondeOk,
  }).select("id").single();
  if (reg.error) {
    if (reg.error.code === "23505") return json({ ok: true, repetido: true });
    return json({ ok: false, error: "registro_fallido" }, 500);
  }

  const campos: Record<string, unknown> = {};
  if (pl) {
    const variableMapping: Record<string, unknown> = {};
    const vars = Array.isArray(pl.variables) ? (pl.variables as unknown[]).map((v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{4,}/g, "   ").trim() || "-") : [];
    const nomb = Array.isArray(pl.variablesNombradas) ? (pl.variablesNombradas as Record<string, unknown>[]).map((v) => ({ param_name: String(v.param_name ?? ""), text: String(v.text ?? "").replace(/[\r\n\t]+/g, " ").trim() || "-" })) : [];
    if (vars.length) variableMapping.body_text = [vars];
    if (nomb.length) variableMapping.body_text_named_params = nomb;
    campos.messageType = "template";
    campos.template = { name: String(pl.nombre), language: String(pl.idioma), variableMapping };
  } else if (adjPath) {
    const s = await db.storage.from("crm-media").createSignedUrl(adjPath, 3600);
    if (s.error || !s.data?.signedUrl) { await db.from("crm_mensajes").update({ estado: "fallido", error: "adjunto no disponible" }).eq("id", reg.data.id); return json({ ok: false, error: "adjunto_no_disponible" }, 400); }
    campos.attachmentUrl = s.data.signedUrl; campos.attachmentType = ATT[adjTipo] ?? "file";
    if (adjNombre && adjTipo === "documento") campos.attachmentName = adjNombre;
    if (texto) campos.message = texto;
  } else campos.message = texto;

  let r;
  try {
    r = await zernio(conv.zernio_conversation_id, canal.zernio_account_id, campos, idem, replyTo);
    // Un 4xx con cita pudo ser por el replyTo: se reintenta sin citar (un 5xx no, podría haberse enviado ya).
    if (!r.ok && replyTo && r.status >= 400 && r.status < 500 && r.data?.code !== "CONVERSATION_NOT_FOUND") {
      console.error("envío con cita rechazado, reintento sin cita:", r.status);
      r = await zernio(conv.zernio_conversation_id, canal.zernio_account_id, campos, idem + ":sin-cita");
    }
  }
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
  let up = await db.from("crm_mensajes").update({ estado: "enviado", proveedor_msg_id: pid }).eq("id", reg.data.id);
  if (up.error?.code === "23505" && pid) {
    // El eco del webhook llegó antes y guardó una copia con este mismo id: se borra la copia y se completa el original.
    await db.from("crm_mensajes").delete().eq("proveedor_msg_id", pid).eq("conversacion_id", conv.id).neq("id", reg.data.id).is("idempotency_key", null);
    up = await db.from("crm_mensajes").update({ estado: "enviado", proveedor_msg_id: pid }).eq("id", reg.data.id);
    if (up.error) console.error("guardar id del proveedor:", up.error.message);
  }
  return json({ ok: true, mensaje_id: reg.data.id });
});
