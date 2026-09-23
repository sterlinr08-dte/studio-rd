import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// STUDIO · Crea un usuario de STAFF del POS (cajero/vendedor/gerente) en la MISMA organización
// del que llama. Solo un ADMIN logueado puede llamar (verify_jwt + chequeo de rol).
// Copia fiel de la función de NEXUS PRO (v7); en STUDIO faltaba y «Crear usuario» daba 404.
// Desplegada en edbknlkjnlfmkkiizdbe el 2026-09-23 (verify_jwt = true).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(jwt);
    if (!caller?.user) return Response.json({ error: "No autorizado" }, { status: 401, headers: CORS });

    const { data: perfil } = await admin.from("profiles").select("rol, usuario_sistema_id").eq("id", caller.user.id).single();
    if (!perfil || perfil.rol !== "admin") return Response.json({ error: "Solo el administrador puede crear usuarios" }, { status: 403, headers: CORS });
    const { data: us } = await admin.from("usuarios_sistema").select("organizacion_id").eq("id", perfil.usuario_sistema_id).single();
    const orgId = us?.organizacion_id;
    if (!orgId) return Response.json({ error: "El administrador no tiene organización" }, { status: 400, headers: CORS });

    const { nombre, login, clave, rol, almacen_id } = await req.json();
    const lg = String(login || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!nombre || !lg || !clave) return Response.json({ error: "Faltan nombre, usuario o clave" }, { status: 400, headers: CORS });
    if (String(clave).length < 6) return Response.json({ error: "La clave debe tener al menos 6 caracteres" }, { status: 400, headers: CORS });
    const rolStaff = ["gerente", "cajero", "vendedor", "admin"].includes(rol) ? rol : "cajero";

    const { data: existe } = await admin.from("usuarios_sistema").select("id").eq("login", lg).limit(1);
    if (existe && existe.length) return Response.json({ error: "Ese usuario ya existe, elige otro" }, { status: 409, headers: CORS });

    const email = lg + "@nexus-pro.local";
    const { data: nuevo, error: eAuth } = await admin.auth.admin.createUser({ email, password: String(clave), email_confirm: true });
    if (eAuth || !nuevo?.user) return Response.json({ error: "Auth: " + (eAuth?.message || "no se pudo crear") }, { status: 500, headers: CORS });

    const { data: usNuevo, error: eUs } = await admin.from("usuarios_sistema")
      .insert({ nom: String(nombre).toUpperCase(), cargo: rolStaff, login: lg, rol: rolStaff, activo: true, organizacion_id: orgId, almacen_id: almacen_id || null })
      .select().single();
    if (eUs) { await admin.auth.admin.deleteUser(nuevo.user.id); return Response.json({ error: "usuarios_sistema: " + eUs.message }, { status: 500, headers: CORS }); }

    const { error: eProf } = await admin.from("profiles")
      .insert({ id: nuevo.user.id, usuario_sistema_id: usNuevo.id, login: lg, nom: String(nombre).toUpperCase(), rol: rolStaff, activo: true, must_change_password: false });
    if (eProf) { await admin.auth.admin.deleteUser(nuevo.user.id); await admin.from("usuarios_sistema").delete().eq("id", usNuevo.id); return Response.json({ error: "profiles: " + eProf.message }, { status: 500, headers: CORS }); }

    return Response.json({ ok: true, login: lg, rol: rolStaff }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500, headers: CORS });
  }
});
