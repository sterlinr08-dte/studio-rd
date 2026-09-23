// crm-webhook — STUDIO · CRM Fase 2 (24-sep-2026). Recibe los eventos de Zernio de WhatsApp, Instagram y Facebook.
// Réplica de whatsapp-webhook / instagram-webhook / social-webhook de BAYOL CELL en UNA sola función y un solo modelo
// (crm_canales / crm_conversaciones / crm_mensajes), con las correcciones de su auditoría:
//   · firma HMAC obligatoria (X-Zernio-Signature, secreto ZERNIO_WEBHOOK_SECRET); sin secreto se rechaza todo;
//   · el evento crudo se guarda PRIMERO (crm_webhook_eventos, único por id); un reintento de Zernio de un evento ya
//     procesado no hace nada; uno que falló se vuelve a procesar;
//   · la conversación es por CANAL + contacto; el mensaje es único por id del proveedor (no se duplica ni suma no leídos
//     dos veces); los estados de entrega solo avanzan (trigger en la base);
//   · si falla el procesamiento responde 500 para que Zernio reintente (Bayol respondía 200 aunque fallara);
//   · una cuenta desconocida se registra APAGADA en crm_canales y no se procesa hasta que el administrador la activa.
// Nunca envía mensajes: solo recibe y guarda.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("ZERNIO_WEBHOOK_SECRET") ?? "";
const ZERNIO_API_KEY = Deno.env.get("ZERNIO_API_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } }); }
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function firmaValida(raw: string, header: string | null): Promise<boolean> {
  if (!WEBHOOK_SECRET || !header) return false;
  const recibida = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const calc = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  if (calc.length !== recibida.length) return false;
  let d = 0; for (let i = 0; i < calc.length; i++) d |= calc.charCodeAt(i) ^ recibida.charCodeAt(i);
  return d === 0;
}

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
function esTelefono(s: unknown): boolean { const d = soloDigitos(s); return typeof s === "string" && /^\+?[\d\s\-()]{8,20}$/.test(s) && d.length >= 8 && d.length <= 15; }
function e164(s: unknown): string { let d = soloDigitos(s); if (d.length === 10) d = "1" + d; return "+" + d; }

// deno-lint-ignore no-explicit-any
type Any = any;
let orgCache: string | null = null;
async function organizacion(): Promise<string | null> {
  if (orgCache) return orgCache;
  const { data } = await db.from("pos_config").select("organizacion_id").limit(1).maybeSingle();
  orgCache = data?.organizacion_id ?? null;
  return orgCache;
}

function tipoAdjunto(t: string | undefined): string {
  const x = (t || "").toLowerCase();
  if (x.includes("image") || x.includes("sticker")) return "imagen";
  if (x.includes("audio") || x.includes("voice")) return "audio";
  if (x.includes("video")) return "video";
  if (x.includes("share")) return "compartido";
  return "documento";
}
async function guardarAdjunto(url: string, plataforma: string, tipo: string): Promise<string | null> {
  try {
    const abs = /^https?:\/\//i.test(url) ? url : `https://zernio.com${url.startsWith("/") ? "" : "/"}${url}`;
    const headers: Record<string, string> = {};
    if (plataforma === "whatsapp" && ZERNIO_API_KEY) headers.Authorization = `Bearer ${ZERNIO_API_KEY}`;   // WhatsApp exige el Bearer
    const r = await fetch(abs, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.error("adjunto: descarga fallida", r.status); return null; }
    const buf = await r.arrayBuffer();
    const ct = r.headers.get("content-type") || "application/octet-stream";
    const ext = ct.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const path = `entrantes/${plataforma}/${tipo}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from("crm-media").upload(path, buf, { contentType: ct, upsert: false });
    if (error) { console.error("adjunto: subida fallida", error.message); return null; }
    return path;
  } catch (e) { console.error("adjunto:", e instanceof Error ? e.message : String(e)); return null; }
}

function contactoDe(p: Any, plataforma: string, canales: Any[]): { id: string; tel: string | null } | null {
  const conv = p.conversation ?? {}, msg = p.message ?? {}, part = conv.participant ?? {};
  const entrante = msg.direction === "incoming" || p.event === "message.received";
  if (plataforma === "whatsapp") {
    let tel: string | null = null;
    if (esTelefono(conv.participantId)) tel = e164(conv.participantId);
    else if (esTelefono(conv.participantUsername)) tel = e164(conv.participantUsername);
    if (tel) {
      // Nunca crear una conversación con el número de una de nuestras propias líneas (fix v3 de Bayol).
      if (canales.some((c) => c.plataforma === "whatsapp" && c.identificador && soloDigitos(e164(c.identificador)) === soloDigitos(tel))) return null;
      return { id: tel, tel };
    }
    if (conv.contactId) return { id: `bsid:${conv.contactId}`, tel: null };
    if (entrante && msg.sender?.businessScopedUserId) return { id: `bsid:${msg.sender.businessScopedUserId}`, tel: null };
    return null;
  }
  const pid = conv.participantId ?? part.id ?? (entrante ? msg.sender?.id : null);
  if (!pid) return null;
  if (canales.some((c) => c.plataforma === plataforma && c.identificador && String(c.identificador) === String(pid))) return null;
  return { id: String(pid), tel: null };
}

async function procesarMensaje(p: Any, canal: Any, canales: Any[]) {
  const msg = p.message ?? {}, conv = p.conversation ?? {}, part = conv.participant ?? {};
  const plataforma = canal.plataforma as string;
  const entrante = msg.direction === "incoming" || p.event === "message.received";
  const contacto = contactoDe(p, plataforma, canales);
  if (!contacto) { console.error("mensaje sin contacto identificable; se descarta"); return; }
  const nombre = entrante ? (conv.participantName ?? part.name ?? msg.sender?.name ?? null) : null;
  const usuario = conv.participantUsername && !esTelefono(conv.participantUsername) ? conv.participantUsername : (part.username ?? null);
  const zConv = conv.id ?? msg.conversationId ?? null;

  // Conversación (canal + contacto).
  let { data: c } = await db.from("crm_conversaciones").select("id, crm_id, cliente_id, contacto_nombre, zernio_conversation_id").eq("canal_id", canal.id).eq("contacto_id", contacto.id).maybeSingle();
  let nueva = false;
  if (!c) {
    let clienteId: string | null = null;
    if (contacto.tel) { const { data: cid } = await db.rpc("crm_cliente_por_telefono", { p_tel: contacto.tel }); clienteId = cid ?? null; }
    const ins = await db.from("crm_conversaciones").insert({
      organizacion_id: canal.organizacion_id, canal_id: canal.id, plataforma, contacto_id: contacto.id, telefono_e164: contacto.tel,
      contacto_nombre: nombre, contacto_usuario: usuario, zernio_conversation_id: zConv, cliente_id: clienteId,
    }).select("id, crm_id, cliente_id, contacto_nombre, zernio_conversation_id").single();
    if (ins.error) {
      if (ins.error.code !== "23505") throw new Error("conversacion: " + ins.error.message);
      ({ data: c } = await db.from("crm_conversaciones").select("id, crm_id, cliente_id, contacto_nombre, zernio_conversation_id").eq("canal_id", canal.id).eq("contacto_id", contacto.id).single());
    } else { c = ins.data; nueva = true; }
  } else {
    const upd: Record<string, unknown> = {};
    if (nombre && !c.contacto_nombre) upd.contacto_nombre = nombre;
    if (zConv && zConv !== c.zernio_conversation_id) upd.zernio_conversation_id = zConv;
    if (usuario) upd.contacto_usuario = usuario;
    if (Object.keys(upd).length) await db.from("crm_conversaciones").update(upd).eq("id", c.id);
  }
  if (!c) throw new Error("conversacion no disponible");

  // Contenido.
  let tipo = "texto", mediaPath: string | null = null;
  const adj = Array.isArray(msg.attachments) ? msg.attachments : [];
  if (adj.length) { tipo = tipoAdjunto(adj[0].type || adj[0].originalType); if (adj[0].url) mediaPath = await guardarAdjunto(adj[0].url, plataforma, tipo); }
  const cuerpo: string = msg.text ?? msg.body ?? (p.metadata?.unsupported ? "[mensaje no soportado]" : "");
  const pid: string | null = msg.platformMessageId ?? msg.id ?? null;
  const cuando = p.timestamp ?? msg.timestamp ?? new Date().toISOString();

  if (!entrante && pid) {
    // Espejo de un envío hecho desde STUDIO que aún no tiene id del proveedor: se completa en vez de duplicarlo.
    const desde = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: propio } = await db.from("crm_mensajes").select("id").eq("conversacion_id", c.id).eq("direccion", "out").is("proveedor_msg_id", null)
      .eq("cuerpo", cuerpo).gte("created_at", desde).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (propio) { await db.from("crm_mensajes").update({ proveedor_msg_id: pid, estado: "enviado" }).eq("id", propio.id); return; }
  }
  const ins = await db.from("crm_mensajes").insert({
    organizacion_id: canal.organizacion_id, conversacion_id: c.id, direccion: entrante ? "in" : "out", tipo, cuerpo, media_path: mediaPath,
    proveedor_msg_id: pid, estado: entrante ? "recibido" : "enviado", desde_telefono: !entrante, created_at: cuando,
  });
  if (ins.error && ins.error.code !== "23505") throw new Error("mensaje: " + ins.error.message);

  // Primera vez que escribe: oportunidad nueva en el CRM (como los leads de Bayol), enlazada a la conversación.
  if (entrante && nueva && !c.crm_id) {
    const fuente = plataforma === "whatsapp" ? "WhatsApp" : plataforma === "instagram" ? "Instagram" : "Facebook";
    const quien = nombre || usuario || contacto.tel || "contacto";
    const op = await db.from("pos_crm").insert({
      organizacion_id: canal.organizacion_id, nombre: `${fuente} · ${quien}`.slice(0, 120), cliente_id: c.cliente_id, contacto: nombre,
      telefono: contacto.tel, fuente, interes: cuerpo ? cuerpo.slice(0, 200) : null, etapa: "nuevo",
    }).select("id").single();
    if (!op.error && op.data) await db.from("crm_conversaciones").update({ crm_id: op.data.id }).eq("id", c.id);
    else if (op.error) console.error("oportunidad automática:", op.error.message);
  }
}

async function procesarEstado(p: Any) {
  const msg = p.message ?? {};
  const ids = [msg.platformMessageId, msg.id].filter(Boolean);
  if (!ids.length) return;
  const estado = p.event === "message.failed" ? "fallido" : p.event === "message.read" ? "leido" : "entregado";
  const upd: Record<string, unknown> = { estado };
  if (estado === "fallido") upd.error = JSON.stringify(p.error ?? msg.error ?? "fallido").slice(0, 500);
  await db.from("crm_mensajes").update(upd).in("proveedor_msg_id", ids);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const raw = await req.text();
  if (!WEBHOOK_SECRET) return json({ ok: false, error: "webhook_secret_not_configured" }, 503);
  if (!(await firmaValida(raw, req.headers.get("X-Zernio-Signature")))) return json({ ok: false, error: "invalid_signature" }, 401);
  let p: Any; try { p = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const eventoId = String(p.id ?? p.eventId ?? hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
  const msg = p.message ?? {};
  const accountId: string | null = p.account?.id ?? p.account?.accountId ?? msg.accountId ?? null;
  const plataforma: string | null = p.account?.platform ?? msg.platform ?? null;

  // 1) Guardar el evento crudo antes de nada.
  const ev = await db.from("crm_webhook_eventos").insert({ evento_id: eventoId, evento: p.event ?? null, plataforma, zernio_account_id: accountId, payload: p }).select("id").single();
  let eventoRow = ev.data?.id as string | undefined;
  if (ev.error) {
    if (ev.error.code !== "23505") return json({ ok: false, error: "event_store_failed" }, 500);
    const prev = await db.from("crm_webhook_eventos").select("id, procesado_at").eq("evento_id", eventoId).single();
    if (prev.data?.procesado_at) return json({ ok: true, deduplicated: true });
    eventoRow = prev.data?.id;
  }
  const cerrar = (error: string | null) => db.from("crm_webhook_eventos").update({ procesado_at: new Date().toISOString(), error }).eq("id", eventoRow!);

  try {
    if (!accountId || !plataforma || !["whatsapp", "instagram", "facebook"].includes(plataforma)) { await cerrar("ignorado: plataforma o cuenta"); return json({ ok: true, ignored: true }); }
    const { data: canales } = await db.from("crm_canales").select("*");
    let canal = (canales ?? []).find((c: Any) => c.zernio_account_id === accountId);
    if (!canal) {
      const org = await organizacion();
      if (!org) throw new Error("sin organización");
      const a = p.account ?? {};
      const nuevo = await db.from("crm_canales").insert({ organizacion_id: org, plataforma, zernio_account_id: accountId, nombre: a.name ?? a.displayName ?? a.username ?? null,
        identificador: a.phoneNumber ?? a.username ?? a.platformUserId ?? null, activo: false }).select("*").single();
      if (nuevo.error && nuevo.error.code !== "23505") throw new Error("canal: " + nuevo.error.message);
      await cerrar("canal nuevo registrado apagado"); return json({ ok: true, canal_nuevo: true });
    }
    await db.from("crm_canales").update({ ultimo_evento_at: new Date().toISOString() }).eq("id", canal.id);
    if (!canal.activo) { await cerrar("canal apagado"); return json({ ok: true, canal_apagado: true }); }

    const evento = String(p.event ?? "");
    if (evento === "message.received" || evento === "message.sent") await procesarMensaje(p, canal, canales ?? []);
    else if (evento === "message.delivered" || evento === "message.read" || evento === "message.failed") await procesarEstado(p);
    else { await cerrar("evento no manejado: " + evento); return json({ ok: true, ignored: true }); }
    await cerrar(null);
    return json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("crm-webhook:", m);
    await db.from("crm_webhook_eventos").update({ error: m.slice(0, 500) }).eq("id", eventoRow!);
    return json({ ok: false, error: "processing_failed" }, 500);   // Zernio reintenta; el evento se reprocesa
  }
});
