# STUDIO RD: auditoría del espaciado de los formularios (29-oct-2026)

Revisé solo, sin cambiar nada. La copia revisada es `origin/main` (commit 5fc1d8c) y el detalle de cada ventana está en `studio.json`.

## Resultado

- **Formularios revisados: 60.** Medí 51 con Playwright a 390 px y 1280 px. Otros 9 los revisé leyendo el código, porque para abrirse necesitan datos reales.
- **Cumplen: 0. Casi: 0. No cumplen: 60.**

Ninguna ventana se acerca a la regla. La razón es que casi todas usan las mismas piezas de estilo (`.modal`, `.fr label`, `.fr input`, `.btn`), y esas piezas todavía tienen las medidas viejas.

## Lo que más se repite (cantidad de formularios medidos)

1. **Borde interior de la ventana** (50): 15 a 21 px en PC y unos 15 px en celular. La regla pide 48/40 en PC y 24/16 en celular.
2. **Cosas que se tocan por debajo de 44 × 44** (49): el botón «Volver» mide 30 × 30, los chips y pestañas 32 a 35 px de alto y los botones 36 px.
3. **Alto de los campos** (47): la mayoría mide 32, 34 o 40 px, cuando deben medir 48.
4. **Botón principal** (47): 36 px en PC y 44 px en celular, cuando debe medir 54.
5. **Letra de los campos** (45): 12 a 13 px, cuando debe ser 16. En iPhone esto hace que la pantalla se acerque sola (zoom) al tocar el campo.

Además se repiten estas cuatro:

- Etiqueta → cajita: 3 a 4 px (deben ser 8), en 44 formularios.
- Etiquetas de 8 a 10 px y en MAYÚSCULAS, cuando deben ser de 13 px en minúscula normal.
- Campo → campo: 9 a 10 px (deben ser 20).
- Último campo → botón: entre 12 y 50 px, varía (deben ser 24).

## Lo que más se acerca

- **Firma de contrato (cliente):** los campos ya miden 48 px con letra de 17 px y el botón 52 px. Solo falla en las separaciones (6 y 12 px) y en el relleno de la tarjeta (16 px).
- **Calculadora LQ-N9:** la letra de los campos es de 16 px y las cajitas miden 44 px. Fallan las separaciones y el relleno.
- **Tienda: hoja del pedido:** no tiene campos de escribir. Los botones − / + y la × miden 40 × 40, el botón «Quitar» 27 px de alto y la letra mínima es de 12,5 px.
- **Login:** las cajitas miden 48 px. El botón «Iniciar sesión» mide 50 px, la casilla «Recordarme» 18 × 18 y la separación entre campos es de 16 px. La regla del borde no aplica porque no hay tarjeta.

## Arreglo sugerido

Conviene un solo cambio en la base común, en lugar de arreglar cada ventana:

| Pieza | Debe quedar en |
|---|---|
| `.modal` (relleno) | 48/40 px en PC y 24/16 px en celular |
| `.fr label` | 13 px, sin mayúsculas, 8 px sobre la cajita |
| `.fr input/select` | 48 px de alto y letra de 16 px |
| `.fr` (separación) | 20 px entre campos |
| Botón principal | 54 px |
| Botón «Volver», chips y casillas | 44 × 44 px como mínimo |

Las ventanas con estilos propios hay que repasarlas aparte: Nuevo artículo (`.nxPf`), Reacondicionados (`.nxRc*`), CRM (`.nxCrmModal`), Abono CxP (`.nxCxpAb`) y las públicas.

## Lo que no pude medir o tiene límites

- Abrí las ventanas con datos de prueba simulados: un usuario administrador falso y respuestas falsas de Supabase. No usé credenciales ni escribí nada en la base, porque todo pedido a Supabase se interceptó.
- **Por código (9):** Pagar a proveedor, Abonar a cuenta por pagar, Devolución de venta, Nueva devolución a suplidor, CRM (etiquetas, transferir, plantillas), Expediente de crédito y Mayoristas: hoja del pedido. Todas usan las mismas piezas que las medidas, así que tendrían las mismas fallas.
- Siete ventanas del sistema viejo de seguros siguen en el mismo `index.html` (Cliente, Abono, Asiento, Agente, Empresa, Usuario e Inhabilitar). Las medí, pero puede que en STUDIO no se vean.
- Los iconos de Tabler no cargaron en la prueba. Sus cuadritos vacíos no cambian las medidas de cajitas ni botones.
- Las medidas automáticas del borde, del bloque título → ayuda y de «grupo → grupo» son aproximadas. En las ventanas con desplazamiento, el borde de abajo lo medí desde el botón principal.

Capturas: `studio-cap-movimiento-caja-1280.png`, `studio-cap-nuevo-cliente-390.png` y `studio-cap-login-1280.png`.
