# Claude · Mayoristas: el despliegue del PR #36 falló en Cloudflare (renglones aún sin aplicar)

- El dueño respondió «Publícalo» a los renglones «Vehículos eléctricos» / «Vehículos de gasolina». PR #36 unido a `main` (commit `1d42a07`).
- **El build de Cloudflare falló**: check «Workers Builds: studio-rd» = `failure`, con inicio y fin en el mismo segundo (26-nov 19:05:36 UTC), build `166607d1-b236-4375-9980-039f1d1b7281`. No hay registro del motivo en GitHub y desde esta sesión no se pueden leer los registros de Cloudflare. Los builds anteriores (`3b83457`, `3bd1b43`) pasaron.
- El commit solo cambia `mayoristas.html` (2 líneas), un `.sql` y dos bitácoras: nada que intervenga en el despliegue (`wrangler.jsonc` y `worker.js` sin cambios).
- Comprobado en vivo 15 minutos después: `studiord.net/mayoristas` sigue sirviendo `ORDEN = ['Movilidad', 'Monta cargas', …]` (la versión anterior).
- **Por eso NO se aplicó `supabase/studio/55_mayoristas_renglones.sql`**: renombrar antes dejaría los vehículos al final del catálogo.
- Sí están aplicados desde antes (solo datos): LQ-PP a RD$20,000 y las demás pasolas eléctricas agotadas.

## Siguiente
Esta entrada, al unirse, lanza un build nuevo. Si pasa y la página nueva queda en vivo, aplicar el `.sql` 55 y verificar. Si vuelve a fallar, el dueño debe abrir el build en Cloudflare (Workers → studio-rd → Builds) para ver el motivo o tocar «Retry».
