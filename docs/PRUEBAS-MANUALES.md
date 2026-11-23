# Pruebas manuales antes de clase

El proyecto ya cuenta con un despliegue en Devnet (`F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht`, IDL importado en `src/config/programa.json` con `"esReferencia": false`) y se reportó como completada una comprobación coordinada de CLI + observación en navegador para la baja de clientes del día 5 (sin Solflare ni extensiones de wallet). Esto **no** implica que todos los casos manuales de esta guía hayan sido ejecutados en navegador.

## Evidencia coordinada CLI + navegador (Día 5)

Para los comandos y límites de las comprobaciones automatizadas, consulta [PRUEBAS-AUTOMATIZADAS.md](./PRUEBAS-AUTOMATIZADAS.md).

- **Qué ejecutó cada parte:** El CLI (`tests/dia5-devnet.ts --pausar`) inició y firmó las operaciones en Devnet con un keypair de prueba dedicado; el navegador (`npm run dev` + Playwright) consultó (`Consultar registro`) y mostró el estado del registro antes y después de cada etapa (`DevnetD5-og2vqf`).
- **Resultados observados:** El rechazo por venta activa (`ClienteConVentas`, `0x1773` / `6003`) se observó en simulación preflight sin transacción en cadena; la baja exitosa tras la devolución (`5rFy5gaDEixS4AhE2bAADjw6FX88BrgmWJqzjb5rwjuRc3MiCbtC83nWwEiADwf7uMQzrCf6PbR5ZHPmczD4wnDT`, slot `524223660`) alcanzó estado `finalized` en Devnet.
- **Límites de esta evidencia:** Esta comprobación coordinada **no** verificó la baja iniciada desde el navegador, la firma desde una wallet en el navegador, la validación interactiva sobre un formulario habilitado ni el refresco automático (`cargar()`) tras una transacción iniciada desde la app.

## Preparación

- Verificar contrato e IDL (`npm run comprobar:idl && npm run verificar`); si hace falta importar otro IDL, usar `npm run configurar:idl -- <ruta>` (no ejecutar `npm run clase:resuelto` en esta rama porque sobrescribe `src/solana/acciones.ts`).
- Abrir la app en el navegador (solo si vas a realizar las pruebas opcionales con wallet en navegador, conecta una wallet de práctica compatible con Wallet Standard).
- Confirmar el RPC de Devnet y disponer de SOL de prueba.
- Elegir un nombre nuevo de negocio, de hasta 30 bytes UTF-8.

## Recorrido funcional (pruebas manuales opcionales con wallet en navegador)

Estos casos son **separados y opcionales** respecto a la comprobación coordinada CLI + navegador ya completada; sirven si se desea ejercitar firmas directamente desde una wallet en el navegador (por ejemplo, una extensión Wallet Standard o una wallet programática de prueba).

| Caso | Resultado esperado |
| --- | --- |
| Consultar saldo sin conectar wallet | Lectura pública; ninguna firma. |
| Pegar una dirección inválida | Error comprensible; la página sigue operativa. |
| Crear registro | Confirmación y lectura del registro de esa autoridad. |
| Crear Ana | Cliente ID 1; dirección presente en Registro. |
| Vender CAF01 por 50 | Venta presente, compras activas 1 y cuenta Venta decodificable. |
| Corregir importe a 55 | Mismo SKU y PDA, monto actualizado. |
| Repetir CAF01 antes de devolverlo | Rechazo del programa; no se informa éxito ni se duplica el historial. |
| Cancelar una solicitud en la wallet | Aviso de cancelación; no se anuncia operación confirmada. |
| Hacer devolución | Se cierra Venta, desaparece del historial y compras disminuye. |
| Registrar CAF01 después de devolverlo | Puede crearse otra vez porque la cuenta anterior se cerró. |
| Eliminar cliente con venta activa | Rechazo por `ClienteConVentas`; el cliente permanece en la lista y en cadena. |
| Eliminar cliente sin ventas activas | Transacción confirmada en Devnet; el cliente desaparece de la lista sin disminuir `id_counter`. |
| Consultar otra autoridad desde la app | Lectura permitida; formularios de escritura deshabilitados. |

El bloqueo visual de otra autoridad no demuestra por sí mismo el control onchain. Para documentarlo, utiliza también el cliente de Playground de los días 1–2 y una cuenta/autoridad que no corresponda; comprueba que las restricciones del programa rechacen el intento.

## Estados de error que hay que explicar

- Un fallo de preflight puede detectarse antes de que una transacción llegue a procesarse. No siempre habrá una transacción fallida visible en Explorer.
- Una firma enviada no equivale a ejecución exitosa; el resultado de confirmación incluye `err`.
- Si se pierde la confirmación, consulta la firma antes de repetir la operación.
- Un fallo de lectura después de confirmar no revierte una operación ya ejecutada.

## Evidencia para la sesión y el milestone

Guarda código/revisión utilizados, Program ID, direcciones públicas de las cuentas, firmas cuando existan, resultado esperado y resultado observado. Para rechazos de preflight pueden servir los logs y la explicación de la restricción que los causó.

No incluyas claves privadas, frases de recuperación ni datos personales reales de clientes.
