---
name: studio-automatizaciones
description: Reglas vivas de las automatizaciones de STUDIO (personas Entidad ↔ Empleado ↔ Usuario, códigos automáticos, vendedores y técnicos desde empleados, buscador de listas) y cómo agregar una nueva sin romperlas. Úsala antes de tocar Entidades, Clientes, RRHH, Usuarios, Vendedores, Técnicos, códigos o listas con buscador.
---

# Automatizaciones de STUDIO

Dueño, 06-oct-2026: «guárdalo en el .md para que lo tenga pendiente como skill las automatizaciones».
Este archivo es la fuente de verdad de **qué hace el sistema solo**. Antes de cambiar uno de estos módulos, léelo. Si
agregas o cambias una automatización, actualiza este archivo en el mismo PR y deja la bitácora como siempre.

## 1. Lo que ya está automatizado (en producción)

### Una persona, una ficha — migración 49 (59.90)
Lo hacen **disparadores en la base**, no la pantalla. No dupliques esta lógica en el navegador.

| Cuando… | El sistema hace solo… |
|---|---|
| Se crea un empleado en RRHH | Crea su Entidad (`pos_clientes`): código `EM-` + código del empleado, marcada Empleado, **no** Cliente. Las enlaza (`rrhh_empleados.entidad_id`). |
| Se marca una Entidad como «Empleado» | Crea su ficha en RRHH. La Entidad toma `EM-` + el código del empleado si no tenía código propio. |
| Cambian nombre, cédula o teléfono (en cualquiera de las dos) | Se copian a la otra ficha. |
| Se le quita «Empleado» a una Entidad | Su ficha de RRHH queda inactiva, y con eso pasa lo de la fila siguiente. |
| Se desactiva un empleado | Su usuario y su perfil quedan inactivos: `mi_rol()` devuelve nulo y la RLS le cierra los datos. La pantalla además llama a `crear-usuario-staff` → `desactivar`, que bloquea el login. **Nunca** deja la empresa sin un administrador activo. |
| Se reactiva un empleado | **No** devuelve el acceso solo. Eso lo decide el administrador en Ajustes → Usuarios. |
| Se crea un usuario sin empleado | Crea su empleado y, por la primera fila, su Entidad. |

- **Disparadores:**
  - `trg_persona_empleado_entidad` y `trg_persona_quita_acceso` en `rrhh_empleados`;
  - `trg_persona_entidad_empleado` en `pos_clientes`;
  - `trg_persona_usuario_empleado` en `usuarios_sistema`.
- **Freno anti-rebote:** `nx.sync_persona` (`set_config(..., true)`, local a la transacción), leído con `nx_sync_activo()`.
- **`pos_personal()`** (SECURITY DEFINER, solo `authenticated`): empleados con código, usuario, rol, `comision_pct` y `soy_yo`, **sin salarios**. Es la lista de personal para cualquier pantalla. No leas `rrhh_empleados` ni `usuarios_sistema` para listas: el segundo solo lo lee el administrador.

### Clientes — migración 50 (59.91)
- **Código automático en la base** (`trg_zcodigo_pos_clientes`): Entidad sin código → cliente `C-00450`…, suplidor `PR-0001`…, banco `BC-0001`… (empleado `EM-`, migración 49). Índice único `pos_clientes_codigo_unico`. Editar con el código vacío lo conserva. La pantalla ya no calcula códigos: `entCodigoAuto()` devuelve null.
- **Cédula repetida** (`trg_zcedula_pos_clientes`): no se puede crear ni poner a un cliente activo una cédula de 9+ dígitos que ya tiene otro cliente activo (`CLIENTE_CEDULA_DUPLICADA`, el detalle trae «código · nombre»). Los duplicados viejos se pueden seguir editando hasta unirlos. El teléfono repetido solo avisa (pantalla).
- **Chats de WhatsApp ↔ Cliente** por los últimos 10 dígitos (`nx_tel10`): un chat nuevo toma el cliente de su teléfono (`trg_zcliente_crm_conv`), y un cliente nuevo o con teléfono corregido recibe sus chats sin enlazar (`trg_zchats_pos_clientes`). Si dos clientes comparten teléfono, no se adivina. Instagram no trae teléfono: esos chats se enlazan a mano desde el chat.
- **`pos_clientes_duplicados()`** (admin y gerente): grupos por cédula, teléfono (sin los de relleno como 809-000-0000) o nombre, con ventas, abonos y chats.
- **`pos_unir_clientes(queda, quitar[])`** (solo admin):
  - pasa `cliente_id` en 17 tablas (ventas, fiado, abonos, apartados, cotizaciones, prefacturas, suspendidas, devoluciones, documentos, crédito, financiamientos, solicitudes, documentos y referencias de financiamiento, CRM, chats), y el perfil de financiamiento si la que queda no tiene;
  - completa los datos vacíos de la que queda;
  - deja las otras **inactivas** con la nota «Unido a C-…»;
  - registra `CLIENTES_UNIDOS` en auditoría;
  - no cambia montos; no une Entidades de empleado.
  - Usa `nx.fin_rpc` y `nx.unir_clientes`; `nx_validar_caja_propietario` deja editar el cliente de una venta o abono de caja cerrada **solo** con ese aviso y sin cambiar la caja.
- **Pantalla:** «Revisar duplicados» en Clientes y Entidades. Queda marcada por defecto la ficha con más ventas, luego más abonos, luego la que tiene cédula y luego la más vieja. Se confirma grupo por grupo.

### Vendedores y técnicos = empleados (59.90)
- **Al cobrar:**
  - el vendedor es automáticamente el empleado de quien cobra (`soy_yo`);
  - la venta guarda `vendedor_id` = id del empleado y `vendedor_nombre`;
  - las opciones se ven «005 · ERIKA REYES».
- **Comisión:** el % vive en `rrhh_empleados.comision_pct` (RRHH o Ajustes → Empleados → Vendedores). El % propio del artículo manda sobre el del empleado.
- **Técnicos:**
  - Reparaciones: el técnico se elige de los empleados; se guarda el nombre en `pos_reparaciones.tecnico`.
  - Reacondicionado: técnicos = empleados con usuario; `id` = usuario, por la FK a `usuarios_sistema`.
- `pos_vendedores` quedó **sin uso**. Solo es respaldo si `pos_personal()` no existe. No la borres sin autorización.

### Códigos automáticos — migración 48 (59.89)
- **Artículos:**
  - sin código reciben el siguiente `PRD-00xxxx`;
  - el escrito a mano se respeta pero no puede repetirse (`pos_productos_codigo_unico`, sin distinguir mayúsculas);
  - editar con el campo vacío conserva el código;
  - los 157 códigos viejos (`1002`, `CAST-…`) no se tocan.
- **Empleados:** `001`, `002`… por orden; el siguiente lo pone la base (`rrhh_empleados_codigo_unico`).
- **Entidades de empleado:** `EM-` + código del empleado.
- **Clientes:** `C-00050`… del sistema anterior, y `CL-0001` desde la pantalla (`entCodigoAuto`). Todavía en el navegador: ver §3.
- El número lo calcula la base con un candado por organización (`pg_advisory_xact_lock`): dos altas al mismo tiempo no reciben el mismo.

### Contador de visitas de la página web — migración 51 (59.91)
- `web-visitas.js` en `tienda.html`, `lq-n9.html` y `mayoristas.html`. La página se marca con `<html data-pagina="…">`.
- Manda a `web_registrar_visita` (anon, SECURITY DEFINER): página, origen (Instagram, WhatsApp, Google, Facebook, TikTok, directo u otro), equipo y un número al azar del navegador (`localStorage studio_vis`).
- **Sin IP ni datos personales.**
- **No cuenta:**
  - los equipos del personal (cookie `studio_staff`);
  - los robots y los navegadores automáticos; para las pruebas, `?qa-visitas=1` los deja contar;
  - la misma persona en la misma página dentro de 30 minutos;
  - más de 60 visitas por día de un mismo número.
- `web_visitas` no se lee ni se escribe directo: solo por las funciones.
- `web_visitas_resumen(dias)` es solo para administrador y gerente. El panel «Visitas a la página web» del Inicio se refresca cada minuto como mucho.
- Página nueva pública: agregarle `data-pagina`, el `<script src="web-visitas.js" defer>` y su nombre en la lista de `web_registrar_visita`.

### Listas de 10 en 10 — Reglamento 13 (59.92)
- **Paginador único:** `pag10Aplicar` / `window.nxPag10` (`parches-pos.js`), con MutationObserver. Toda lista lleva `data-pag10="clave"` en su `<tbody>` o caja de tarjetas; las filas que deben verse siempre llevan `data-p10-fijo`.
- **Búsqueda:** `nxFiltrarFilas` marca las filas que no coinciden y pagina las que sí. No escribas paginadores nuevos. Detalle en `REGLAMENTOS.md` §13.

### Buscador inteligente en listas (59.88)
- `parches-pos-buscador.js`: todo `<select>` con 10 opciones o más lleva lupa y buscador, sin tocar el `<select>` real.
- `data-nx-buscar` lo fuerza en una lista y `data-nx-buscar="no"` lo quita.
- Para que se pueda buscar por código, pon el código en el texto de la opción: «007 · Nombre», «PRD-001024 · Artículo».

## 2. Cómo agregar una automatización (receta que ya funcionó)
1. **Auditar primero** la base real (tablas, disparadores, RLS, datos) y el código que la usa. Anota en la bitácora qué encontraste.
2. **Si no es obvio, preguntar al dueño** el alcance, con opciones concretas.
3. **La regla va en la base:** disparador o función SECURITY DEFINER con `set search_path = public` y `revoke … from public, anon, authenticated` en las funciones de disparador. La pantalla solo muestra y llama.
4. **Disparadores BEFORE:** corren en orden alfabético. Los que necesitan `organizacion_id` se llaman `trg_z…`, para correr después de `trg_org_*`.
5. **Copias en dos sentidos:** usa un freno con `set_config('nx.…', '1', true)` para que no reboten.
6. **Probar en la base real dentro de una transacción que se deshace:**
   - archivo `supabase/studio/pruebas/NN_prueba_….sql`;
   - roles reales con `request.jwt.claims`;
   - termina en `raise exception` con los resultados;
   - después comprueba que no quedó nada.
7. **Aplicar con la herramienta de Supabase:**
   - sin `drop … if exists` ni nada que emita avisos (NOTICE): con avisos la herramienta se cuelga 60 s y no aplica;
   - con `set local lock_timeout` y `statement_timeout`;
   - verificar después con una consulta.
8. **La pantalla tolera la base vieja** (si la función o columna no existe, hace lo de antes). Lleva su prueba `docs/qa-…/qa.cjs` contra una base simulada a 1280 y 390, más la regresión de las demás.
9. **Publicar** solo con «publícalo»: primero la migración, después `main`. Luego AGENTS.md §4 y la bitácora.

## 3. Pendientes (en orden acordado con el dueño)
- [x] **Entidad Clientes** (06-oct-2026): migración 50 y 59.91. Falta que el dueño una los 34 grupos de duplicados con «Revisar duplicados».
- [ ] Cerrar la lectura de salarios: la RLS de `rrhh_empleados` deja leer a cualquier rol. Ya ninguna pantalla de personal la necesita gracias a `pos_personal()`.
- [ ] Ventas históricas sin `vendedor_id`: hay 252 sin vendedor y las viejas solo tienen nombre. **No tocar sin autorización.**
- [ ] Decidir si se borra `pos_vendedores`, que quedó sin uso.
