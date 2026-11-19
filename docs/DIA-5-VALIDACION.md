# Día 5: baja de cliente

La instrucción exige la autoridad del registro, la PDA y la presencia del cliente en el índice. Solo cierra la cuenta cuando tanto `compras` como `historial` están vacíos; elimina su referencia sin modificar `id_counter`. Los lamports de la cuenta vuelven al owner.

## Estado local

Se compiló `programa/src/lib.rs` en directorios temporales aislados con `cargo-build-sbf` (`--tools-version v1.57 --arch v3 -- --locked`) usando el lockfile fijado [tests/fixtures/registro-Cargo.lock](../tests/fixtures/registro-Cargo.lock) (`anchor-lang` fijado a `git = "https://github.com/otter-sec/anchor"`, `rev = "33868ffeecdc96803e87cfb27748e9ec1f069eec"`), sustituyendo únicamente el marcador `declare_id!("")` por el Program ID de referencia (`38oTMyvUTmqkBQeMiuok5F2mPjp9dVadWdBeQTDNmTUY`). `idl.json` procede de esa compilación local y el cliente se generó con Codama. Aunque usa la dirección de referencia, este IDL describe **el programa local**, no demuestra que el programa de Devnet haya sido actualizado. La configuración permanece en modo referencia y bloquea la aplicación.

`tests/dia5-local.ts` es autocontenido: compila en directorios temporales aislados tanto el binario sin modificar como un control mutado (eliminando `require!(registro.clientes.contains(&cliente_key), Errores::NoCliente);` únicamente en la copia temporal), inicia instancias aisladas de `solana-test-validator` con `--reset` y puertos dedicados, y precarga una cuenta `Cliente` huérfana de 370 bytes (`id_cliente = 99`, `"Fantasma"`, `compras: 0`, `historial: []`, `"rentEpoch": 0`) mediante `--account`:

- **Binarios SBF (`-- --locked`)**:
  - `unmodified.so` SHA-256: `7dfe7f679e6159242e60bfa76f18e6768884f289c51e76a3405dfde5fddb2b2e`
  - `mutated.so` SHA-256: `be5e96bb1a0788ed1a4c04fdf5719bf48236a0599161927878c62f810cdf8930`
- **Control de mutación aislado (`mutated.so`)**: `crear_registro` (`4AAqvtNN34eGf5w4FK2MyureDf9bWWZdNe4AkRWvX5CuuEVB7c4XSsQQRdSBchkKbY1iSNeYxqsxFAiEx2i7GMEk`) y `eliminar_cliente(99)` (`pwHJvuP7ZcsVgthrLrsSxDrWybA42F3ZMvyArdQK7q5QeExfMx6k41ZSAKTX6cxn5QVBV6cnYVe6c6BsSrjTXrX`) tuvieron éxito en cadena y cerraron la cuenta `fantasma` (`getAccountInfo` devolvió `null`).
- **Programa sin modificar (`unmodified.so`)**:
  - Controles positivos: rechazos por `NoOwner` (`0x1770`), `ConstraintSeeds` (`0x7d6`) y `ClienteConVentas` (`0x1773`).
  - Simulación previa (`connection.simulateTransaction(tx, [owner])`) de `eliminar_cliente(99)` sobre `fantasma`: devolvió `{"InstructionError":[0,{"Custom":6002}]}` (`NoCliente`).
  - Transacción fallida confirmada en cadena (`skipPreflight: true`): firma `5v8d3CrAcEx7bZ2gxJqPCWPqxnasmGKUjcZzXs3Tw962JGCAPX7yL9iexQvciwZgbwkunf1K3ryHeup36jeghs6H`, `meta.err = {"InstructionError":[0,{"Custom":6002}]}` (`NoCliente` / `6002` en logs), comisión cobrada al `owner` de `5000` lamports (`9987960080` → `9987955080`), y conservación exacta de existencia, `data`, `owner`, `executable` y `lamports` en `registro`, `fantasma`, `ana`, `luis` y `venta`.
  - Flujo válido completo: devolución y cierre de `ana` (firma `3t1xyTaea4V2Go4vRb9rWAQxQRrQq1RiGekorMjCGNX7wzGmYJ3aFBqoTz7M63iuwKFHrGP4bm7JkY9HPjGMcEag`), preservación de `luis` y `id_counter = 2`, alta de `marta` con `id_cliente = 3`, y regresión de venta, cambio de monto y devolución sobre `luis`.

## Comandos reproducibles

Ejecutar bajo Node 24 (`fnm exec --using=24`, dentro de `>=22.12.0 <25`):

```bash
fnm exec --using=24 npm run comprobar:idl
fnm exec --using=24 npm run verificar
fnm exec --using=24 node --import tsx tests/verificar-dual-idl.ts
fnm exec --using=24 node --import tsx tests/dia5-local.ts
```

## Límites de esta validación

- La prueba de `NoCliente` (`0x1772`) es **defensiva**: requiere precargar con `--account` una cuenta `Cliente` huérfana de 370 bytes porque el programa en ejecución normal no genera ese estado inconsistente.
- Toda la evidencia anterior corresponde a **ejecución local** en `solana-test-validator` efímero; no sustituye pruebas en Devnet ni ejercita la interfaz React ni la extensión Solflare.
- `tests/fixtures/registro-Cargo.lock` fija la resolución de dependencias de Cargo con `-- --locked`, pero no garantiza binarios ELF byte-por-byte idénticos entre distintos entornos de host o versiones del compilador.

## Pendiente en Devnet

El programa compilado localmente no se ha desplegado. Para completar la actividad en Devnet, la autoridad de actualización debe compilar y actualizar el programa elegido en Playground, exportar su IDL e importarlo con `npm run configurar:idl -- <ruta>`. Verifica que el Program ID corresponda al despliegue y conserva el IDL, configuración y cliente generados juntos. Un Program ID diferente deriva otras PDAs y no traslada los registros anteriores.

Con Solflare y la autoridad del registro, repite el rechazo por ventas activas y la baja tras la devolución; guarda las firmas, el error, las lecturas antes y después y los enlaces de Explorer. Comprueba que la cuenta ya no exista mediante RPC. La ejecución local no sustituye esa evidencia ni una revisión de seguridad para producción.
