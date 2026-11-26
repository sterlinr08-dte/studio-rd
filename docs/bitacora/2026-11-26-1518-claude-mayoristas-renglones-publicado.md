# Claude · Publicado: renglones «Vehículos eléctricos» y «Vehículos de gasolina» en mayoristas

Cierra la entrada del despliegue fallido de hoy.

- El build que lanzó el PR #37 (commit `0788958`) terminó en `success`. Comprobado en vivo: `studiord.net/mayoristas` sirve `ORDEN = ['Vehículos eléctricos', 'Movilidad', 'Vehículos de gasolina', 'Monta cargas', 'Hogar', 'Tecnología']`.
- El motivo del primer fallo (build `166607d1…`, del commit `1d42a07`) **no se conoció**: falló en el mismo segundo en que empezó y el mismo contenido desplegó bien en el intento siguiente.
- Después de confirmar la página en vivo se aplicó `supabase/studio/55_mayoristas_renglones.sql` en `edbknlkjnlfmkkiizdbe` (solo datos).
- Comprobado en la base: Vehículos eléctricos 10 artículos (1 disponible: LQ-PP a RD$20,000) · Vehículos de gasolina 2 (2 disponibles) · Hogar 14 (10) · Tecnología 2 (2), en ese orden.

## No verificado
La página con un enlace de mayorista real (no se tiene la clave).

## Pendiente (propuesto, sin decidir)
El LQ-PP va de noveno en su renglón, detrás de 8 agotados. El dueño publicó sin moverlo.
