# Día 5: baja de cliente

La instrucción exige la autoridad del registro, la PDA y la presencia del cliente en el índice. Solo cierra la cuenta cuando tanto `compras` como `historial` están vacíos; elimina su referencia sin modificar `id_counter`. Los lamports de la cuenta vuelven al owner.

## Estado local

Se compiló `programa/src/lib.rs` en un workspace temporal con Anchor 1.2.2 y `cargo-build-sbf`, sustituyendo únicamente el marcador `declare_id!("")` por el Program ID de referencia. `idl.json` procede de esa compilación local y el cliente se generó con Codama. Aunque usa la dirección de referencia, este IDL describe **el programa local**, no demuestra que el programa de Devnet haya sido actualizado. La configuración permanece en modo referencia y bloquea la aplicación.

Se cargó el binario en `solana-test-validator` y se ejecutó `tests/dia5-local.ts` con wallets temporales. Se comprobaron los rechazos por autoridad, semillas y ventas activas, la conservación de las cuentas tras los rechazos, la devolución y cierre, el otro cliente, el contador, la siguiente alta y el recorrido de venta, corrección y devolución. La firma local de la baja fue `3D7msp5KpKDJdBQZBv4qprFi496XVf7cj7NuhtBxfvg4R2zdVLEYeFViVmL4wC3Fgg8gyAo1HWu17Emd8d5HopQB`; solo existe en ese ledger local. La prueba de una cuenta Cliente válida pero ausente del índice requiere preparar un estado inconsistente y queda pendiente.

Para repetir la prueba, compila la fuente con el mismo Program ID y carga el binario en un validador local en el puerto 18899; luego ejecuta `node --import tsx tests/dia5-local.ts`. La prueba crea cuentas y fondos de prueba en ese validador, no en Devnet.

## Pendiente en Devnet

El programa compilado localmente no se ha desplegado. Para completar la actividad en Devnet, la autoridad de actualización debe compilar y actualizar el programa elegido en Playground, exportar su IDL e importarlo con `npm run configurar:idl -- <ruta>`. Verifica que el Program ID corresponda al despliegue y conserva el IDL, configuración y cliente generados juntos. Un Program ID diferente deriva otras PDAs y no traslada los registros anteriores.

Con Solflare y la autoridad del registro, repite el rechazo por ventas activas y la baja tras la devolución; guarda las firmas, el error, las lecturas antes y después y los enlaces de Explorer. Comprueba que la cuenta ya no exista mediante RPC. La ejecución local no sustituye esa evidencia ni una revisión de seguridad para producción.
