# Día 5: baja de cliente

La instrucción exige la autoridad del registro, la PDA y la presencia del cliente en el índice. Solo cierra la cuenta cuando tanto `compras` como `historial` están vacíos; elimina su referencia sin modificar `id_counter`. Los lamports de la cuenta vuelven al owner.

## Estado actual de la configuración (Devnet importado)

- `src/config/programa.json` ya **no** está en modo referencia (`"esReferencia": false`): apunta al despliegue en Devnet `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht` con `"origen": "IDL importado por el participante."` e `"idlSha256": "064d605932a97db706a4396310dc87287ee0bed30b1bdc2f8881af73f3094596"`.
- `idl.json` procede de la compilación y extracción de IDL (`anchor idl build -- --locked`) correspondientes a ese despliegue en Devnet, y `clients/js/src/generated/**` fue regenerado con Codama a partir de ese IDL.

## Estado local previo (histórico)

En la etapa previa al despliegue en Devnet, se compiló `programa/src/lib.rs` en un workspace temporal con Anchor 1.2.2 y `cargo-build-sbf`, sustituyendo `declare_id!("")` por el Program ID de referencia (`38oTMyvUTmqkBQeMiuok5F2mPjp9dVadWdBeQTDNmTUY`). En ese estado histórico, `idl.json` describía únicamente el programa local y `src/config/programa.json` permanecía en modo referencia (`"esReferencia": true`) bloqueando escrituras.

En esa fase local en esta rama (`clase/resuelto`) se cargó el binario en un `solana-test-validator` en `http://127.0.0.1:18899` y se ejecutó `tests/dia5-local.ts` (que asume un validador ya iniciado en ese puerto con el binario compilado cargado bajo el mismo `REGISTRO_PROGRAM_ADDRESS` del cliente generado). Se comprobaron los rechazos por autoridad, semillas y ventas activas, la conservación de las cuentas, la devolución y cierre (`3D7msp5KpKDJdBQZBv4qprFi496XVf7cj7NuhtBxfvg4R2zdVLEYeFViVmL4wC3Fgg8gyAo1HWu17Emd8d5HopQB`, solo en ese ledger efímero), el otro cliente, el contador y la regresión posterior. En `clase/resuelto`, la prueba defensiva de una cuenta `Cliente` válida pero ausente de `registro.clientes` (`NoCliente` / `0x1772`) **quedó pendiente**; la prueba de `NoCliente` con cuenta pre-cargada (`--account`) y control mutado se implementó y verificó por separado en la rama `dia5/local-verification` (`tests/dia5-local.ts`). La prueba de rechazo por venta activa en Devnet (`ClienteConVentas`) tampoco cubre este caso de `NoCliente`.

**Prerrequisitos para ejecutar `tests/dia5-local.ts` en esta rama (`clase/resuelto`)** *(no es una receta verificada de compilación completa en esta rama, ya que `programa/` no incluye `Cargo.toml`/`Anchor.toml`)*:
1. Compila una **copia aislada** de `programa/src/lib.rs` (sin modificar `programa/src/lib.rs` en el árbol de trabajo), sustituyendo `declare_id!("")` en esa copia temporal por el `REGISTRO_PROGRAM_ADDRESS` activo en `clients/js/src/generated`.
2. Inicia un validador local dedicado en el puerto `18899` con un directorio de ledger nuevo y desechable (para no reiniciar ningún ledger predeterminado existente) y ese binario cargado:
   ```bash
   solana-test-validator --ledger "$(mktemp -d)" --reset --rpc-port 18899 --bpf-program <PROGRAM_ID> <ruta/al/registro.so>
   ```
3. Con el validador escuchando en `http://127.0.0.1:18899`, ejecuta `fnm exec --using=24 node --import tsx tests/dia5-local.ts` (crea cuentas y fondos efímeros en ese validador, no en Devnet).

## Validación headless en Devnet (`clase/resuelto`)

Se ejecutó `fnm exec --using=24 node scripts/desplegar-devnet.mjs` y posteriormente `fnm exec --using=24 npm run verificar:devnet` (`node --import tsx tests/dia5-devnet.ts`) contra `https://api.devnet.solana.com`:

- **Program ID desplegado**: `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht` ([Explorer](https://explorer.solana.com/address/F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht?cluster=devnet))
- **Autoridad (keypair externo)**: `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t`
- **Firma de despliegue**: `4HSK5qTPzpJo9qJnVUAYrK5KdWhdSwKBJQQRSMQ6csL9fKWUGccjtkj57pt6TwkprPiRPy4xsAZMQ2CRCGX5Nct3` ([Explorer](https://explorer.solana.com/tx/4HSK5qTPzpJo9qJnVUAYrK5KdWhdSwKBJQQRSMQ6csL9fKWUGccjtkj57pt6TwkprPiRPy4xsAZMQ2CRCGX5Nct3?cluster=devnet))
- **Hashes de compilación e IDL**:
  - `soSha256`: `d2b68cd136dbe91ffc7a06a05e91232297d894a4105d3ac6c544fca5dbd92f7a`
  - `idlSha256`: `064d605932a97db706a4396310dc87287ee0bed30b1bdc2f8881af73f3094596`
- **Negocio y PDAs de prueba**:
  - `nombreNegocio`: `DevnetD5-oej9qa`
  - `registro`: `6EsbRYwa6PQQ5mAifhHnzYeDM3eU2xq52sFfSKd49JZ6`
  - `ana` (`id=1`): `2tN7L9hgZQekpqhc96UZ7X55gbaWFVeqqtoxX4C2MUGz`
  - `luis` (`id=2`): `DECzgDgaFEPzz7nAgcY511KjY1vYkwxkfxyR5qKFkWVx`
  - `venta` (`CAF01`): `DVjm3BBVS7segTifxMUDTwQzkXrwq5RiAVk4jUPcUo3F`
- **Rechazo en preflight (`eliminar_cliente(1)` con venta activa)**:
  - Error estructurado `SendTransactionError` con `ClienteConVentas` (`0x1773` / `6003`, traducido como `ClienteConVentas: Error, el cliente tiene ventas activas`).
  - No se aterrizó transacción; los snapshots (`existence`, `owner`, `executable`, `lamports`, `dataHex`) de `registro`, `ana`, `luis`, `venta` y el saldo de la autoridad permanecieron sin cambios.
- **Transacciones confirmadas en Devnet**:
  - `crear_registro`: `2nNkzagkvMCjE5TZcRsYqiS6AUMEto4TJSmh6VnLyKC9kUJHzDWJ8EZJ4SVTJgvVdGro1hdDGdeY45jNN84ETu4C` ([Explorer](https://explorer.solana.com/tx/2nNkzagkvMCjE5TZcRsYqiS6AUMEto4TJSmh6VnLyKC9kUJHzDWJ8EZJ4SVTJgvVdGro1hdDGdeY45jNN84ETu4C?cluster=devnet))
  - `crear_cliente` (`Ana`): `6644wTmW6oy3qv8JL5hdicUL8ak6q2vLwqhPtM3Dharj58Tgwu3c5eXXAVFXxzahJRX18qcfnwjseeNfLyqrQPWt` ([Explorer](https://explorer.solana.com/tx/6644wTmW6oy3qv8JL5hdicUL8ak6q2vLwqhPtM3Dharj58Tgwu3c5eXXAVFXxzahJRX18qcfnwjseeNfLyqrQPWt?cluster=devnet))
  - `crear_cliente` (`Luis`): `5TuqG9VinmW7HReqKSKbmbCZK1eddVdbC5zEdZ6Y5qs9nyYCykFvANU2Jhxy3dSspsP3E3ogwhqj9wr1Ao6YMHjG` ([Explorer](https://explorer.solana.com/tx/5TuqG9VinmW7HReqKSKbmbCZK1eddVdbC5zEdZ6Y5qs9nyYCykFvANU2Jhxy3dSspsP3E3ogwhqj9wr1Ao6YMHjG?cluster=devnet))
  - `registrar_venta` (`CAF01`, monto `50`): `4sU2UMVwVW6LjjmB7xqCY98EJ9HeUFF8Gv9Qqh1PmMbhAboUXzxqgtAWenhYDQcfrfXcGqToo4aw8EnmkfWn3icQ` ([Explorer](https://explorer.solana.com/tx/4sU2UMVwVW6LjjmB7xqCY98EJ9HeUFF8Gv9Qqh1PmMbhAboUXzxqgtAWenhYDQcfrfXcGqToo4aw8EnmkfWn3icQ?cluster=devnet))
  - `hacer_devolucion` (`CAF01`): `5b2ANNjXHruMnM5mThqJKx452Ej6VDaAMskZTw536qKjPR9sQBo1RStR6eczu3bPdq4DYYvmDauX6pbqeNMwudnA` ([Explorer](https://explorer.solana.com/tx/5b2ANNjXHruMnM5mThqJKx452Ej6VDaAMskZTw536qKjPR9sQBo1RStR6eczu3bPdq4DYYvmDauX6pbqeNMwudnA?cluster=devnet))
  - `eliminar_cliente(1)`: `4oc9Rd6GEgq9bHTEduEJJcisqp5JmZ7RqrFxhhY5hYZRwBuDSswXzvvnwAUauvPdKfVmw8Pk6LyBUXe5hsv7pS6E` ([Explorer](https://explorer.solana.com/tx/4oc9Rd6GEgq9bHTEduEJJcisqp5JmZ7RqrFxhhY5hYZRwBuDSswXzvvnwAUauvPdKfVmw8Pk6LyBUXe5hsv7pS6E?cluster=devnet)) — verificada posteriormente por RPC como `finalized` en el slot `524212545` (`err: null`, `fee: 5000` lamports, `Instruction: EliminarCliente`, `4492` compute units; a diferencia del rechazo previo por `ClienteConVentas`, que ocurrió en simulación preflight sin transacción en cadena).
- **Cuenta del programa e IDL en Explorer**:
  - Por RPC en Devnet, `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht` figura como `executable: true`, dueño `BPFLoaderUpgradeab1e11111111111111111111111`, `833120` lamports.
  - La pestaña **Program IDL** de Solana Explorer indica actualmente que no hay IDL disponible a través de esa vista; esto por sí solo no demuestra la ausencia de IDL en cualquier otro mecanismo de almacenamiento en cadena. En este proyecto, la aplicación y las pruebas headless utilizan el `idl.json` importado localmente y el cliente generado con Codama. Publicar un IDL para Explorer (`anchor idl init` / Program Metadata) es opcional y no es necesario para el objetivo headless de Devnet.
- **Cierre, preservación y contabilidad de renta/comisión**:
  - `ana` cerrada (`getAccountInfo` = `null`), `registro.clientes` == `[luis]`, `registro.idCounter` == `2`, y snapshot completo de `luis` sin cambios.
  - Renta reembolsada de `ana`: `2529840` lamports; comisión (`meta.fee`) de `eliminar_cliente`: `5000` lamports; variación neta de la autoridad: `1488522280 -> 1491047120` (`+2524840` lamports).

### Alcance y separación respecto a React / Solflare

Esta prueba headless en Node (`tests/dia5-devnet.ts`) valida el despliegue real en Devnet, la firma Ed25519, los constructores/decodificadores Codama, `comprobarPrograma`, el rechazo en preflight y la baja confirmada en Devnet. **No** ejercita la interfaz React (`src/components/Registro.tsx`), `WalletProvider` ni la firma interactiva en navegador con Solflare; esas comprobaciones permanecen separadas en [PRUEBAS-MANUALES.md](./PRUEBAS-MANUALES.md).

Después se documentaron comprobaciones separadas de interfaz sin extensión: una wallet simulada que cancela firmas, lectura de otra autoridad y ejecuciones de Devnet iniciadas desde la app con una wallet de práctica programática y un firmante temporal en Node. Estas ejecuciones validaron la baja, la devolución, el re-registro de SKU y el refresco reactivo automático en navegador. La evidencia, el procedimiento reproducible paso a paso y sus límites de seguridad están detallados en [PRUEBAS-AUTOMATIZADAS.md](./PRUEBAS-AUTOMATIZADAS.md).

En esas pruebas, «Conectar wallet» fue posible porque el navegador anunció un objeto compatible con Wallet Standard, que la app descubrió y pudo seleccionar. La conexión muestra una identidad pública; una firma válida solo existe cuando un firmante con la clave correspondiente firma la transacción. La receta de cancelación rechaza todas las firmas; el procedimiento reproducible con transacciones reales utiliza un proceso Node separado que valida la transacción antes de firmarla, manteniendo la clave privada fuera de la página. La comprobación con una extensión de navegador instalada por el usuario (como Solflare) permanece documentada por separado en [PRUEBAS-MANUALES.md](./PRUEBAS-MANUALES.md).
