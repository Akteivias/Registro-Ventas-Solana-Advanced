# Verificación automatizada: baja de cliente

Esta guía recoge la verificación del Día 5 en `clase/resuelto`. El script de Node ejecuta transacciones reales en Devnet; un agente puede usar Chrome DevTools MCP para observar la aplicación sin extensión de wallet. Se incluyen además comprobaciones independientes de interfaz con una wallet simulada que rechaza la firma. Estas no firman ni envían operaciones desde el navegador.

## Comprobaciones del proyecto

Con Node `>=22.12.0 <25`, por ejemplo Node 24:

```bash
fnm exec --using=24 npm run comprobar:idl
fnm exec --using=24 npm run verificar
git diff --check
```

`verificar` ejecuta typecheck, las pruebas `tests/*.test.ts` y el build; el hook `prebuild` comprueba el contrato del IDL. No ejecuta `tests/dia5-devnet.ts` ni la observación en navegador.

## Flujo Devnet con Node

La ejecución requiere el IDL y cliente correspondientes al programa desplegado, acceso RPC a Devnet y un keypair de práctica externo al repositorio. Por defecto usa `https://api.devnet.solana.com` y `~/.config/solana/registro-devnet-tester-keypair.json`; `DEVNET_RPC_URL` y `DEVNET_AUTHORITY_KEYPAIR` permiten cambiar estos valores. Mantén las claves privadas fuera del repositorio y los registros.

```bash
DEVNET_EXPECTED_AUTHORITY=A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t \
  fnm exec --using=24 npm run verificar:devnet
```

El valor de `DEVNET_EXPECTED_AUTHORITY` corresponde a la ejecución registrada; sustitúyelo por la dirección pública esperada si utilizas otro keypair de práctica. Cuando se establece, el script rechaza una autoridad diferente antes de solicitar fondos o enviar transacciones. Comprueba también el programa y la red antes de escribir. **Cada ejecución crea cuentas y envía transacciones en Devnet**: si el saldo es inferior a 0,03 SOL, el script intenta hasta dos airdrops. Una interrupción no revierte transacciones confirmadas; conserva las direcciones y firmas públicas y comprueba cualquier resultado incierto antes de repetir.

El script crea un registro, Ana y Luis, y una venta para Ana. Comprueba el rechazo `ClienteConVentas` durante preflight y que las cuentas no cambian; después devuelve la venta, elimina a Ana y verifica el cierre, la conservación de Luis, `idCounter = 2` y el balance de renta menos comisión. Una simulación fallida en preflight no es una transacción fallida registrada en cadena.

## Observación coordinada en navegador

Para observar cada etapa sin extensión de wallet, inicia la app con `fnm exec --using=24 npm run dev` (ejecuta `--pausar` **en lugar de** la ejecución sin pausa anterior si solo quieres una corrida en Devnet). Ejecuta el mismo script con `--pausar` y la autoridad esperada:

```bash
DEVNET_EXPECTED_AUTHORITY=A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t \
  fnm exec --using=24 node --import tsx tests/dia5-devnet.ts --pausar
```

Un agente puede seguir estos pasos con Chrome DevTools MCP:

1. Antes de iniciar la corrida Devnet, comprueba que el servidor Vite esté listo y que Chrome DevTools MCP pueda abrir la dirección local que muestra Vite. Usa `list_pages`, navega a esa dirección y revisa la vista con `take_snapshot`. Si no funciona, detente antes de enviar transacciones.
2. Inicia una sola ejecución del script con `--pausar`. En la primera pausa, introduce el nombre de negocio y la autoridad pública que imprime esa misma ejecución y pulsa **Consultar registro**. Comprueba en la vista accesible que aparecen Ana con una venta y Luis.
3. Continúa el script con Enter. En la segunda pausa, pulsa **Consultar registro** y comprueba que ambos clientes y la venta permanecen después del rechazo en preflight.
4. Continúa de nuevo con Enter. Después de que termine el script, consulta otra vez y comprueba que Ana ha desaparecido, Luis permanece y el último ID es 2. Contrasta la vista con las firmas, el estado y las cuentas públicas que informa el script.
5. Al terminar, cierra la pestaña de prueba si procede y detén solo el servidor Vite iniciado para la comprobación. No borres perfiles ni artefactos preexistentes.

El script y el navegador deben usar la misma red y los datos de la corrida. Un EOF o interrupción detiene las pausas; conserva las firmas y comprueba los resultados públicos antes de repetir. Chrome DevTools MCP es una herramienta de observación del agente; no requiere agregar un nuevo script de pruebas al proyecto.

## Interfaz: wallet simulada que cancela la firma

Esta comprobación complementa la cancelación de wallet de [PRUEBAS-MANUALES.md](./PRUEBAS-MANUALES.md) y permite observar la validación del formulario de baja habilitado. No requiere un archivo de pruebas nuevo ni extensión. Usa solo la dirección pública de una identidad de prueba; no carga ni expone un keypair. La wallet **siempre rechaza** las solicitudes de firma. Las respuestas RPC siguientes son simuladas: el texto «Devnet verificada» no demuestra en esta prueba una conexión real a Devnet. La sustitución de `fetch` no es un cortafuegos general.

### Cómo aparece «Conectar wallet» sin extensión

Chrome DevTools MCP ejecuta temporalmente el JavaScript de abajo en la pestaña antes de cargar la app. Ese código crea un objeto de prueba y lo anuncia mediante los eventos `wallet-standard:register-wallet` y `wallet-standard:app-ready` de [Wallet Standard](https://github.com/wallet-standard/wallet-standard). La app lo descubre en su selector como **Offline Test Wallet**; al seleccionarlo, su método `standard:connect` devuelve la cuenta pública simulada y la interfaz la muestra como conectada. No se instaló una extensión ni se modificó la implementación de la app para anunciarla.

**Conectar no significa firmar ni enviar.** En esta receta la identidad pública no concede control de la cuenta: `solana:signTransaction` siempre rechaza y no hay clave privada en la página. En la ejecución histórica separada con Devnet real, otra wallet programática entregaba las solicitudes a un proceso Node temporal que sí disponía de un keypair de práctica y podía firmar; la app enviaba las transacciones firmadas. Esa ejecución no usó una extensión, y su firmante no tiene todavía una receta completa reproducible en esta guía. Usa únicamente una pestaña de prueba y nunca inyectes frases de recuperación ni claves privadas en ella.

1. Inicia Vite con `fnm exec --using=24 npm run dev` y comprueba la dirección local que muestra. Abre una pestaña de prueba dedicada con Chrome DevTools MCP. No uses una sesión personal ni una wallet real para esta prueba.
2. Con `list_pages`, identifica el `pageId` real. Usa `navigate_page` para navegar a la dirección local, con `type: "url"` y el siguiente contenido en `initScript` (JavaScript ejecutado antes de cargar la app). La sustitución de `fetch` deja pasar únicamente la carga desde el origen local y devuelve respuestas simuladas para las consultas RPC esperadas; ninguna otra petición RPC obtiene una transacción válida:

   ```js
   (() => {
     const originalFetch = window.fetch.bind(window);
     window.fetch = async (input, init) => {
       const url = new URL(typeof input === 'string' ? input : input.url, location.href);
       if (url.origin === location.origin) return originalFetch(input, init);
       try {
         const request = JSON.parse(typeof init?.body === 'string' ? init.body : '');
         const reply = (q) => {
           let result = null;
           if (q.method === 'getGenesisHash') result = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
           if (q.method === 'getAccountInfo') result = { context: { slot: 1 }, value: q.params?.[0] === 'F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht' ? { data: ['', 'base64'], executable: true, lamports: 1141440, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', rentEpoch: 0, space: 36 } : null };
           if (q.method === 'getLatestBlockhash') result = { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 999999999 } };
           if (q.method === 'getBalance') result = { context: { slot: 1 }, value: 0 };
           return { jsonrpc: '2.0', id: q.id, result };
         };
         return new Response(JSON.stringify(Array.isArray(request) ? request.map(reply) : reply(request)), { status: 200, headers: { 'content-type': 'application/json' } });
       } catch { return new Response('', { status: 403 }); }
     };
     const address = '61mKpgKTsuBpSVrX3o2GtuXkLtcrwFkCSH9gnYVFnUTW';
     const publicKey = new Uint8Array([74,124,141,114,51,140,197,63,223,196,42,160,81,178,246,29,3,208,156,177,47,38,88,190,154,56,102,195,193,211,223,117]);
     const account = Object.freeze({ address, publicKey, chains: ['solana:devnet'], features: ['solana:signTransaction'] });
     let accounts = [];
     const listeners = new Set();
     const wallet = {
       version: '1.0.0', name: 'Offline Test Wallet',
       icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PC9zdmc+',
       chains: ['solana:devnet'], get accounts() { return accounts; },
       features: {
         'standard:connect': { version: '1.0.0', connect: async () => { accounts = [account]; listeners.forEach((f) => f({ accounts })); return { accounts }; } },
         'standard:disconnect': { version: '1.0.0', disconnect: async () => { accounts = []; listeners.forEach((f) => f({ accounts })); } },
         'standard:events': { version: '1.0.0', on: (event, f) => { if (event === 'change') listeners.add(f); return () => listeners.delete(f); } },
         'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async () => { throw new Error('User rejected the request'); } },
       },
     };
     const register = ({ register }) => register(wallet);
     window.addEventListener('wallet-standard:app-ready', (event) => register(event.detail));
     window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
   })();
   ```

3. Usa `take_snapshot`; conecta **Offline Test Wallet** desde **Conectar wallet** si no se conectó automáticamente. Confirma que aparece la dirección abreviada y la autoridad se rellena. Si no aparece la wallet, detente y revisa la configuración de MCP; no importes una clave privada en la página.
4. En **Crear registro**, pulsa el botón de envío. Comprueba el aviso «La firma fue cancelada en la wallet. Puedes volver a intentarlo.» y que no se anuncia una operación confirmada.
5. Selecciona **Eliminar cliente**. Con el campo habilitado, escribe `0` y pulsa **Eliminar cliente**: el navegador debe marcar el ID como inválido por ser menor que 1. Después introduce `1` y pulsa de nuevo: la solicitud llega a la wallet simulada y muestra el mismo aviso de cancelación. Este último paso comprueba el inicio de la solicitud, no la baja de una cuenta existente.
6. Registra la fecha, los resultados observados y cualquier error. Cierra la pestaña de prueba o navega a `about:blank` para retirar el script inyectado, y detén únicamente el servidor Vite iniciado para esta prueba. Una selección de wallet puede permanecer guardada en el perfil de prueba; no limpies datos o perfiles ajenos.

Se observó este recorrido con Chrome DevTools MCP y RPC simulada: cancelación en **Crear registro** y **Eliminar cliente**, e ID `0` inválido. No se comprobó una firma válida, una transacción Devnet, un diálogo de extensión ni la actualización automática tras confirmar.

## Evidencia registrada y límites

### Comprobaciones adicionales del 20 de noviembre de 2026

- **Dirección inválida:** al consultar `invalid-address`, Chrome DevTools MCP observó el error `Expected base58-encoded address string of length in the range [32, 44]. Actual length: 15.` La aplicación siguió disponible. El mensaje observado proviene de la validación y está en inglés.
- **Lectura de otra autoridad con wallet conectada:** una wallet programática que solo rechaza firmas se conectó con la dirección pública `61mKpgKTsuBpSVrX3o2GtuXkLtcrwFkCSH9gnYVFnUTW`. Al consultar `DevnetD5-og2vqf` con la autoridad `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t`, la aplicación mostró a Luis y el contador 2, avisó de que se consultaba otra autoridad y deshabilitó las operaciones de escritura. Esto comprueba la interfaz, no una transacción no autorizada en cadena.
- **Corridas coordinadas (Node + Chrome DevTools MCP):**
  - Para `DevnetD5-pk0h2d`, Chrome mostró a Ana con `CAF01` y a Luis. El script verificó el rechazo en preflight por ventas activas y luego inició la [devolución](https://explorer.solana.com/tx/2nYuWrFd8aFX9k3XEcgrqsDc2DerGBAbLtRnka4GqBewX8e7WGjCBzF1jxRizLYpn9XNqppS8KqmkTWtJX16yo7h?cluster=devnet) y la [baja](https://explorer.solana.com/tx/3rWBPiJaR4qFa7gi1sCgvYNWwtKHELcv5qAqKA7wjVrdo53uw6CUvJ2z2ehbD4LrR8mwj8gD7jMJWYXHXQMF7ws6?cluster=devnet). El script terminó con código 0.
  - Para `DevnetD5-pl0puy`, `tests/dia5-devnet.ts --pausar` ejecutó [crearRegistro](https://explorer.solana.com/tx/66GWMgY52CvBnRSTNeUB7s3KwJB4n2DsmYjkTzy8evgkFV7VvSYq8UVhJbX1TzoEwre5cwSiwb6jXSzAaxz5CsrB?cluster=devnet), [crearAna](https://explorer.solana.com/tx/2YXQ4VbPzztGt1KWmbhCNMoMXqegwsMVcjzQnqiyFzrV7zQ9Ge4cZVdNoGrq1PSUVq4Pff386PDtDxKT5jByHY9Y?cluster=devnet), [crearLuis](https://explorer.solana.com/tx/3NU3b6o74gNUhZznc41ZHTJ6SLrQPvfjysXPAdKsQK6NSMktpjgbfZyfLpjf6ZKC2nd6irF15ZgxC4VmmN2HjdVk?cluster=devnet) y [registrarVenta](https://explorer.solana.com/tx/2f8N2gTACTfms9SAZaJEFwYUyyGVyUKzQCWwZsq33F1DLjHgRoQdX3zDcdw9L79wbfypS6zUB1zEbEoJvh2c1sMf?cluster=devnet). En la primera pausa, Chrome DevTools MCP consultó el negocio y observó 2 clientes (Ana con 1 venta activa `CAF01` de 50 unidades y Luis con 0 ventas) y último ID 2. Tras la pausa, se verificó el rechazo en preflight `ClienteConVentas (0x1773/6003)` y en la segunda pausa la interfaz confirmó que ambas cuentas y la venta permanecieron intactas. Posteriormente, el script ejecutó la [devolución](https://explorer.solana.com/tx/3q84Cp3KtQqXua5GEzQe275pxyp52Fd2TQogMbWgbK7D7BTAYXPLi72eGmkcrB2xTU3fHSM846MEY6YTis7axqSs?cluster=devnet) y la [baja de Ana](https://explorer.solana.com/tx/3kHFgu1uAPdvZpDYMgT3GZerQJYz6RB6BbM5GmHgGGPxyXhDbibcH1sXsP39CYCwJWUaQYUe6VTYM96JzbzYznQ2?cluster=devnet) con reembolso neto de +2.524.840 lamports. La consulta posterior mostró 1 cliente (Luis #2), Ana ausente y último ID 2. El control de «Eliminar cliente» permaneció deshabilitado sin wallet conectada.
- **Intentos preliminares de devolución:** en una prueba anterior sin confirmación de blockhash, una solicitud de devolución caducó y otra se canceló; posteriormente se completaron las comprobaciones documentadas abajo.

En una comprobación posterior, Node usó la autoridad de práctica y los constructores generados para crear la venta `RS001` de Luis en `DevnetD5-pk0h2d`, devolverla y volver a registrar el mismo SKU. Las tres operaciones se observaron con compromiso `confirmed`: [primera venta](https://explorer.solana.com/tx/66q74s8oi8vvuoKFYq8FvtuzLYQDgtPai2Nvm9axXsRp2GoCbWX5jPasWm3fbXSmyiqDa8fyGuVx78SGxsrgx6av?cluster=devnet), [devolución](https://explorer.solana.com/tx/3n4QG3ZTwC9aNY1nFwFi3cCBJW9HubjHRQbWuzpikPuHpTVjVsrrHcpATg89qfF4WAQ3cCqjjCdWrwGfkAFrihZw?cluster=devnet) y [nuevo registro](https://explorer.solana.com/tx/paTxMe3rzyCAp95RmUoxr8SsDzReK1gNqq5vWRAxeg2rT8KkAUTpZLHnwju7si8FUzDgiwRohh7gGtffoMWHUD13?cluster=devnet). Tras la devolución, RPC devolvió la cuenta de venta como ausente; después del nuevo registro volvió a existir. Chrome DevTools MCP consultó el negocio y mostró a Luis, `RS001`, descripción `Reuso` e importe 50. Las escrituras fueron iniciadas y firmadas por CLI; el navegador solo consultó el resultado. La venta permanece activa en ese negocio de prueba.

### Devolución y reutilización desde el navegador

Chrome DevTools MCP inició la devolución y el nuevo registro de `RS001` para Luis en `DevnetD5-pk0h2d` mediante los formularios interactivos de la aplicación:

- **Ejecución previa:** transacciones de [devolución](https://explorer.solana.com/tx/42ZD76aKVZDNsSBALLqdzN76imytxFf3KJbnjbiweU1oKSLshSd1pydmi926YGaLwooMTJB3YRqjyBqqsHbn94wM?cluster=devnet) y [nuevo registro](https://explorer.solana.com/tx/3cbKWShA96fLqof5ZMnWABFWqjUU5FQdhB3TL3rMnNsoMNPTxVEkRq3ZJaTofgZWBYUcusQgXjFmTaN3pd6LupeL?cluster=devnet).
- **Repetición verificada del escenario:** siguiendo el procedimiento de abajo, Chrome DevTools MCP envió las operaciones desde los controles de la aplicación conectada a la `Dedicated Devnet Test Wallet`. Ambas transacciones fueron validadas y firmadas por el firmante local seguro de Node y confirmadas en Devnet:
  - **Devolución de `RS001`:** [hMyyd6NJnwQeMki5Kfc4MVkJsBFwit4kdeXp35UTAYESUkUzGBjGmmE7daWowTods5R87eyLFs7ci9emBcGk8v9](https://explorer.solana.com/tx/hMyyd6NJnwQeMki5Kfc4MVkJsBFwit4kdeXp35UTAYESUkUzGBjGmmE7daWowTods5R87eyLFs7ci9emBcGk8v9?cluster=devnet). La interfaz mostró la confirmación y actualizó automáticamente la lista a cero ventas activas («Sin ventas activas.»).
  - **Re-registro de `RS001` (descripción `Reuso`, importe 50):** [4NfxtNVzQAR863P9XuFJMa4BMxgRwaqWiGbFCQWagjyKRHgMrh697SBHsakALKwGZrfwGeHHXk9qaUGfQGhQVbvi](https://explorer.solana.com/tx/4NfxtNVzQAR863P9XuFJMa4BMxgRwaqWiGbFCQWagjyKRHgMrh697SBHsakALKwGZrfwGeHHXk9qaUGfQGhQVbvi?cluster=devnet). La interfaz confirmó la transacción y reincorporó en vivo la venta activa sin recarga ni consulta manual.

Con esto queda comprobado que tanto la devolución como el re-registro de un mismo SKU funcionan directamente desde los controles de firma e interfaz de la aplicación web, estableciendo la interoperabilidad de Wallet Standard y el refresco reactivo en navegador.

#### Repetir el escenario específico

Esto envía transacciones reales en Devnet y gasta SOL de prueba. Requiere Node 24, dependencias instaladas, Chrome DevTools MCP y el keypair externo de práctica `~/.config/solana/registro-devnet-tester-keypair.json` correspondiente a la autoridad indicada. Comprueba primero que el negocio `DevnetD5-pk0h2d`, Luis #2 y la venta activa `RS001` aún existen. Si no existen, detente: el estado histórico puede cambiar.

1. Desde el proyecto inicia `fnm exec --using=24 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` y comprueba que MCP puede abrir la página.
2. En otra terminal, desde el proyecto, inicia el siguiente firmante temporal. Comprueba Devnet, autoridad, programa y venta; acepta únicamente la devolución seguida de registro con los parámetros exactos, comparando el mensaje compilado completo y comprobando el blockhash. `READY` muestra un puerto y token únicos. El token da acceso al firmante durante la prueba: no lo compartas ni lo guardes.

```bash
fnm exec --using=24 node --import tsx --input-type=module -e 'import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {homedir} from "node:os";
import {Connection,Keypair,PublicKey,Transaction,TransactionInstruction} from "@solana/web3.js";
import {address,createNoopSigner,AccountRole} from "@solana/kit";
import {getRegistrarVentaInstruction,getHacerDevolucionInstruction,REGISTRO_PROGRAM_ADDRESS} from "./clients/js/src/generated/index.ts";
import {cadena} from "./src/solana/pdas.ts";
const c=new Connection("https://api.devnet.solana.com","confirmed");
if(await c.getGenesisHash()!=="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")throw Error("wrong cluster");
const k=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(homedir()+"/.config/solana/registro-devnet-tester-keypair.json","utf8"))));
if(k.publicKey.toBase58()!=="A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t"||String(REGISTRO_PROGRAM_ADDRESS)!=="F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht")throw Error("identity mismatch");
const biz="DevnetD5-pk0h2d",sku="RS001",idCliente=2,owner=createNoopSigner(address(k.publicKey.toBase58())),p=cadena(biz,owner.address,idCliente,sku);
if(!await c.getAccountInfo(new PublicKey(p.venta)))throw Error("sale missing");
const program=await c.getAccountInfo(new PublicKey(REGISTRO_PROGRAM_ADDRESS));if(!program?.executable)throw Error("program missing");
const token=randomBytes(24).toString("hex"); let stage=0; 
const server=createServer(async(req,res)=>{const origin=req.headers.origin; res.setHeader("Access-Control-Allow-Origin","http://127.0.0.1:5173");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Test-Token"); if(req.method==="OPTIONS"){res.writeHead(204);return res.end();} if(req.method!=="POST"||origin!=="http://127.0.0.1:5173"||req.headers["x-test-token"]!==token){res.writeHead(403);return res.end();}
try {let body="";for await(const x of req){body+=x;if(body.length>10000)throw Error("oversized");} const data=JSON.parse(body); if(stage>=2)throw Error("done");const tx=Transaction.from(Buffer.from(data.bytes)); if(!tx.recentBlockhash||(await c.isBlockhashValid(tx.recentBlockhash,"confirmed")).value!==true)throw Error("stale blockhash"); const ix=stage===0?getHacerDevolucionInstruction({owner,...p,idCliente,sku}):getRegistrarVentaInstruction({owner,...p,idCliente,sku,descripcion:"Reuso",monto:50}); const keys=ix.accounts.map(a=>({pubkey:new PublicKey(a.address),isSigner:[AccountRole.READONLY_SIGNER,AccountRole.WRITABLE_SIGNER].includes(a.role),isWritable:[AccountRole.WRITABLE,AccountRole.WRITABLE_SIGNER].includes(a.role)})); const expected=new Transaction({feePayer:k.publicKey,recentBlockhash:tx.recentBlockhash}).add(new TransactionInstruction({programId:new PublicKey(ix.programAddress),keys,data:Buffer.from(ix.data)}));if(!tx.serializeMessage().equals(expected.serializeMessage()))throw Error("unexpected message"); tx.partialSign(k);const sig=tx.signature; if(!sig)throw Error("missing signature"); const signed=tx.serialize(); console.log("SIGNED",stage,Buffer.from(sig).toString("base64"));stage++;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({bytes:Array.from(signed)}));}catch(e){console.error("REJECT",String(e));res.writeHead(400);res.end();}});
server.listen(0,"127.0.0.1",()=>console.log("READY",server.address().port,token));'
```

3. En una pestaña de prueba, usa Chrome DevTools MCP `navigate_page` hacia `http://127.0.0.1:5173/` con el siguiente `initScript`. Sustituye antes `PORT` y `TOKEN` con los valores de `READY`; nunca inyectes la clave privada en la página.

```js
(()=>{const address="A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t",publicKey=new Uint8Array([135,173,108,71,72,25,121,41,224,149,54,46,248,174,18,67,176,134,11,117,9,161,37,170,219,176,23,88,28,69,62,161]);const account=Object.freeze({address,publicKey,chains:["solana:devnet"],features:["solana:signTransaction"]});let accounts=[];const listeners=new Set();const wallet={version:"1.0.0",name:"Dedicated Devnet Test Wallet",icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PC9zdmc+",chains:["solana:devnet"],get accounts(){return accounts},features:{"standard:connect":{version:"1.0.0",connect:async()=>{accounts=[account];listeners.forEach(f=>f({accounts}));return {accounts}}},"standard:disconnect":{version:"1.0.0",disconnect:async()=>{accounts=[];listeners.forEach(f=>f({accounts}))}},"standard:events":{version:"1.0.0",on:(event,f)=>{if(event==="change")listeners.add(f);return()=>listeners.delete(f)}},"solana:signTransaction":{version:"1.0.0",supportedTransactionVersions:["legacy",0],signTransaction:async(...inputs)=>{if(inputs.length!==1||inputs[0].chain!=="solana:devnet")throw Error("unexpected request");const r=await fetch("http://127.0.0.1:PORT",{method:"POST",headers:{"Content-Type":"application/json","X-Test-Token":"TOKEN"},body:JSON.stringify({bytes:Array.from(inputs[0].transaction)})});if(!r.ok)throw Error("test signer refused");const result=await r.json();return [{signedTransaction:new Uint8Array(result.bytes)}]}}}};const register=({register})=>register(wallet);window.addEventListener("wallet-standard:app-ready",e=>register(e.detail));window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet",{detail:register}));})();
```

4. Conecta **Dedicated Devnet Test Wallet**, consulta `DevnetD5-pk0h2d` con autoridad `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t` y verifica Luis #2 y `RS001`. Selecciona **Devolución**, introduce ID 2 y SKU `RS001`, envía y verifica la confirmación y cero ventas. En **Registrar venta**, usa ID 2, `RS001`, descripción `Reuso` e importe 50; verifica confirmación y reaparición sin consulta manual. Guarda las firmas públicas.
5. Cierra la pestaña de prueba o navega a `about:blank` y detén solo los procesos Node y Vite iniciados. Si hay interrupción o timeout después de firmar, comprueba la firma y las cuentas antes de reintentar: el proceso imprime la firma en base64 y la interfaz enlaza la firma al confirmar. Un blockhash caducado antes de firmar causa rechazo; revisa el estado antes de reiniciar.

Este puente local es solo para pruebas: el token y el origen restringen solicitudes, pero no aíslan frente a procesos locales privilegiados ni sustituyen una wallet de producción. Úsalo únicamente con el keypair de práctica en un entorno local confiable. No prueba una extensión real ni implementa otros escenarios de firma.

En una ejecución Devnet posterior para `DevnetD5-pivj6f`, un comando Node independiente corrigió el importe de la venta `CAF01` de 50 a 55; la [transacción de corrección](https://explorer.solana.com/tx/4Ti5iWktyjj7vtFbhJ146tSXRTv9FQ6fwNaBACmefRfQdWuxoTkKsmJLn5JHBwHMEHQiUEKeR84AyPhiQ9VhoRm1?cluster=devnet) se confirmó y el navegador mostró 55 tras pulsar **Consultar registro**. Un intento de crear otra venta con el mismo SKU fue rechazado en preflight porque la cuenta ya existía; los datos, dueños y lamports del registro, cliente y venta permanecieron sin cambios. Estos dos intentos se iniciaron con Node, no con la interfaz de la app.

En esa misma ejecución, el script pausado devolvió la venta y confirmó la [baja de Ana](https://explorer.solana.com/tx/4mSH87DjBMPvRe3UWvdKugC65pvdjVak1fT9naoKrMk9opFgiVuUNHq3KigdEPphktY3AvfQoJ4TBSXymjm9MjVe?cluster=devnet). Después se inició desde el navegador una solicitud separada para eliminar a Luis con una wallet de prueba programática, pero el blockhash caducó antes de validarla y firmarla: no se devolvió ni envió ninguna transacción firmada para ese intento, y no se verificó el refresco automático. No se debe atribuir el resultado de la baja de Ana a ese intento en el navegador.

Posteriormente, en ese mismo negocio `DevnetD5-pivj6f`, se comprobó un recorrido iniciado desde la app con Chrome DevTools MCP y una wallet programática de práctica, sin extensión. El agente conectó la identidad pública, mientras un proceso Node temporal mantuvo el keypair fuera de la página. Antes de cada firma, el proceso comprobó Devnet, autoridad, blockhash y la igualdad exacta con una instrucción esperada para el registro y el cliente de prueba. No se guardó un nuevo archivo de pruebas ni se cargó la clave privada en el navegador.

- La app creó la venta `TEA01` por 50 y la mostró sin consulta manual: [transacción](https://explorer.solana.com/tx/2szdTaVsjStJdVcEmrJdxXHEmfqRxN2X4MK2sBM5W98QqK1ErJh7jnrucC6W9ei2CQ7cQidYbwrxwbRobkJFgJ2D?cluster=devnet).
- La app corrigió el importe a 55 y mostró 55 sin pulsar **Consultar registro**: [transacción](https://explorer.solana.com/tx/5EdMKryQiYjCQ2GkDUW4aRvPRMfnidcRqCBY1zRk2i7waf9zLoXJPwMusLwARwS7xLE68VabXJDt2HDF14fNQWoe?cluster=devnet).
- Al intentar registrar nuevamente `TEA01`, la app mostró «Esa cuenta ya existe. El mismo cliente solo puede tener una venta activa por SKU.» La venta y su importe 55 permanecieron visibles. La firma preparada no implica una transacción fallida en cadena: el intento fue rechazado antes de una confirmación.
- Tras la [devolución](https://explorer.solana.com/tx/4rCNdW4Y9r3kc9MrbhvcpgoU7RDcu3r2sdJoppMVWRTDKqY4ixjUybGwk6MVYRjTJgNyZHUmh8sHFaKb58TRHbdN?cluster=devnet), la app inició la [baja de Luis](https://explorer.solana.com/tx/5jtKgQDtrGwipqPK9TWAowkcLTA8hxmi8op2s11YpQG4syzyCLWgUc1JK54UhgpTxh9nxmDDgQjPJNVtEsM1r1XS?cluster=devnet). Sin consultar ni recargar manualmente, mostró cero clientes y último ID 2. Una consulta RPC posterior devolvió la cuenta Cliente cerrada y la transacción `finalized`, sin error, en el slot `524501136`.

Este recorrido fue una comprobación interactiva puntual, no una prueba autónoma reproducible desde un comando ni una demostración de una extensión de wallet real. El proceso firmante requiere controles explícitos para cada operación y aislamiento de la clave; no se debe sustituir por inyectar un keypair privado en la página. El RPC y Devnet pueden cambiar, por lo que otra ejecución necesita nuevas cuentas y resultados propios.

AGY reportó una ejecución coordinada para `DevnetD5-og2vqf`: el navegador mostró dos clientes antes y después del rechazo en preflight y, después de la devolución y la baja, solo a Luis con contador 2. La [transacción de baja](https://explorer.solana.com/tx/5rFy5gaDEixS4AhE2bAADjw6FX88BrgmWJqzjb5rwjuRc3MiCbtC83nWwEiADwf7uMQzrCf6PbR5ZHPmczD4wnDT?cluster=devnet) fue observada como exitosa y finalizada en el slot `524223660`. Los resultados de otra ejecución deben verificarse de nuevo; no se presupone que estas cuentas sigan disponibles.

El 20 de noviembre de 2026, una consulta de solo lectura con Chrome DevTools MCP abrió ese negocio con la autoridad pública `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t` y mostró a Luis como único cliente y último ID 2. Esa consulta no repitió la baja ni el rechazo y no envió transacciones.

---

## Verificación en navegador del aporte de monto cero (post-upgrade)

Tras actualizar `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht` en Devnet (slot `524962328`), la cobertura sin extensión se divide en dos comprobaciones distintas:

1. **Bloqueo de formulario en navegador (`npm run verificar:browser` — `tests/dia5-browser.ts`):**
   - Con `Offline Test Wallet`, tanto **Registrar venta** (`Importe = 0`) como **Corregir importe** (`Nuevo importe = 0`) son bloqueados por la validación nativa HTML5 (`min="1"`, `validity.rangeUnderflow === true`, `validity.valid === false`) **antes** de invocar `solana:signTransaction` (`__offlineSignCalls` no se incrementa).
   - Un control positivo en ambos formularios con `monto = 1` sí alcanza `solana:signTransaction` (`__offlineSignCalls` + 1) y muestra «La firma fue cancelada en la wallet».
   - *Alcance:* Esto demuestra únicamente bloqueo del formulario en cliente, **no** rechazo on-chain (`MontoInvalido` `6004` / `0x1774` se comprueba por CLI en `tests/dia5-devnet.ts` y `tests/dia5-local.ts`).
2. **Recorrido repetible en Devnet desde navegador sin extensión (`DevnetZ0-*` + firmante Node temporal):**

   Este procedimiento ejecuta el flujo positivo completo (`crear_registro` $\to$ `crear_cliente` `Ana` $\to$ `registrar_venta` `CAF01` `monto: 50` $\to$ `cambiar_monto` `CAF01` `nuevo_monto: 55`) desde los formularios de la app sin extensión de wallet. El bloqueo con `monto = 0` se comprueba en Suite 1 (`tests/dia5-browser.ts`) y el rechazo on-chain `MontoInvalido` (`6004` / `0x1774`) se comprueba por CLI en `tests/dia5-devnet.ts` y `tests/dia5-local.ts`.

   - **Prerrequisitos y negocio nuevo:**
     - Keypair externo fuera del repo: por defecto `~/.config/solana/registro-devnet-tester-keypair.json`, o define `DEVNET_AUTHORITY_KEYPAIR=<ruta-externa>` para usar **tu propio** keypair de práctica en Devnet (verificado con `assertExternalPath` y saldo `>= 30_000_000` lamports = `0.03 SOL`). Nunca copies claves privadas ni frases semilla al repo ni al navegador, ni solicites el keypair del autor.
     - Servidor Vite local en una terminal dedicada:
       ```bash
       fnm exec --using=24 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
       ```
     - El firmante genera un nombre nuevo `DevnetZ0-<sufijo>`, comprueba génesis de Devnet (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`), `REGISTRO_PROGRAM_ADDRESS` (`F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht`, `executable: true`) y que la PDA `registro` aún no exista (`null`).

   - **Firmante temporal Node en `127.0.0.1` (4 etapas ordenadas usando `tests/helpers/firmante-temporal.ts`):**
     Ejecuta el proceso en segundo plano; imprimirá `READY <PORT> <TOKEN> <BIZ> <PUBKEY> <STATE_PATH>`:
     ```bash
     fnm exec --using=24 node --import tsx --input-type=module -e '
     import { createServer } from "node:http";
     import { randomBytes } from "node:crypto";
     import { readFileSync } from "node:fs";
     import { homedir } from "node:os";
     import { join } from "node:path";
     import { Connection, Keypair, PublicKey } from "@solana/web3.js";
     import { REGISTRO_PROGRAM_ADDRESS } from "./clients/js/src/generated/index.ts";
     import { assertExternalPath } from "./tests/dia5-devnet.ts";
     import { crearManejadorFirmante } from "./tests/helpers/firmante-temporal.ts";

     const c = new Connection("https://api.devnet.solana.com", "confirmed");
     if (await c.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw Error("wrong cluster");
     if (String(REGISTRO_PROGRAM_ADDRESS) !== "F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht") throw Error("wrong program id");
     const programInfo = await c.getAccountInfo(new PublicKey(REGISTRO_PROGRAM_ADDRESS), "confirmed");
     if (!programInfo?.executable) throw Error("program not executable");

     const rawKeyPath = process.env.DEVNET_AUTHORITY_KEYPAIR || join(homedir(), ".config/solana/registro-devnet-tester-keypair.json");
     const keyPath = assertExternalPath(rawKeyPath, process.cwd());
     const k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
     const bal = await c.getBalance(k.publicKey, "confirmed");
     if (bal < 30_000_000) throw Error(`insufficient balance: ${bal}`);

     const resumeBiz = process.env.DEVNET_Z0_BIZ?.trim();
     const modo = resumeBiz ? "reanudar" : "nuevo";
     const biz = resumeBiz || "DevnetZ0-" + Date.now().toString(36).slice(-6);
     const statePath = assertExternalPath(join(homedir(), `.config/solana/registro-firmante-state-${biz}.json`), process.cwd());
     const manejador = crearManejadorFirmante({ connection: c, keypair: k, biz, statePath, modo });
     await manejador.verificarInicio();

     const token = randomBytes(24).toString("hex");
     const server = createServer(async (req, res) => {
       const origin = req.headers.origin;
       res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
       res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Test-Token");
       if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
       if (req.method !== "POST" || origin !== "http://127.0.0.1:5173" || req.headers["x-test-token"] !== token) {
         res.writeHead(403); return res.end();
       }
       try {
         let body = "";
         for await (const chunk of req) { body += chunk; if (body.length > 10_000) throw Error("oversized"); }
         const data = JSON.parse(body);
         const out = await manejador.procesar(data.bytes);
         if (out.status !== 200) {
           console.error("REJECT", out.status, out.error);
           res.writeHead(out.status);
           return res.end(JSON.stringify({ error: out.error }));
         }
         console.log(`SIGNED stage=${out.stage} sig=${out.sig}`);
         res.setHeader("Content-Type", "application/json");
         res.end(JSON.stringify({ bytes: out.bytes }));
       } catch (e) {
         console.error("REJECT", String(e));
         res.writeHead(400); res.end();
       }
     });
     server.listen(0, "127.0.0.1", () => {
       const addr = server.address();
       console.log(`READY ${addr.port} ${token} ${biz} ${k.publicKey.toBase58()} ${statePath}`);
       console.log(`PUBLIC_KEY_BYTES ${JSON.stringify(Array.from(k.publicKey.toBytes()))}`);
     });
     '
     ```
     *Restricciones del firmante (`tests/helpers/firmante-temporal.ts`):* solo acepta `POST` desde `Origin: http://127.0.0.1:5173` con `X-Test-Token` válido, cuerpo `<= 10_000` bytes, solicitudes serializadas (`inFlight`), `isBlockhashValid`, mensaje compilado (`tx.serializeMessage()`) idéntico al construido independientemente con `pdaRegistro`/`pdaCliente`/`pdaVenta` y los builders Codama + `aWeb3`, registro de `{ sig, blockhash }` en disco fuera del repo antes de responder, bloqueo conservador de re-firma ante estado `null` o `processed` (`409`, sin inferir expiración desde un `getLatestBlockhash()` posterior no relacionado), avance de etapa únicamente cuando **ambos** (la firma previa `confirmed`/`finalized` con `err === null` y la cuenta esperada on-chain) se confirman, y reintento únicamente cuando una firma previa quedó `confirmed`/`finalized` con `err !== null` sin mutar la cuenta.

   - **Reinicio del firmante tras interrupción:**
     - Al reiniciar para el mismo negocio, pasa `DEVNET_Z0_BIZ=<BIZ>` (`modo: "reanudar"`): el firmante exige que exista y sea válido `~/.config/solana/registro-firmante-state-<BIZ>.json`, restaura las firmas pendientes y falla cerrado (`409`) si alguna firma sigue sin resolverse (`status === null` o `processed`).
     - Si el archivo de estado falta o está corrupto en `modo: "reanudar"` (incluso en etapa 0 cuando `registro` aún es `null` on-chain) o si en `modo: "nuevo"` ya existe `registro` o el archivo de estado, el firmante falla cerrado al arrancar; debes reconciliar manualmente la última firma impresa (`SIGNED stage=... sig=...`) con `getSignatureStatuses` y la PDA correspondiente antes de continuar.

   - **Inicialización del navegador (Chrome DevTools CLI / MCP):**
     Sustituye `PORT` y `TOKEN` por los impresos en `READY`. Si usas **tu propio** keypair (`DEVNET_AUTHORITY_KEYPAIR`), sustituye también `address` por tu `<PUBKEY>` y `publicKey` por el arreglo `PUBLIC_KEY_BYTES` de 32 bytes públicos que imprime el firmante (no uses `PublicKey` dentro del navegador ni copies bytes privados); inicia una pestaña limpia (`new_page` `about:blank`) y navega a `http://127.0.0.1:5173/` con este `initScript` (solo clave pública, sin secretos):
     ```js
     (()=>{const address="A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t",publicKey=new Uint8Array([135,173,108,71,72,25,121,41,224,149,54,46,248,174,18,67,176,134,11,117,9,161,37,170,219,176,23,88,28,69,62,161]);const account=Object.freeze({address,publicKey,chains:["solana:devnet"],features:["solana:signTransaction"]});let accounts=[];const listeners=new Set();const wallet={version:"1.0.0",name:"Dedicated Devnet Test Wallet",icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PC9zdmc+",chains:["solana:devnet"],get accounts(){return accounts},features:{"standard:connect":{version:"1.0.0",connect:async()=>{accounts=[account];listeners.forEach(f=>f({accounts}));return {accounts}}},"standard:disconnect":{version:"1.0.0",disconnect:async()=>{accounts=[];listeners.forEach(f=>f({accounts}))}},"standard:events":{version:"1.0.0",on:(event,f)=>{if(event==="change")listeners.add(f);return()=>listeners.delete(f)}},"solana:signTransaction":{version:"1.0.0",supportedTransactionVersions:["legacy",0],signTransaction:async(...inputs)=>{if(inputs.length!==1||inputs[0].chain!=="solana:devnet")throw Error("unexpected request");const r=await fetch("http://127.0.0.1:PORT",{method:"POST",headers:{"Content-Type":"application/json","X-Test-Token":"TOKEN"},body:JSON.stringify({bytes:Array.from(inputs[0].transaction)})});if(!r.ok)throw Error("test signer refused");const result=await r.json();return [{signedTransaction:new Uint8Array(result.bytes)}]}}}};const register=({register})=>register(wallet);window.addEventListener("wallet-standard:app-ready",e=>register(e.detail));window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet",{detail:register}));})();
     ```

   - **Pasos en navegador y resultados esperados:**
     1. Pulsa **Conectar wallet** $\to$ **Dedicated Devnet Test Wallet** y escribe `<BIZ>` en **Nombre exacto del negocio**.
     2. **Etapa 0 (`Crear registro`):** envía el formulario $\to$ espera `Operación confirmada.` y `<BIZ>` en la UI.
     3. **Etapa 1 (`Crear cliente`):** abre la pestaña, escribe `Ana` en **Nombre del cliente** y envía $\to$ espera `Operación confirmada.` y `Ana` (`Cliente #1`). Si el snapshot expira antes de reflejarlo, consulta `<BIZ>` con **Consultar registro** para confirmar `Ana` antes de pasar a la etapa 2.
     4. **Etapa 2 (`Registrar venta`):** introduce `ID del cliente = 1`, `SKU = CAF01`, `Descripción = Cafe americano`, `Importe = 50` y envía $\to$ espera `Operación confirmada.`, `CAF01` y `50` en la UI.
     5. **Etapa 3 (`Corregir importe`):** introduce `ID del cliente = 1`, `SKU = CAF01`, `Nuevo importe = 55` y envía $\to$ espera `Operación confirmada.` y `55` en la UI.

   - **Captura de firmas y reconciliación tras resultado incierto:**
     - El firmante imprime `SIGNED stage=<n> sig=<base58>` y guarda la firma en `signedSigs`.
     - Ante timeout de UI o error de red tras firmar, consulta `getSignatureStatuses([sig], { searchTransactionHistory: true })` y la PDA correspondiente (`registro`, `ana` o `venta`) antes de reintentar: si la transacción ya se confirmó, el firmante rechaza re-firmar esa etapa y avanza a la siguiente al verificar la cuenta on-chain.

   - **Limpieza:**
     - Navega la pestaña de prueba a `about:blank` y, solo si iniciaste un daemon de `chrome-devtools` exclusivamente para esta prueba (no si ya había uno del usuario en ejecución), ejecuta `chrome-devtools stop`; detén únicamente el firmante temporal Node y el servidor Vite iniciados para el recorrido.

   - **Ejecución observada (`DevnetZ0-ri6q6g`, autoridad `A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t`, Chrome DevTools CLI):**
     - Etapa 0 (`crear_registro`): [`5WeZS2Tx...`](https://explorer.solana.com/tx/5WeZS2TxjqyJK2GFuuoQomGHwoQSoAKkgMYJh3mR3Vmg64cVpq1i4YsoW3xd3sYCizYDtGURE4Uvkc31kAqT1GxR?cluster=devnet) (`finalized`, slot `524993689`, refresco en vivo).
     - Etapa 1 (`crear_cliente` `Ana`): [`5cWShCWj...`](https://explorer.solana.com/tx/5cWShCWjw2sBV65pWrWUwsK5bXcekfXn1doNcqTRZCHPLahSwB3aM4iwDSLfBaKqFaGa78erCY45sqz2G36sUFaZ?cluster=devnet) (`finalized`, slot `524993720`, `Ana` visible tras pulsar **Consultar registro** en una segunda sesión de navegador).
     - Etapa 2 (`registrar_venta` `CAF01`, `monto: 50`): [`4pgHEmSk...`](https://explorer.solana.com/tx/4pgHEmSkAw5qGepM6WD1T9tanNhsdvxC32C2GmXBAkamSV7QTLyjv7rwpjpYr8VDUnU8vyBmEiYSdM17xc67i8Sw?cluster=devnet) (`finalized`, slot `524994194`, refresco en vivo mostró `CAF01` y `50`).
     - Etapa 3 (`cambiar_monto` `CAF01`, `nuevo_monto: 55`): [`5yu452FR...`](https://explorer.solana.com/tx/5yu452FRYrPziwCGB1HXErnwYdpDEEiMmMffz8v5TGE5ZqHQPTNJPc6TaiPmWtk1RyjMUWDGDqKvnicLdGs1DvfK?cluster=devnet) (`finalized`, slot `524994231`, refresco en vivo mostró `55`).
   - *Límite:* Utiliza un puente Wallet Standard programático local; no prueba una extensión de navegador instalada por el usuario (Phantom/Solflare). La sesión de `DevnetZ0-ri6q6g` no registró explícitamente `--isolated` ni la ruta de perfil de Chrome en tiempo de ejecución.

3. **Comando opt-in repetible (`npm run verificar:browser:devnet` — `tests/dia5-browser-devnet.ts`):**
   - A diferencia de `npm run verificar:browser` (sin clave ni escrituras en Devnet), `verificar:browser:devnet` es **opt-in**: exige `DEVNET_EXPECTED_AUTHORITY`, carga el keypair externo del revisor (`DEVNET_AUTHORITY_KEYPAIR` o `~/.config/solana/registro-devnet-tester-keypair.json`, `>= 0.03 SOL`), verifica génesis/programa/saldo, inicia `tests/helpers/firmante-temporal.ts` + Vite + `chrome-devtools-mcp@1.13.0` (`--isolated`, `1280x800`) con un `XDG_RUNTIME_DIR` propio por ejecución (`.aula/r/<id>`, respetando el límite de `sun_path` en macOS) para no adjuntarse ni detener daemons ajenos.
   - Comprueba primero el bloqueo de `monto = 0` en **Registrar venta** y **Corregir importe** (`rangeUnderflow=true`, retroalimentación visible vía `reportValidity()` y cero llamadas nuevas a `window.__signCalls` en `http://127.0.0.1:5173`), ejecuta las 4 transacciones positivas (`crear_registro`, `crear_cliente`, `registrar_venta`, `cambiar_monto`), reconcilia firmas y valida estado decodificado en cadena + UI. En caso de fallo o interrupción, no reintenta automáticamente transacciones inciertas ni ofrece reanudación parcial; emite un reporte de recuperación con negocio, autoridad, PDAs, ruta de estado y todas las firmas conocidas.
   - **Grabación y Explorer opcionales (`--grabar <ruta.mp4>`, `--explorer`):** Graba la sesión en `.aula/local-runs/` (ignorado por Git, fallando si el archivo destino ya existe) mediante `screencast_start`. Con `--explorer`, cierra antes el servidor loopback de firma (`server.close()`) y navega la misma pestaña a las páginas de Solana Explorer Devnet (programa desplegado, transacciones actuales e históricas de monto cero, comprobando `originCheck` sin `__signCalls` fuera de `127.0.0.1:5173`). Opcionalmente convierte a GIF con `ffmpeg`:
     ```bash
     DEVNET_EXPECTED_AUTHORITY=TU_PUBKEY_DEVNET DEVNET_AUTHORITY_KEYPAIR=~/.config/solana/tu-devnet-tester-keypair.json \
       fnm exec --using=24 npm run verificar:browser:devnet -- --grabar .aula/local-runs/walkthrough-reviewer-v2.mp4 --explorer
     ffmpeg -y -i .aula/local-runs/walkthrough-reviewer-v2.mp4 \
       -vf "fps=8,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
       .aula/local-runs/walkthrough-reviewer-v2.gif
     ```
   - *Separación de pruebas:* Las aserciones automáticas prueban el bloqueo UI (`rangeUnderflow` / `signCalls`), la confirmación on-chain, las cuentas decodificadas y el DOM; el video/GIF aporta evidencia visual opcional y no incluye claves ni tokens. El rechazo on-chain de monto cero (`MontoInvalido` `6004`) se verifica por separado en `verificar:devnet` y `scripts/probar-local.mjs`.

   Una repetición posterior del firmante actualizado con Chrome DevTools MCP y un contexto aislado está registrada en [PRUEBAS-Y-EVIDENCIAS.md](./PRUEBAS-Y-EVIDENCIAS.md), con sus cuatro firmas y límites.

La combinación coordinada de Node y consultas del navegador verifica operaciones iniciadas por CLI y lecturas posteriores; por sí sola no verifica firma en navegador ni refresco automático. Esas conductas se observaron por separado en los recorridos de wallet simulada y wallet programática indicados arriba, con sus respectivos límites. Para los demás casos de interfaz, consulta [PRUEBAS-MANUALES.md](./PRUEBAS-MANUALES.md).

La prueba defensiva `NoCliente` con un cliente ausente del índice se registró por separado en la rama `dia5/local-verification`; no forma parte de este flujo Devnet. Para el historial local y sus requisitos, consulta [DIA-5-VALIDACION.md](./DIA-5-VALIDACION.md). No ejecutes los scripts `clase:dia3`, `clase:dia4` o `clase:resuelto` en este árbol para preparar estas pruebas: pueden sobrescribir la implementación.
