# Runbook: Despliegue y Verificación en Solana Devnet

Procedimiento operativo estándar para desplegar el programa Anchor en Devnet y ejecutar la verificación coordinada de baja de clientes y ciclo de ventas con Chrome DevTools MCP.

---

## 1. Activador y Cuándo Usar
* **Activador:** Validación integral de fin de módulo (Día 5), actualización del IDL/programa en Devnet o verificación de regresión tras cambios en la capa de clientes o frontend.
* **No usar:** Pruebas unitarias rutinarias (usar `npm test` o `npm run verificar` en local sin conexión a red).

---

## 2. Prerrequisitos
1. **Node.js:** Versión 24 vía `fnm`:
   ```bash
   fnm use 24
   ```
2. **Keypair de prueba externo:** Por defecto `~/.config/solana/registro-devnet-tester-keypair.json` (fuera del repositorio); si usas otro keypair de práctica, define `DEVNET_AUTHORITY_KEYPAIR=<ruta-externa>` junto con `DEVNET_EXPECTED_AUTHORITY=<tu-pubkey>`.
3. **Saldo en Devnet:** Mínimo 0.03 SOL (`30_000_000` lamports). Si el saldo es menor, el script intenta hasta 2 airdrops automáticos acotados a 1 SOL.
4. **Autoridad esperada:**
   `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t` en la corrida de referencia (ajusta `DEVNET_EXPECTED_AUTHORITY` y `DEVNET_AUTHORITY_KEYPAIR` si utilizas tu propia clave de práctica).

---

## 3. Pasos de Ejecución

### Paso 1: Verificación de Integridad Local
```bash
fnm exec --using=24 npm run comprobar:idl
REQUIRE_ZERO_AMOUNT_IDL=1 fnm exec --using=24 npm run verificar
git diff --check
```
* **Resultado esperado:** Contrato coherente, `17/17` pruebas unitarias aprobadas en la línea base de entrega (y `18/18` en una observación posterior tras añadir las pruebas offline de `tests/helpers/firmante-temporal.ts`), build de producción en `dist/` completado.

### Paso 2 (Opcional): Compilación sin Despliegue o Despliegue en Devnet
Para compilar `programa/src/lib.rs` y exportar el `idl.json` sin desplegar (requiere `anchor-cli 1.2.2`, `solana-cli 4.1.2` con `cargo-build-sbf --tools-version v1.57 --arch v3`, `cargo 1.99.1`, `tests/fixtures/registro-Cargo.lock` y red/caché de Cargo para `anchor-lang` rev `33868ffeecdc96803e87cfb27748e9ec1f069eec`):
```bash
NO_DNA=1 fnm exec --using=24 node scripts/desplegar-devnet.mjs --solo-build \
  --program-id F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht \
  --out-dir .aula/local-runs/solo-build-out \
  --work-dir .aula/local-runs/solo-build-work
```
*(Usa rutas distintas bajo `.aula/local-runs/`: `--out-dir` debe estar vacío o no existir y conserva `registro.so` e `idl.json`; `--work-dir` aloja y limpia la subcarpeta temporal `dia5-devnet-build-*`. Si se omite `--work-dir`, `scripts/desplegar-devnet.mjs` usa `os.tmpdir()`, aunque lo limpia en `finally`. Los hashes de `.so` e `idl.json` corresponden a artefactos distintos y no prueban por sí solos equivalencia byte a byte con el binario desplegado sin `solana program dump`.)*

Si el activador incluye desplegar una nueva compilación del programa en Devnet:
```bash
fnm exec --using=24 node scripts/desplegar-devnet.mjs
# Para actualizar un programa existente sin cambiar su ID:
# fnm exec --using=24 node scripts/desplegar-devnet.mjs --upgrade
```
* **Requisitos:** Requiere `solana` y `anchor` en `$PATH`, keypairs externos en `~/.config/solana/` (`registro-devnet-tester-keypair.json` y `registro-devnet-program-keypair.json`), y saldo suficiente para renta.
* **Sincronización:** `scripts/desplegar-devnet.mjs` ya ejecuta la importación atómica del IDL y la regeneración del cliente (`stageIdlImport`). Si importas un IDL externo manualmente, usa:
  ```bash
  fnm exec --using=24 npm run configurar:idl -- <ruta/al/idl.json>
  fnm exec --using=24 npm run comprobar:idl
  ```

### Paso 3: Iniciar Servidor de Aplicación
En una sesión de terminal o proceso en segundo plano:
```bash
fnm exec --using=24 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```
* **Resultado esperado:** Servidor disponible en `http://127.0.0.1:5173/`.

### Paso 4: Ejecución Coordinada con Pausas (`--pausar`)
En otra terminal, iniciar la corrida con la variable de autoridad explícita:
```bash
DEVNET_EXPECTED_AUTHORITY=A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t \
  fnm exec --using=24 node --import tsx tests/dia5-devnet.ts --pausar
```

#### Checkpoint 1: `[checkpoint:previo-a-rechazo]`
1. El script imprime el nombre del negocio (ej. `DevnetD5-xxxxxx`) y las PDAs.
2. En el navegador (vía Chrome DevTools MCP o pestaña local), navegar a `http://127.0.0.1:5173/`.
3. Introducir el nombre exacto del negocio y la autoridad pública.
4. Pulsar **«Consultar registro»**.
5. **Verificar:** Aparecen 2 clientes (Ana #1 con 1 venta activa `CAF01` de 50 unidades y Luis #2 con 0 ventas) y último ID asignado `2`.

#### Checkpoint 2: `[checkpoint:post-rechazo]`
1. En la terminal del script, pulsar `Enter`.
2. El script intenta eliminar a Ana antes de devolver la venta y captura el error preflight:
   `Preflight rejection verified (ClienteConVentas 0x1773/6003)`.
3. En el navegador, pulsar **«Consultar registro»**.
4. **Verificar:** Ambas cuentas y la venta `CAF01` permanecen intactas en la interfaz.

#### Checkpoint 3: Post-baja y Reembolso
1. En la terminal del script, pulsar `Enter`.
2. El script ejecuta `hacer_devolucion(CAF01)`, `eliminar_cliente(1)` y valida el balance de renta.
3. El script finaliza con código de salida `0`.
4. En el navegador, pulsar **«Consultar registro»**.
5. **Verificar:**
   * Lista de clientes muestra únicamente a Luis #2 (Ana cerrada y ausente).
   * Último ID asignado permanece en `2`.
   * En la pestaña **«Eliminar cliente»**, el campo de ID y el botón de acción están deshabilitados sin wallet conectada.

---

## 4. Reconciliación y Recuperación ante Errores

| Incidencia | Diagnóstico | Acción Segura |
| :--- | :--- | :--- |
| **Authority Mismatch** | La clave externa no coincide con `DEVNET_EXPECTED_AUTHORITY`. | El script aborta inmediatamente antes de enviar transacciones. Verificar el archivo en `~/.config/solana/`. |
| **Blockhash Not Found (caducado)** | La red Devnet demoró la confirmación o hubo demora entre preparación y firma. | No reintentar a ciegas. Comprobar la firma en Solana Explorer y consultar el estado on-chain con `fetchTransactionWithRetry` o snapshot de cuenta antes de repetir. |
| **RPC 429 Too Many Requests** | Limitación de tasa del endpoint público de Solana. | Esperar 15-30 segundos o configurar un RPC privado (`DEVNET_RPC_URL` para scripts Node, `VITE_SOLANA_RPC_URL` para el frontend). |

---

## 5. Limpieza Post-Operación
1. Cerrar las pestañas de prueba del navegador o navegar a `about:blank`.
2. Detener el proceso del servidor Vite iniciado para la prueba.
3. Verificar que los puertos `5173` queden liberados (`lsof -i :5173`).
