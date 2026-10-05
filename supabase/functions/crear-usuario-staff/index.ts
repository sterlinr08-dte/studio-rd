import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// STUDIO · Usuarios de STAFF del POS en la MISMA organización del que llama. Solo un ADMIN logueado puede llamar
// (verify_jwt + chequeo de rol). Desplegada en edbknlkjnlfmkkiizdbe el 2026-09-23 (verify_jwt = true).
// 02-oct-2026 (Configuración → Equipo): además de crear, ahora edita (nombre, rol, almacén), desactiva/reactiva y
// cambia la clave. Acepta los roles personalizados de Permisos por rol (antes los convertía en «cajero»).
// Reglas: nadie se cambia su propio rol ni se desactiva; nunca se queda la empresa sin un administrador activo;
// solo usuarios de la misma empresa; cada acción queda en auditoría.
// 05-oct-2026 (v4, «Usuarios y acceso»): crear y actualizar guardan también el WhatsApp del empleado (telefono,
// migración 46) y las funciones del CRM en el MISMO paso (antes era una segunda llamada que podía fallar a medias);
// crear devuelve el id; nueva acción «accesos»: última entrada de cada usuario (auth.users.last_sign_in_at).
const PRESET = ["admin", "gerente", "cajero", "vendedor"];
const json = (o: unknown, status = 200) => Response.json(o, { status, headers: CORS });
const CANALES = ["whatsapp", "instagram", "facebook"];
// Funciones del CRM con las mismas reglas que crm_guardar_funciones (migración 44). undefined = no tocar.
const crmDe = (v: unknown) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const o = v as { canales?: unknown; transferir?: unknown };
  const can = Array.isArray(o.canales) ? [...new Set(o.canales.map(String).filter((c) => CANALES.includes(c)))] : [];
  return { canales: can, transferir: o.transferir !== false };
};
// Solo dígitos; vacío = sin teléfono. undefined = no tocar.
const telDe = (v: unknown) => v === undefined ? undefined : (String(v ?? "").replace(/\D/g, "").slice(0, 15) || null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(jwt);
    if (!caller?.user) return json({ error: "No autorizado" }, 401);

    const { data: perfil } = await admin.from("profiles").select("rol, usuario_sistema_id, nom, activo").eq("id", caller.user.id).single();
    if (!perfil || perfil.rol !== "admin" || perfil.activo === false) return json({ error: "Solo el administrador puede manejar usuarios" }, 403);
    const { data: us } = await admin.from("usuarios_sistema").select("organizacion_id").eq("id", perfil.usuario_sistema_id).single();
    const orgId = us?.organizacion_id;
    if (!orgId) return json({ error: "El administrador no tiene organización" }, 400);

    const body = await req.json();
    const accion = String(body.accion || "crear");

    const rolValido = async (rol: string) => {
      if (PRESET.includes(rol)) return true;
      const { data } = await admin.from("pos_acceso").select("rol").eq("organizacion_id", orgId).eq("rol", rol).limit(1);
      return !!(data && data.length);
    };
    const auditar = async (accionAud: string, detalle: string, entidad: string | null, antes: unknown = null, despues: unknown = null) => {
      await admin.from("auditoria").insert({
        ts: new Date().toISOString(), usuario: perfil.nom || "admin", rol: "admin", accion: accionAud, detalle, modulo: "Usuarios",
        user_id: caller.user.id, entity_table: "usuarios_sistema", entity_id: entidad, organizacion_id: orgId, origen: "servidor",
        old_data: antes ? JSON.stringify(antes) : null, new_data: despues ? JSON.stringify(despues) : null,
      });
    };

    if (accion === "crear") {
      const { nombre, login, clave, rol, almacen_id, pedir_cambio } = body;
      const telefono = telDe(body.telefono), crm = crmDe(body.crm_funciones);
      const lg = String(login || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!nombre || !lg || !clave) return json({ error: "Faltan nombre, usuario o clave" }, 400);
      if (String(clave).length < 6) return json({ error: "La clave debe tener al menos 6 caracteres" }, 400);
      const rolStaff = rol && await rolValido(String(rol)) ? String(rol) : "cajero";

      const { data: existe } = await admin.from("usuarios_sistema").select("id").eq("login", lg).limit(1);
      if (existe && existe.length) return json({ error: "Ese usuario ya existe, elige otro" }, 409);

      const email = lg + "@nexus-pro.local";
      const { data: nuevo, error: eAuth } = await admin.auth.admin.createUser({ email, password: String(clave), email_confirm: true });
      if (eAuth || !nuevo?.user) return json({ error: "Auth: " + (eAuth?.message || "no se pudo crear") }, 500);

      const { data: usNuevo, error: eUs } = await admin.from("usuarios_sistema")
        .insert({ nom: String(nombre).toUpperCase(), cargo: rolStaff, login: lg, rol: rolStaff, activo: true, organizacion_id: orgId, almacen_id: almacen_id || null,
          ...(telefono !== undefined ? { telefono } : {}), ...(crm !== undefined ? { crm_funciones: crm } : {}), creado_por: perfil.nom || "admin" })
        .select().single();
      if (eUs) { await admin.auth.admin.deleteUser(nuevo.user.id); return json({ error: "usuarios_sistema: " + eUs.message }, 500); }

      const { error: eProf } = await admin.from("profiles")
        .insert({ id: nuevo.user.id, usuario_sistema_id: usNuevo.id, login: lg, nom: String(nombre).toUpperCase(), rol: rolStaff, activo: true, must_change_password: pedir_cambio === true });
      if (eProf) { await admin.auth.admin.deleteUser(nuevo.user.id); await admin.from("usuarios_sistema").delete().eq("id", usNuevo.id); return json({ error: "profiles: " + eProf.message }, 500); }

      await auditar("USUARIO_CREADO", `${String(nombre).toUpperCase()} · usuario ${lg} · rol ${rolStaff}`, usNuevo.id, null, { rol: rolStaff, almacen_id: almacen_id || null });
      return json({ ok: true, id: usNuevo.id, login: lg, rol: rolStaff });
    }

    // Última entrada de cada usuario de la empresa (para la lista). Solo lectura.
    if (accion === "accesos") {
      const { data: us } = await admin.from("usuarios_sistema").select("id").eq("organizacion_id", orgId);
      const ids = (us || []).map((u) => u.id);
      if (!ids.length) return json({ ok: true, accesos: [] });
      const { data: profs } = await admin.from("profiles").select("id, usuario_sistema_id, must_change_password").in("usuario_sistema_id", ids);
      const accesos = [];
      for (const p of profs || []) {
        const { data: au } = await admin.auth.admin.getUserById(p.id);
        accesos.push({ usuario_id: p.usuario_sistema_id, ultimo_acceso: au?.user?.last_sign_in_at || null, debe_cambiar_clave: p.must_change_password === true });
      }
      return json({ ok: true, accesos });
    }

    // Acciones sobre un usuario existente de la MISMA empresa.
    const usuarioId = String(body.usuario_id || "");
    const { data: obj } = await admin.from("usuarios_sistema").select("id, nom, login, rol, activo, almacen_id, organizacion_id").eq("id", usuarioId).maybeSingle();
    if (!obj || obj.organizacion_id !== orgId) return json({ error: "Ese usuario no es de tu empresa" }, 404);
    const { data: prof } = await admin.from("profiles").select("id").eq("usuario_sistema_id", obj.id).maybeSingle();
    const esYo = obj.id === perfil.usuario_sistema_id;
    const otrosAdminsActivos = async () => {
      const { data } = await admin.from("usuarios_sistema").select("id").eq("organizacion_id", orgId).eq("rol", "admin").eq("activo", true).neq("id", obj.id);
      return (data || []).length;
    };

    if (accion === "actualizar") {
      const cambios: Record<string, unknown> = {};
      if (body.nombre !== undefined) { const n = String(body.nombre || "").trim(); if (!n) return json({ error: "Pon el nombre" }, 400); cambios.nom = n.toUpperCase(); }
      if (body.almacen_id !== undefined) cambios.almacen_id = body.almacen_id || null;
      const tel = telDe(body.telefono); if (tel !== undefined) cambios.telefono = tel;
      const crm = crmDe(body.crm_funciones); if (crm !== undefined) cambios.crm_funciones = crm;
      if (body.rol !== undefined && body.rol !== obj.rol) {
        if (esYo) return json({ error: "No puedes cambiar tu propio rol" }, 400);
        if (!(await rolValido(String(body.rol)))) return json({ error: "Ese rol no existe" }, 400);
        if (obj.rol === "admin" && obj.activo !== false && (await otrosAdminsActivos()) === 0) return json({ error: "Es el único administrador: la empresa se quedaría sin administrador" }, 400);
        cambios.rol = String(body.rol); cambios.cargo = String(body.rol);
      }
      if (!Object.keys(cambios).length) return json({ ok: true, sin_cambios: true });
      const { error: e1 } = await admin.from("usuarios_sistema").update({ ...cambios, actualizado_por: perfil.nom || "admin", updated_at: new Date().toISOString() }).eq("id", obj.id);
      if (e1) return json({ error: "usuarios_sistema: " + e1.message }, 500);
      if (prof) {
        const pc: Record<string, unknown> = {}; if (cambios.nom) pc.nom = cambios.nom; if (cambios.rol) pc.rol = cambios.rol;
        if (Object.keys(pc).length) { const { error: e2 } = await admin.from("profiles").update(pc).eq("id", prof.id); if (e2) return json({ error: "profiles: " + e2.message }, 500); }
      }
      const auditables = { ...cambios }; if ("telefono" in auditables) auditables.telefono = auditables.telefono ? "(cambiado)" : null;
      await auditar("USUARIO_EDITADO", `${obj.nom} (@${obj.login})`, obj.id, { nom: obj.nom, rol: obj.rol, almacen_id: obj.almacen_id }, auditables);
      return json({ ok: true });
    }

    if (accion === "desactivar" || accion === "reactivar") {
      const activar = accion === "reactivar";
      if (esYo) return json({ error: "No puedes desactivarte a ti mismo" }, 400);
      if (!activar && obj.rol === "admin" && (await otrosAdminsActivos()) === 0) return json({ error: "Es el único administrador activo" }, 400);
      const { error: e1 } = await admin.from("usuarios_sistema").update({ activo: activar, actualizado_por: perfil.nom || "admin", updated_at: new Date().toISOString() }).eq("id", obj.id);
      if (e1) return json({ error: "usuarios_sistema: " + e1.message }, 500);
      if (prof) {
        const { error: e2 } = await admin.from("profiles").update({ activo: activar }).eq("id", prof.id);
        if (e2) return json({ error: "profiles: " + e2.message }, 500);
        // Bloquea también la entrada (y las sesiones nuevas). La base ya no le da rol aunque tenga una sesión abierta.
        const { error: e3 } = await admin.auth.admin.updateUserById(prof.id, { ban_duration: activar ? "none" : "876000h" });
        if (e3) console.error("ban:", e3.message);
      }
      await auditar(activar ? "USUARIO_REACTIVADO" : "USUARIO_DESACTIVADO", `${obj.nom} (@${obj.login})`, obj.id, { activo: obj.activo }, { activo: activar });
      return json({ ok: true });
    }

    if (accion === "clave") {
      const clave = String(body.clave || "");
      if (clave.length < 6) return json({ error: "La clave debe tener al menos 6 caracteres" }, 400);
      if (!prof) return json({ error: "Ese usuario no tiene acceso creado" }, 400);
      const { error: e1 } = await admin.auth.admin.updateUserById(prof.id, { password: clave });
      if (e1) return json({ error: "Auth: " + e1.message }, 500);
      await admin.from("profiles").update({ must_change_password: body.pedir_cambio === true && !esYo }).eq("id", prof.id);
      await auditar("USUARIO_CLAVE", `Clave cambiada a ${obj.nom} (@${obj.login})${body.pedir_cambio === true && !esYo ? " · deberá cambiarla al entrar" : ""}`, obj.id);
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
