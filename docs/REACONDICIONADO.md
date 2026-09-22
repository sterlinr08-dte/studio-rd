# Reacondicionado STUDIO — proceso simplificado (basado en el taller BAYOL CELL)

Fecha: 2026-09-22 · Estado: **propuesta para aprobación del dueño** (Fase 0 hecha, sin código todavía).
Fuente: módulo Reacondicionados de `bayolcell-taller` (`taller.html`, base `vkhwdvjtowrhkhqavnvk`):
222 equipos en 7 lotes, 9 estados internos, evaluación con puntaje 0–100 y alertas, piezas pedidas,
tareas por técnico, control de calidad, despacho y centro de rentabilidad. Tiempo promedio compra → listo: 11,6 días.

## 1. Qué es, en palabras simples
- **Lote**: un grupo de teléfonos comprados juntos (una compra).
- **Equipo**: un teléfono concreto, identificado por su IMEI.
- **Etapa**: en qué punto del camino está cada teléfono, desde que llega hasta que se vende.
- **Costo final** de un teléfono = lo que costó comprarlo + su parte del envío + las piezas que se le pusieron.
- **Ganancia** = precio al que se vendió − costo final.

## 2. Las 6 etapas (una pregunta por etapa, un botón principal por pantalla)
| # | Etapa | Pregunta que responde | Quién | Qué se hace |
|---|---|---|---|---|
| 1 | **Recibido** | ¿Qué llegó? | Recepción / admin | Se registra el lote (o entra solo desde Compras) y cada teléfono: modelo, IMEI, color, capacidad, costo |
| 2 | **Revisión** | ¿En qué estado está? | Recepción / admin (no hace falta ser técnico) | Lista de 10 preguntas sí/no en lenguaje llano → el sistema pone **semáforo** y avisos |
| 3 | **En taller** | ¿Quién lo arregla y qué necesita? | Técnico | Técnico asignado, tareas con un toque (Cambiar batería, Housing, Pulir pantalla…), piezas del inventario |
| 4 | **Control de calidad** | ¿Quedó bien? | Encargado | 6 comprobaciones; si falla, vuelve a *En taller* con nota |
| 5 | **Listo para vender** | ¿A cuánto? | Admin | Precio sugerido automático; el teléfono entra al inventario como serial disponible con su costo final |
| 6 | **Vendido** | ¿Cuánto se ganó? | Automático | Al venderse el serial en Vender/Factura queda marcado; ganancia real por teléfono |

Reglas (las mismas que protegen el flujo en Bayol, pero sin estados intermedios visibles):
- No se puede saltar etapas hacia adelante. Sí se puede **devolver** un teléfono a *En taller* (desde 4 o 5) con nota.
- *Revisión* no se cierra sin al menos una respuesta o nota.
- *En taller* exige técnico asignado. No pasa a *Control de calidad* con piezas **pedidas sin entregar**.
- *Listo para vender* exige precio. *Vendido* solo llega desde *Listo* (lo pone la venta, no una persona).
- Cada cambio de etapa deja rastro: quién, cuándo, de dónde a dónde y nota.

## 3. Revisión guiada (sustituye el formulario técnico de Bayol de 40 campos)
10 preguntas, todas sí/no o un número. Cada «sí» resta puntos igual que `calcular_score_refurb` de Bayol:
1. ¿Enciende y llega al inicio? (no → −25)
2. ¿Tiene cuenta iCloud / Google / Samsung bloqueada? (sí → −40, **alerta roja**)
3. ¿La pantalla se ve bien y responde al tacto? (no → −15)
4. ¿Tiene cristal roto o rayones profundos? (sí → −8)
5. ¿Salud de batería? (número; <80 → −5, <70 → −10)
6. ¿La batería está inflada? (sí → −15, **alerta roja**)
7. ¿Carga bien? (no → −12)
8. ¿Tiene señal, wifi y bluetooth? (no → −15)
9. ¿Cámaras y flash funcionan? (no → −8)
10. ¿Tiene golpes fuertes, marco doblado o señales de humedad? (sí → −15, **alerta**)

Resultado automático:
- **Verde (≥ 85)**: casi listo, limpieza y a *Listo para vender*.
- **Amarillo (60–84)**: reparación normal, a *En taller*.
- **Rojo (< 60 o alerta roja)**: decidir — reparar, usar para piezas o devolver al proveedor.

## 4. En taller, sin jerga
- Tareas frecuentes de Bayol como botones: Cambiar batería · Subir batería · Housing · Pulir pantalla · Glass ·
  Cambiar marco · Tapa · Flex de carga · Cámara · Pantalla · Otro (texto).
- Piezas: se eligen del inventario de STUDIO (categoría PIEZAS). Al marcar «usada» se descuenta el stock
  (`pos_mover_stock_atomico` tipo `taller`) y el costo se suma solo al teléfono. Si no hay stock → «Falta pieza»
  y el teléfono aparece en el tablero como *Esperando pieza*.
- El técnico ve solo sus teléfonos («Mis equipos»).

## 5. Tablero para una persona no técnica
- Seis píldoras con conteo (01 Recibido … 06 Vendido) y dos avisos: **Atrasados** (> 7 días en la misma etapa)
  y **Esperando pieza**.
- Lista de teléfonos con semáforo, modelo, IMEI (últimos 6), técnico y días en etapa.
- Ficha del teléfono: etapa actual grande, **un** botón principal («Pasar a Control de calidad»), botón secundario
  «Devolver a taller», costo final siempre visible, historial abajo.
- Rentabilidad (solo admin): por lote y por mes — invertido, vendido, ganancia, margen; teléfonos vendidos sin precio.

## 6. Cómo encaja en STUDIO (sin contabilidad paralela)
- Un lote se crea desde **Compras v2** (compra de importación con teléfonos serializados) o a mano.
- Los teléfonos son `pos_seriales` del producto correspondiente; mientras están en reacondicionado el serial queda
  `reservado` (no se puede vender por error) y pasa a `disponible` en *Listo para vender*.
- El costo final se guarda en el equipo y se usa como costo de venta del serial (utilidad real en Reportes).
- Ganancia y cartera siguen saliendo de `pos_ventas`: no se suma dinero dos veces.

## 7. Modelo de datos propuesto (todas con `organizacion_id` y RLS como el resto)
- `pos_reacond_lotes`: id, codigo, compra_id, proveedor_id, fecha, gastos_envio, notas, estado (abierto/cerrado).
- `pos_reacond_equipos`: id, lote_id, producto_id, serial_id, modelo, imei, color, capacidad, costo_compra, flete,
  costo_piezas, etapa (1–6), semaforo, puntaje, alertas jsonb, revision jsonb, tecnico_id, tecnico_nombre,
  etapa_desde, precio_sugerido, precio_venta_real, venta_id, veces_devuelto, notas, created_at, updated_at.
- `pos_reacond_tareas`: id, equipo_id, descripcion, hecha, tecnico_id, created_at, hecha_at.
- `pos_reacond_piezas`: id, equipo_id, producto_id, nombre, cantidad, costo_unit, estado (pedida/entregada/usada/devuelta), almacen_id.
- `pos_reacond_historial`: id, equipo_id, etapa_de, etapa_a, accion, nota, usuario, created_at.
- RPC: `pos_reacond_pasar(equipo, etapa, nota)` con las reglas; `pos_reacond_pieza_usar(pieza)`; `pos_reacond_listo(equipo, precio)`;
  trigger en `pos_venta_items` (serial vendido) → etapa 6 y `precio_venta_real`.
- Config: margen sugerido (%), días para «atrasado».

## 8. Qué NO se replica (a propósito)
- Info Plus, «costos contables» separados de «solicitudes técnicas», sellado de incentivos, catálogo público
  y devoluciones por ciclo avanzadas. Los incentivos por técnico pueden venir después como módulo aparte.

## 9. Entregas propuestas
- **A.** Migración `18_reacondicionado.sql` (tablas, RPC, trigger, RLS).
- **B.** Frontend `parches-pos-reacond.js` (pestaña «Reacondicionado» del POS, misma línea gráfica DESIGN.md).
- **C.** Enlace con Compras v2 (crear lote desde compra) y con Vender (vendido automático).
- **D.** QA con datos reales de STUDIO (lote de prueba), bitácora, sin publicar hasta «publícalo».
