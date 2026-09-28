// crm-sincronizar — STUDIO (28-sep-2026). Trae a la bandeja las conversaciones que Zernio ya conserva de un canal
// (incluido el historial del WhatsApp Business del teléfono, sincronizado al conectar en modo coexistencia) e Instagram.
// Réplica de whatsapp-importar-historial de BAYOL CELL con estas diferencias:
//   · solo admin/gerente (Bayol no pedía sesión);
//   · no duplica: un mensaje ya guardado por el webhook (mismo id del proveedor) se salta;
//   · no crea leads, no suma «no leídos» ni desarchiva: al terminar cada chat se restauran esos valores y la vista previa
//     queda con el mensaje más reciente (el trigger crm_msg_resumen los toca al insertar);
//   · los adjuntos viejos no se descargan: quedan como «[Foto del historial]», igual que en Bayol.
// Nunca envía nada. Paginado: el navegador llama de nuevo con `cursor` hasta que no haya más.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ZERNIO_API_KEY = Deno.env.get("ZERNIO_API_KEY") ?? "";
const API = "https://zernio.com/api/v1";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
// deno-lint-ignore no-explicit-any
type Any = any;

async function zget(path: string, q: Record<string, string | number | undefined>) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${ZERNIO_API_KEY}` }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Zernio ${r.status}`);
  return j;
}
const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
function esTelefono(s: unknown) { const d = soloDigitos(s); return typeof s === "string" && /^\+?[\d\s\-()]{8,20}$/.test(s) && d.length >= 8 && d.length <= 15; }
function e164(s: unknown) { let d = soloDigitos(s); if (d.length === 10) d = "1" + d; return "+" + d; }
function fecha(v: unknown) { const d = new Date(String(v ?? "")); return isNaN(d.getTime()) ? null : d.toISOString(); }

// Mismo identificador de contacto que usa crm-webhook, para que el chat importado y los mensajes nuevos coincidan.
function contactoDe(conv: Any, plataforma: string, canales: Any[]): { id: string; tel: string | null } | null {
  if (plataforma === "whatsapp") {
    const cand = [conv.participantId, conv.participantUsername, conv.platformConversationId].find((x) => esTelefono(x));
    if (cand) {
      const tel = e164(cand);
      if (canales.some((c) => c.plataforma === "whatsapp" && c.identificador && soloDigitos(e164(c.identificador)) === soloDigitos(tel))) return null;
      return { id: tel, tel };
    }
    if (conv.contactId) return { id: `bsid:${conv.contactId}`, tel: null };
    return conv.participantId ? { id: `bsid:${conv.participantId}`, tel: null } : null;
  }
  const pid = conv.participantId ?? conv.participant?.id;
  if (!pid) return null;
  if (canales.some((c) => c.plataforma === plataforma && c.identificador && String(c.identificador) === String(pid))) return null;
  return { id: String(pid), tel: null };
}
function contenido(m: Any) {
  const t = String(m?.message ?? m?.text ?? "").trim();
  const a = Array.isArray(m?.attachments) ? m.attachments[0] : null;
  const tipo = ({ image: "imagen", sticker: "imagen", video: "video", audio: "audio", file: "documento" } as Record<string, string>)[String(a?.type ?? "").toLowerCase()] ?? "texto";
  if (t) return { tipo, cuerpo: t === "[Unsupported message]" ? "[Contenido no visible]" : t };
  const n: Record<string, string> = { imagen: "[Foto del historial]", video: "[Video del historial]", audio: "[Audio del historial]", documento: a?.filename ? `[Documento: ${a.filename}]` : "[Documento del historial]" };
  return { tipo, cuerpo: n[tipo] ?? "[Mensaje del historial]" };
}
function estado(m: Any, dir: string) {
  if (dir === "in") return "recibido";
  const e = String(m?.deliveryStatus ?? "sent").toLowerCase();
  return e === "delivered" ? "entregado" : e === "read" ? "leido" : e === "failed" ? "fallido" : "enviado";
}

async function importarChat(canal: Any, conv: Any, canales: Any[]) {
  const ct = contactoDe(conv, canal.plataforma, canales);
  if (!ct) return { ok: false, motivo: "sin_contacto" };
  let { data: c } = await db.from("crm_conversaciones").select("id, no_leidos, archivada").eq("canal_id", canal.id).eq("contacto_id", ct.id).maybeSingle();
  const previo = c ? { no_leidos: c.no_leidos, archivada: c.archivada } : { no_leidos: 0, archivada: conv.status === "archived" };
  if (!c) {
    let clienteId: string | null = null;
    if (ct.tel) { const { data: cid } = await db.rpc("crm_cliente_por_telefono", { p_tel: ct.tel }); clienteId = cid ?? null; }
    const ins = await db.from("crm_conversaciones").insert({
      organizacion_id: canal.organizacion_id, canal_id: canal.id, plataforma: canal.plataforma, contacto_id: ct.id, telefono_e164: ct.tel,
      contacto_nombre: conv.participantName ?? null, contacto_usuario: conv.participantUsername && !esTelefono(conv.participantUsername) ? conv.participantUsername : null,
      zernio_conversation_id: conv.id, cliente_id: clienteId, archivada: previo.archivada,
    }).select("id, no_leidos, archivada").single();
    if (ins.error) {
      if (ins.error.code !== "23505") throw new Error("conversacion: " + ins.error.message);
      ({ data: c } = await db.from("crm_conversaciones").select("id, no_leidos, archivada").eq("canal_id", canal.id).eq("contacto_id", ct.id).single());
    } else c = ins.data;
  } else if (conv.id) {
    await db.from("crm_conversaciones").update({ zernio_conversation_id: conv.id }).eq("id", c.id).is("zernio_conversation_id", null);
  }
  if (!c) throw new Error("conversacion no disponible");

  let cursor: string | undefined, paginas = 0, vistos = 0, nuevos = 0;
  do {
    const r = await zget(`/inbox/conversations/${encodeURIComponent(conv.id)}/messages`, { accountId: canal.zernio_account_id, limit: 100, sortOrder: "desc", cursor });
    const msgs: Any[] = Array.isArray(r?.messages) ? r.messages : Array.isArray(r?.data) ? r.data : [];
    vistos += msgs.length;
    const filas = msgs.flatMap((m) => {
      const cuando = fecha(m?.createdAt ?? m?.sentAt ?? m?.timestamp), pid = m?.platformMessageId ?? m?.id;
      if (!pid || !cuando) return [];
      const dir = m.direction === "outgoing" || m.direction === "out" ? "out" : "in", k = contenido(m);
      return [{ organizacion_id: canal.organizacion_id, conversacion_id: c!.id, direccion: dir, tipo: k.tipo, cuerpo: k.cuerpo, proveedor_msg_id: String(pid),
        estado: estado(m, dir), error: m?.deliveryError?.message ?? null, desde_telefono: dir === "out", created_at: cuando, _alt: m?.id ? String(m.id) : null }];
    });
    if (filas.length) {
      // No duplicar: se saltan los que ya están (por id del proveedor o por el id de Zernio).
      const ids = [...new Set(filas.flatMap((f) => [f.proveedor_msg_id, f._alt]).filter(Boolean))] as string[];
      const { data: ya } = await db.from("crm_mensajes").select("proveedor_msg_id").in("proveedor_msg_id", ids);
      const hay = new Set((ya ?? []).map((x: Any) => String(x.proveedor_msg_id)));
      // Segunda red: el mismo mensaje pudo guardarse por el webhook con otro id (wamid vs id de Zernio): mismo sentido,
      // mismo texto y hora con menos de 2 min de diferencia = ya existe.
      const tiempos = filas.map((f) => new Date(f.created_at).getTime());
      const { data: cerca } = await db.from("crm_mensajes").select("direccion, cuerpo, created_at").eq("conversacion_id", c!.id)
        .gte("created_at", new Date(Math.min(...tiempos) - 120000).toISOString()).lte("created_at", new Date(Math.max(...tiempos) + 120000).toISOString());
      const igual = (f: Any) => (cerca ?? []).some((x: Any) => x.direccion === f.direccion && String(x.cuerpo ?? "") === String(f.cuerpo ?? "") && Math.abs(new Date(x.created_at).getTime() - new Date(f.created_at).getTime()) < 120000);
      const nuevas = filas.filter((f) => !hay.has(f.proveedor_msg_id) && !(f._alt && hay.has(f._alt)) && !igual(f)).map(({ _alt, ...f }) => f);
      for (const f of nuevas) {
        const ins = await db.from("crm_mensajes").insert(f);
        if (!ins.error) nuevos++; else if (ins.error.code !== "23505") throw new Error("mensaje: " + ins.error.message);
      }
    }
    paginas++;
    cursor = r?.pagination?.hasMore && r?.pagination?.nextCursor ? String(r.pagination.nextCursor) : undefined;
  } while (cursor && paginas < 20);

  // El trigger de resumen sumó «no leídos», desarchivó y dejó de vista previa el último INSERTADO (no el más reciente).
  const { data: ult } = await db.from("crm_mensajes").select("cuerpo, tipo").eq("conversacion_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  await db.from("crm_conversaciones").update({
    no_leidos: previo.no_leidos, archivada: previo.archivada,
    ...(ult ? { ultimo_mensaje_preview: String(ult.cuerpo || `[${ult.tipo}]`).slice(0, 200) } : {}),
    ...(conv.participantName ? { contacto_nombre: conv.participantName } : {}),
  }).eq("id", c.id);
  return { ok: true, vistos, nuevos, truncado: !!cursor };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await userDb.auth.getUser();
  if (!u?.user) return json({ ok: false, error: "no_autenticado" }, 401);
  const { data: rol } = await userDb.rpc("mi_rol");
  if (!["admin", "gerente"].includes(String(rol ?? ""))) return json({ ok: false, error: "sin_permiso", mensaje: "Solo el administrador o el gerente pueden sincronizar." }, 403);
  if (!ZERNIO_API_KEY) return json({ ok: false, error: "sin_configurar" }, 503);

  let b: Any = {}; try { b = await req.json(); } catch { /* opcional */ }
  const canalId = String(b.canal_id ?? ""), cursor = b.cursor ? String(b.cursor) : undefined;
  const limite = Math.max(1, Math.min(Number(b.limit) || 8, 15));
  const { data: canales } = await db.from("crm_canales").select("*");
  const activos = (canales ?? []).filter((c: Any) => c.activo && ["whatsapp", "instagram", "facebook"].includes(c.plataforma));
  if (!canalId) return json({ ok: true, canales: activos.map((c: Any) => ({ id: c.id, plataforma: c.plataforma, nombre: c.nombre })) });
  const canal = activos.find((c: Any) => String(c.id) === canalId);
  if (!canal) return json({ ok: false, error: "canal_no_disponible", mensaje: "El canal no existe o está apagado." }, 404);

  try {
    const r = await zget("/inbox/conversations", { accountId: canal.zernio_account_id, platform: canal.plataforma, limit: limite, sortOrder: "desc", cursor });
    const lista: Any[] = Array.isArray(r?.data) ? r.data : Array.isArray(r?.conversations) ? r.conversations : [];
    let chats = 0, vistos = 0, nuevos = 0, truncados = 0, omitidos = 0;
    for (const conv of lista) {
      if (!conv?.id || (conv.accountId && conv.accountId !== canal.zernio_account_id)) { omitidos++; continue; }
      const x = await importarChat(canal, conv, canales ?? []);
      if (!x.ok) { omitidos++; continue; }
      chats++; vistos += x.vistos ?? 0; nuevos += x.nuevos ?? 0; if (x.truncado) truncados++;
    }
    return json({ ok: true, canal: canal.nombre, chats, mensajes_leidos: vistos, mensajes_nuevos: nuevos, omitidos, truncados,
      siguiente_cursor: r?.pagination?.hasMore ? (r.pagination.nextCursor ?? null) : null });
  } catch (e) {
    console.error("crm-sincronizar:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "zernio_error", mensaje: "No se pudo leer el historial de Zernio." }, 502);
  }
});
