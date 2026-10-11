# META-WHATSAPP.md — estado vivo de Meta, anuncios y WhatsApp de STUDIO

**Lectura obligatoria antes de hablar o tocar cualquier cosa de Meta, anuncios, Instagram, Facebook, WhatsApp o Zernio.**
Este archivo existe porque la memoria del chat se resume y se pierde. Lo que está aquí **manda sobre la memoria de la conversación**.
Se actualiza en cada cambio (con fecha) y deja su bitácora. Sin secretos: nada de tokens ni claves aquí.

Última actualización: **11-oct-2026** (Claude).

## 1. Portafolios (Meta Business)

| Portafolio | ID | Qué tiene |
|---|---|---|
| **jose antonio peralta** (socio del dueño) | 936305359029409 | Dueño de las páginas **Studiord** (1314249678440736, la de los anuncios), **Studiord duplicada** (1297387236799363) y **studio__rd** (1019169997947516, la del Instagram). Cuenta publicitaria **1467569175031161** activa. Ahí sí sale «usar publicación existente». |
| **Studiord** (del dueño) | 28811977941729276 | Cuenta publicitaria **1105787685433439** activa, con pago; usa la página Studiord compartida desde José. Cuenta **1784394786159387 DESACTIVADA** por «actividad inusual» (no usar, no crear más cuentas). WABA **1321807679839286** con VISA. **Negocio sin verificar** (esperando documentos). |

**Decisiones del dueño:**
- 08-oct: no mover la página ni la cuenta publicitaria de José a Studiord mientras WhatsApp no esté estable.
- 11-oct: esquema **«compartido»**. Los activos siguen en el portafolio de José y se **comparten** con Studiord; el dueño es administrador con control total en los dos.
- 11-oct: el dueño dice que ya pidió/compartió la página **studio__rd** y **@studio__rd** con Studiord. Por la API todavía **no aparece** en la cuenta 1105787685433439 (puede ser demora, falta de aprobación o «Conectar activos», o límite de lo que la API muestra). Pendiente: 3 capturas (Páginas, Cuentas de Instagram, Activos conectados de …3439) y prueba de «usar publicación existente».

## 2. WhatsApp 829-624-7623 (STUDIO) — incidente y decisión

- 28-sep: conectado a Zernio en **coexistencia** (app WhatsApp Business del celular + API). Mensajes entraban al CRM (`crm_mensajes`).
- 07-oct: con muchos cambios el mismo día (pago, reconexión, número traído del portafolio de José, portafolio sin verificar) WhatsApp lo **bloqueó** («Esta cuenta no puede usar WhatsApp»). Se pidió revisión. Lo desbloquearon, pero al volver a registrarlo («Cambió tu código de seguridad») **se cortó el enlace con Zernio y se volvió a suspender**.
- **08-oct, decisión del dueño:** «Vamos a usar otro número y el otro ponerlo en WhatsApp normal» y «Desvincula de Zernio».
  - El 829-624-7623 queda **solo en el celular** (recomendado: en la app WhatsApp Business para no perder chats ni el botón de anuncios).
  - **Desvincularlo de Zernio** (Connections → studio rd WhatsApp → Disconnect) — **pendiente de confirmar**. No quitarlo de Meta sin revisar antes.
  - **NUNCA volver a conectar el 829-624-7623 por coexistencia ni re-registrarlo.** Fue la causa del bloqueo.
- **Número nuevo para el CRM: pendiente de elegir** (candidato mencionado: 829-744-8336, que está en el portafolio de José). Se conecta **una sola vez**, **solo API** (`onboarding=api`, sin app en ningún celular), en el perfil STUDIO de Zernio, idealmente con Studiord ya verificado. Primeros días: solo recibir y contestar; nada masivo (límite inicial de Meta: 250 contactos/día).

## 3. Campañas

| Campaña | ID | Estado |
|---|---|---|
| CAMPAÑA OCTUBRE 2026 EST - 829 | 52549166609833 | **Pausada** el 07-oct por orden del dueño. Reactivar **solo con su «sí»** y después de decidir a qué número manda. |
| CAMPAÑA OCTUBRE 2026 | 52547680318633 | Activa (sin gasto ese día). No se tocó. |

## 4. Zernio (perfil STUDIO)

- Instagram **studio__rd** y Facebook **Studiord** (página 1314249678440736) conectados al CRM y funcionando (07-oct).
- WhatsApp: ver §2. Zernio usa el registro oficial de Meta (Embedded Signup); el riesgo no es la herramienta sino los re-registros y el uso.
- No reconectar **@bayolcell** en Zernio sin decisión del dueño (cuenta de BAYOL).

## 5. Pendientes abiertos

1. Confirmar que el 829-624-7623 quedó desvinculado de Zernio.
2. Elegir el número nuevo del CRM y conectarlo solo por API.
3. Decidir el destino de la campaña pausada y reactivarla solo con el «sí» del dueño.
4. Verificación del negocio Studiord (documentos).
5. Confirmar el uso compartido de studio__rd / @studio__rd en la cuenta 1105787685433439.
6. App de Meta for Developers: paso 1 pendiente (token de usuario del sistema solo en Supabase Secrets, nunca en el chat).

## 6. Reglas

- No enviar WhatsApp a clientes sin autorización del dueño.
- Pocos cambios por día en Meta; muchos cambios seguidos es lo que Meta marca como actividad inusual.
- Tokens y claves: solo en Supabase Secrets o los escribe el dueño; nunca en el chat, el repo ni la bitácora.
- Anuncios: cada cambio de campaña con aprobación del dueño.

Historia completa: bitácoras `2026-09-28-1100`, `2026-10-07-1116`, `2026-10-07-1630`, `2026-10-07-1650` y `2026-10-11-*` (esta).
