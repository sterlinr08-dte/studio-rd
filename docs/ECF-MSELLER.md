# Factura electrónica (e-CF) con MSeller — plan para STUDIO

**Decisión del dueño (06-oct-2026):** el proveedor de factura electrónica es **MSeller ECF** (IT SOLUCLICK SRL, RNC 130862346).
- Docs: https://docs.ecf.mseller.app. Portal: https://ecf.mseller.app.
- La e-CF es **obligatoria desde el 15-nov-2026** para micro y pequeños contribuyentes (`REGLAMENTOS.md` §4).

## Cómo trabaja MSeller (resumen de su documentación)
- **El envío:** STUDIO manda cada comprobante en **JSON** a `POST https://ecf.api.mseller.app/{TesteCF|CerteCF|eCF}/documentos-ecf`. MSeller lo pasa a XML, lo firma con el certificado del negocio, lo envía a la DGII y guarda el XML 10 años.
- **Credenciales:** el login (`/customer/authentication`, con el email y la clave del portal) da un `idToken`. Cada llamada lleva `Authorization: Bearer idToken` y `X-API-KEY` (una clave por entorno).
- **El e-NCF lo asigna STUDIO**, no MSeller. Sigue la serie E + tipo + 10 dígitos, por ejemplo `E320000000001`, con los rangos que la DGII autoriza al RNC. Los rangos que no se usen se anulan con `POST /customer/void-ncf`.
  - Esa anulación es irreversible y no es idempotente: ante un error hay que consultar antes de repetir.
- **La respuesta es inmediata y trae:** `securityCode` (6 caracteres), `qr_url`, `signedDate` e `internalTrackId`.
  - El veredicto de la DGII llega después. Se consulta con `GET /documentos-ecf?ecf=…` o en lote, hasta 100 a la vez.
  - **Estados:** Aceptado, Aceptado Condicional o Rechazado. Si se rechaza, se emite un documento **nuevo**.
- **Impresión:** se imprime enseguida, sin esperar a la DGII. Lleva el QR tal cual viene en `qr_url`, el código de seguridad, la fecha de firma y el e-NCF. El ticket de 80 mm lo hace STUDIO.
- **e-32 consumo:** consumidor final `RNCComprador "00000000000"`. Si el total es de RD$250,000 o más, MSeller manda el extendido, que exige el RNC o la cédula del comprador. **e-31** exige el RNC del comprador.
  - **e-34 nota de crédito:** lleva `InformacionReferencia.NCFModificado`, `FechaNCFModificado` y `CodigoModificacion`, donde 1 es anulación total y 3 es corrección de montos.
- **`?validate=true`:** valida sin enviar a la DGII y sin gastar el número.
- **No hay webhooks** ni clave de idempotencia. Los reintentos llevan espera creciente y nunca se repite un error de validación.
- **Plan Gratis** (micro y pequeñas): 250 comprobantes y 1,000 llamadas al mes, unas 4 llamadas por comprobante.
  - Al agotarse, la respuesta es `429` y **no se puede facturar** hasta el día 1.
  - Planes pagos: Emprende RD$850 (500 comprobantes), Básico RD$1,400 (1,000) y otros más grandes.
- **Certificación DGII:** se hace con el asistente de MSeller, que envía solo las pruebas de cada tipo. Toma unos 10 minutos más la espera de la DGII, y luego se hace la declaración jurada.

## Lo que hace el dueño (no depende del código)
1. **Certificado digital `.p12`** del negocio, en la Cámara de Comercio de Santo Domingo. Es obligatorio **hasta para las pruebas**; sin él no se puede probar nada.
2. **Cuenta en MSeller** del tipo **«Cuenta para mi negocio»**, subir el `.p12` y crear la API Key de **TesteCF**.
3. **RNC, razón social y dirección de STUDIO** en Ajustes. Hoy `pos_config.emp_rnc` está vacío.
4. **Elegir plan:** el Gratis alcanza para unos 250 comprobantes al mes. Si se factura más, tomar uno con margen.
5. **Credenciales:** pasarlas por un canal seguro para guardarlas como **secretos de Supabase** (Edge Functions). **Nunca en el repo ni en el chat.**

## Lo que construye Claude (por fases, con autorización en cada una)
- **Fase 1, pruebas (TesteCF):**
  - migración para guardar en `pos_ventas` y `pos_devoluciones` el `ecf`, el estado DGII, el código de seguridad, el `qr_url`, la fecha de firma y el `internalTrackId`;
  - secuencias E31, E32 y E34 en `pos_ncf_secuencias`, repartidas por la base sin repetirse;
  - Edge Function `ecf-emitir`: arma el JSON desde la venta (ítems, ITBIS 18 %/exento, totales), valida con `validate=true`, envía y guarda la respuesta;
  - Edge Function `ecf-estado`: consulta en lote los pendientes;
  - en el ticket y la factura carta: QR, código de seguridad, fecha de firma y estado;
  - pedir el RNC del comprador en las e-31;
  - e-34 desde las notas de crédito.
- **Fase 2, certificación (CerteCF):** la hace el dueño con el asistente de MSeller; Claude acompaña paso a paso.
- **Fase 3, producción (eCF):**
  - cambiar a la clave de producción;
  - herramienta en Ajustes para **anular rangos e-NCF sin usar**, guardando el `voidId`;
  - reportes 607 y 608.

## Riesgos a resolver en la Fase 1
- **Redondeo.** Hoy STUDIO cobra el total en pesos enteros y muestra la línea «Redondeo» (59.87). La e-CF exige que el total cuadre con los ítems: la DGII marca «Aceptado Condicional» (código 1924) si no cuadra.
  - Hay que decidir si la e-CF va con los centavos exactos o si el redondeo va como descuento. Toca dinero y contabilidad: se audita antes.
- **Contingencia sin internet:** MSeller no la documenta. Mientras tanto, la venta no se bloquea: se emite y se consulta después.
- **Cuota:** un `429` impide facturar. STUDIO llevará su propio conteo y avisará al 80 %.
