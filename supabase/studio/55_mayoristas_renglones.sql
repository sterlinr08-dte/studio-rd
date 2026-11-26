-- Catálogo mayorista: renglones de vehículos por tipo de motor (dueño, 26-nov-2026).
-- Solo datos. Aplicar DESPUÉS de publicar mayoristas.html con el ORDEN nuevo.
update tienda_mayoristas_items set grupo = 'Vehículos eléctricos'  where grupo = 'Movilidad';
update tienda_mayoristas_items set grupo = 'Vehículos de gasolina' where grupo = 'Monta cargas';
-- Deshacer: invertir los dos update.
