# Registro de Ventas · App

![Registro de Ventas · App — Solana, TypeScript y React](./images/banner-app.png)

Aplicación educativa con **TypeScript, React y un programa Rust + Anchor** para registrar ventas en **Solana Devnet**, basada en el proyecto guiado [Registro de Ventas con PDAs](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA) de WayLearn.

Forma parte del **Solana Engineering Track: Advanced** de WayLearn. Aquí conectamos lo aprendido sobre cuentas, instrucciones y PDAs con una aplicación que se utiliza desde el navegador.

## Proyecto final: Registro de ventas

- **Ruta y punto de partida:** Proyecto guiado (*Registro de ventas*) sobre [`Akteivias/Registro-Ventas-Solana-Advanced`](https://github.com/Akteivias/Registro-Ventas-Solana-Advanced) (rama `entrega/initial`), partiendo de `clase/resuelto` (`9abfc13`) y de los repositorios de referencia [`WayLearnLatam/Registro-Ventas-Solana-App`](https://github.com/WayLearnLatam/Registro-Ventas-Solana-App) y [`WayLearnLatam/Registro-Ventas-Solana-PDA`](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA).
- **Base del Día 5 y aporte funcional:** Conserva la baja de clientes sin ventas activas (`eliminar_cliente`, manteniendo `id_counter`) y añade validación de montos positivos (`monto > 0` en `registrar_venta` y `nuevo_monto > 0` en `cambiar_monto`, error `MontoInvalido` `6004` / `0x1774`).
- **Artefactos entregados:** [programa Rust](./programa/src/lib.rs), [IDL](./idl.json), [configuración de programa](./src/config/programa.json), [cliente generado](./clients/js/src/generated/) y [frontend](./src/).
- **Programa en Devnet y evidencias:** [`F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht`](https://explorer.solana.com/address/F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht?cluster=devnet). Consulta [pruebas y evidencias](./docs/PRUEBAS-Y-EVIDENCIAS.md) para los 8 casos guiados y los casos positivo y de rechazo con monto cero, y el [detalle del aporte y la verificación](#detalle-del-aporte-y-verificación).
- **Configuración, verificación y recorrido:** [Codespaces](#comenzar-con-codespaces), [ejecución local](#ejecutar-en-tu-computadora), [comandos de prueba](#probar-tus-cambios), recorrido sin extensión ([`PRUEBAS-AUTOMATIZADAS.md`](./docs/PRUEBAS-AUTOMATIZADAS.md)) y guía manual ([`PRUEBAS-MANUALES.md`](./docs/PRUEBAS-MANUALES.md)).

> ℹ️ Las pruebas de navegador incluidas se realizaron sin extensión de wallet (wallet simulada y firmante local temporal); consulta los límites completos en [`PRUEBAS-Y-EVIDENCIAS.md`](./docs/PRUEBAS-Y-EVIDENCIAS.md) y en el [detalle del aporte y la verificación](#detalle-del-aporte-y-verificación).

### Recorrido de la entrega

El recorrido muestra la validación de montos, una venta y su corrección en Devnet, y las evidencias en Solana Explorer. Las transacciones rechazadas mostradas al final corresponden a pruebas históricas.

![Recorrido del registro de ventas y sus evidencias en Devnet](./docs/assets/recorrido-devnet.gif)

[Ver o descargar el video en MP4](./docs/assets/recorrido-devnet.mp4)

Puedes comenzar haciendo **Fork** de este repositorio. Incluye una configuración de **GitHub Codespaces** para trabajar sin instalar las herramientas del frontend en tu computadora.

> 📖 Sigue las explicaciones y actividades en el [GitBook de Advanced](https://waylearn.gitbook.io/solana-engineering-track-advanced).

## ¿Qué puedes hacer con la app?

- Conectar una wallet y consultar saldos de Devnet.
- Consultar un registro de ventas, sus clientes y las ventas activas de cada uno.
- Crear un negocio y dar de alta a sus clientes.
- Registrar ventas, corregir su importe y realizar devoluciones.
- Eliminar clientes que no tengan ventas activas.
- Revisar solicitudes de firma, confirmaciones y errores de las transacciones.

El recorrido del proyecto sigue esta relación:

**Registro del negocio → Clientes → Ventas**

Cada entidad tiene su propia cuenta. El frontend deriva sus direcciones y utiliza el cliente generado a partir del IDL para leer datos y construir instrucciones.

> ℹ️ El importe de una venta es un dato del ejercicio: **no cobra ni transfiere SOL o tokens**. La devolución elimina la venta del historial activo y cierra su cuenta; no realiza un reembolso comercial.

## Antes de comenzar

Necesitas una cuenta de GitHub y, para las operaciones que requieren firma, una wallet de navegador compatible con Solana y SOL de prueba en **Devnet**.

Es recomendable tener conocimientos básicos de JavaScript o TypeScript y haber revisado el modelo de cuentas del [programa base](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA).

**No necesitas la Solana CLI para ejecutar este frontend.** Puedes trabajar con el programa desplegado desde Solana Playground.

## Comenzar con Codespaces

### 1. Crea tu copia

Haz clic en **Fork**, en la parte superior de este repositorio, para crear una copia en tu cuenta. Así podrás guardar tus cambios y continuar con tu proyecto.

### 2. Abre el entorno

Desde tu copia, selecciona la rama de la entrega y después **Code → Codespaces → Create codespace**. La rama actual de la entrega es `entrega/initial`.

Espera a que termine la preparación. El contenedor incluye Node 22 y ejecuta automáticamente la instalación de dependencias y la generación del cliente.

### 3. Inicia la app

En la terminal de Codespaces ejecuta:

```bash
npm run dev
```

### 4. Ábrela en tu navegador

En la pestaña **Ports / Puertos**, localiza el **5173** y selecciona **Open in Browser**.

Abre la aplicación en una pestaña normal del navegador donde tienes instalada tu wallet. La vista incrustada del editor puede no detectar la extensión. El puerto puede permanecer privado; utiliza la misma cuenta de GitHub para acceder.

> 💡 Al terminar, detén el Codespace desde el menú de Codespaces para evitar consumir tiempo de cómputo mientras no lo utilizas.

## Ejecutar en tu computadora

Si prefieres trabajar en local, utiliza **Node.js 22.12 o superior y menor que 25** y npm. Clona la rama de la entrega:

```bash
git clone --branch entrega/initial https://github.com/Akteivias/Registro-Ventas-Solana-Advanced.git
cd Registro-Ventas-Solana-Advanced
npm ci
npm run cliente
npm run dev
```

Abre `http://localhost:5173` en el navegador con tu wallet instalada.

En Windows puedes ejecutar estos comandos desde WSL. El repositorio también incluye una configuración de Dev Container para VS Code, si ya utilizas Docker y la extensión Dev Containers.

## Conectar el programa de Solana

El frontend y el programa son dos partes del mismo proyecto:

| Parte | Responsabilidad |
| --- | --- |
| [Programa Rust + Anchor](./programa/src/lib.rs) | Define las cuentas, ejecuta instrucciones y valida permisos. Basado en el [programa de WayLearn](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA). |
| Este frontend | Lee cuentas, construye instrucciones y solicita a la wallet que firme las transacciones. |
| IDL y cliente generado | Describen la interfaz del programa y permiten utilizarla desde TypeScript. |

### Si aparece «programa de referencia»

Esta entrega está configurada para el programa Devnet indicado arriba. Si cambias a una configuración con un **IDL de referencia**, puedes conectar tu wallet y consultar saldos, pero la consulta del registro y sus operaciones permanecen bloqueadas hasta importar el IDL del despliegue que utilizarás.

Si la versión de clase ya viene configurada para el programa correspondiente, puedes continuar con las actividades sin repetir este paso.

### Importar tu IDL

Exporta desde Playground el IDL del programa que realmente compilaste y desplegaste en **Devnet**. Coloca el JSON dentro de tu espacio de trabajo, por ejemplo en `tmp-idl/registro.json`, y ejecuta desde la raíz:

```bash
npm run configurar:idl -- ./tmp-idl/registro.json
```

Si el archivo no incluye la dirección del programa, agrega su Program ID público:

```bash
npm run configurar:idl -- ./tmp-idl/registro.json --program-id TU_PROGRAM_ID
```

El comando comprueba la estructura esperada, importa el IDL y regenera el cliente. Detén el servidor con `Ctrl+C` y vuelve a ejecutar `npm run dev` después de la importación.

**No edites manualmente el cliente generado.** Si cambias el IDL, ejecuta `npm run cliente`. Conserva juntos en tu repositorio `idl.json`, `src/config/programa.json` y `clients/js/`.

> 🔎 La wallet de Playground y la del navegador pueden ser distintas. Como la autoridad participa en la PDA, lo más sencillo es crear un negocio nuevo desde la app con la wallet del navegador. No necesitas trasladar claves privadas entre entornos.

Consulta la [guía de IDL y Playground](./docs/IDL-Y-PLAYGROUND.md) si necesitas revisar la configuración.

## Seguir las sesiones

El proyecto utiliza el mismo frontend durante ambos días. Puedes elegir el punto de partida con estos comandos:

| Comando | Qué prepara |
| --- | --- |
| `npm run clase:dia3` | Pantalla de conexión para explorar wallet, RPC, saldos e IDL. Reserva Registro para el día siguiente. |
| `npm run clase:dia4` | Pantalla del registro con dos funciones por completar: `crearCliente` y `registrarVenta`. |
| `npm run clase:resuelto` | Las cinco operaciones implementadas, como referencia para estudiar y contrastar. |

Detén `npm run dev` antes de cambiar de modo y vuelve a iniciarlo al terminar.

> **Guarda tu avance antes de cambiar de modo.** Estos comandos reemplazan `src/solana/acciones.ts`. Los cambios anteriores se respaldan en `.aula/respaldos/`; el IDL y el cliente generado se conservan. Puedes consultar la solución en `materiales/acciones-resuelto.ts.txt` sin reemplazar tu archivo.

## ¿Dónde está cada cosa?

| Ruta | Qué encontrarás |
| --- | --- |
| `src/components/` | Pantallas y formularios de la aplicación. |
| `src/solana/acciones.ts` | Funciones que conectan los formularios con las instrucciones del programa. |
| `src/solana/lecturas.ts` | Lectura de Registro, Cliente y Venta. |
| `src/solana/pdas.ts` y `seeds.ts` | Derivación de las direcciones de las cuentas. |
| `src/solana/tx.ts` | Preparación, envío, confirmación y errores de las transacciones. |
| `src/config/interfaz.ts` | Título y valores iniciales para personalizar la demo. |
| `idl.json` | IDL utilizado para generar el cliente del programa. |
| `clients/js/src/generated/` | Código generado con Codama; no se modifica a mano. |
| `materiales/` | Versión de ejercicio y solución de las operaciones. |
| `docs/` | Guías de configuración, pruebas y alcance del ejemplo. |

La base utiliza **React + Vite**, **TypeScript**, **Wallet Adapter**, **Solana Kit**, **web3.js** y **Codama**. La integración entre las librerías ya está preparada para que puedas concentrarte en el flujo de cuentas e instrucciones.

## Detalle del aporte y verificación

- **Ruta elegida:** Proyecto guiado (*Registro de ventas*) basado en [`WayLearnLatam/Registro-Ventas-Solana-App`](https://github.com/WayLearnLatam/Registro-Ventas-Solana-App) y el programa [`WayLearnLatam/Registro-Ventas-Solana-PDA`](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA). El punto de partida de esta entrega es la rama `clase/resuelto` de este repositorio, commit `9abfc13` (este repositorio no incluye un archivo `LICENSE` separado).
- **Mejora implementada (`programa/src/lib.rs`):** Validación en cadena de montos positivos (`monto > 0` en `registrar_venta` y `nuevo_monto > 0` en `cambiar_monto`) mediante `Errores::MontoInvalido` (`6004` / `0x1774`), preservando las cuentas, semillas PDA, comportamiento positivo y códigos `6000..6003`.
- **Estado de verificación y despliegue:**
  - **Despliegue final en Devnet:** Programa `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht` actualizado mediante `scripts/desplegar-devnet.mjs --upgrade` ([tx de upgrade](https://explorer.solana.com/tx/2PMQQHDVbdiCmtvYfaxyRpwovzmUeNVbXS7QjtufgFYTCH8PT56EL8viMoPN8fkGu92eqsr97afkq9brGfbXZyEF?cluster=devnet), slot `524962328`), con `idl.json`, `src/config/programa.json` (`idlSha256: 078c89e157973aa4aea27b769ee3ab469f3d838272f11332b761f0fafa87020c`) y `clients/js/src/generated/` sincronizados.
  - **Evidencia final-versión:** Los 8 casos guiados y los casos positivo y de rechazo del aporte (`MontoInvalido` en `registrar_venta` y `cambiar_monto`, incluidas las dos transacciones de fallo esperado finalizadas y sus límites de snapshot) están registrados en [PRUEBAS-Y-EVIDENCIAS.md](./docs/PRUEBAS-Y-EVIDENCIAS.md). [DIA-5-VALIDACION.md](./docs/DIA-5-VALIDACION.md) se conserva como evidencia histórica del Día 5, mientras [PRUEBAS-AUTOMATIZADAS.md](./docs/PRUEBAS-AUTOMATIZADAS.md) conserva esa historia y documenta por separado el procedimiento posterior al upgrade.
  - **Local (compilación + validador aislado):** `fnm exec --using=24 node scripts/probar-local.mjs` compila el programa actualizado, importa el IDL generado en una copia aislada (`.aula/local-runs/`), regenera el cliente Codama sin editarlo a mano, ejecuta `comprobar:idl`, `typecheck`, `npm test` (incluyendo traducción de `0x1774`) y valida en `solana-test-validator` los casos positivos y el rechazo en preflight con monto `0` sin mutar las cuentas de negocio. (En `registrar_venta`, Anchor ejecuta `#[account(init)]` antes de la comprobación `require!` del handler, y cualquier transacción rechazada revierte la inicialización y los cambios de cuenta.)
  - **Compilación SBF + IDL sin desplegar (revisión independiente):** `NO_DNA=1 fnm exec --using=24 node scripts/desplegar-devnet.mjs --solo-build --program-id F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht --out-dir .aula/local-runs/solo-build-out --work-dir .aula/local-runs/solo-build-work` compila `programa/src/lib.rs` usando `tests/fixtures/registro-Cargo.lock`, `anchor-cli 1.2.2`, `solana-cli 4.1.2` (`cargo-build-sbf --tools-version v1.57 --arch v3`), `cargo 1.99.1` y acceso a GitHub (o caché local de Cargo) para `anchor-lang`. Usa rutas distintas bajo `.aula/local-runs/` (ignorado por Git): `--out-dir` debe estar vacío o no existir y conserva `registro.so` e `idl.json`, mientras `--work-dir` aloja y limpia la subcarpeta temporal `dia5-devnet-build-*`. Distingue tres niveles: (1) la compilación observada en el entorno original (`soBytes: 198144`, `soSha256: 77fad2...`, `idlSha256: 078c89...`), (2) una recompilación futura desde la copia entregada y (3) la comparación binaria frente al programa desplegado en Devnet, que requiere descargar el binario desplegado (`solana program dump`) y compararlo contra una compilación verificable/determinista (las compilaciones locales con `cargo-build-sbf` no garantizan hashes idénticos entre máquinas, y los hashes de `.so` e `idl.json` describen artefactos distintos). Consulta el [runbook de despliegue y verificación](./docs/runbooks/despliegue-y-verificacion-devnet.md).
  - **Alcance no verificado:** La entrega utiliza pruebas sin extensión de navegador (`Offline Test Wallet` y firmante temporal programático), por lo que las ventanas de aprobación de extensiones reales (Phantom/Solflare), las pruebas de interrupción/reinicio en vivo del firmante temporal sobre Devnet, la comparación binaria mediante `solana program dump` y la reejecución en un clon limpio tras este ajuste documental permanecen fuera de la evidencia actual.

## Probar tus cambios

```bash
fnm exec --using=24 npm run comprobar:idl
REQUIRE_ZERO_AMOUNT_IDL=1 fnm exec --using=24 npm run verificar
DEVNET_EXPECTED_AUTHORITY=TU_PUBKEY_DEVNET DEVNET_AUTHORITY_KEYPAIR=~/.config/solana/tu-devnet-tester-keypair.json fnm exec --using=24 npm run verificar:devnet
fnm exec --using=24 npm run verificar:browser
DEVNET_EXPECTED_AUTHORITY=TU_PUBKEY_DEVNET DEVNET_AUTHORITY_KEYPAIR=~/.config/solana/tu-devnet-tester-keypair.json fnm exec --using=24 npm run verificar:browser:devnet
fnm exec --using=24 node scripts/probar-local.mjs
```

Un revisor independiente puede inspeccionar los enlaces públicos de Devnet Explorer sin wallet ni claves, y ejecutar `comprobar:idl`, `verificar` y `verificar:browser` sin el keypair del autor; las escrituras opcionales en Devnet (`verificar:devnet` y `verificar:browser:devnet`, que acepta `--grabar <ruta.mp4>` y `--explorer` para registrar el recorrido completo y visitar Explorer tras cerrar el firmante) requieren su propio keypair externo con saldo (`>= 0.03 SOL`) y `DEVNET_AUTHORITY_KEYPAIR` / `DEVNET_EXPECTED_AUTHORITY`. `npm run verificar` comprueba TypeScript, ejecuta las pruebas unitarias y genera el build del frontend (`dist/`). `npm run verificar:browser` comprueba la cancelación de firma con una wallet simulada offline, validación de formulario (`idCliente = 0` y bloqueo HTML5 de `monto = 0` + control positivo `monto = 1` en *Registrar venta* y *Corregir importe*) y una lectura pública en Devnet; no firma ni envía transacciones en Devnet ni sustituye una extensión de wallet real. El procedimiento repetible sin extensión mediante firmante local temporal (y sus registros históricos del Día 5 más el recorrido post-upgrade `DevnetZ0-ri6q6g`) está documentado en [PRUEBAS-AUTOMATIZADAS.md](./docs/PRUEBAS-AUTOMATIZADAS.md). `scripts/probar-local.mjs` verifica el programa Rust compilado en un validador local efímero sin alterar la configuración Devnet del workspace real. Para el recorrido en Devnet, consulta [pruebas manuales en Devnet](./docs/PRUEBAS-MANUALES.md).

Para tu primera prueba, crea un negocio, agrega un cliente, registra una venta y consulta el resultado. Después prueba corregir el importe, devolver la venta y cancelar una solicitud de firma.

## Si algo no funciona

| Situación | Qué revisar |
| --- | --- |
| La wallet no aparece | Abre la app en una pestaña normal del navegador con una extensión compatible instalada. |
| Falta SOL de prueba | Solicítalo en [Solana Faucet](https://faucet.solana.com/), seleccionando Devnet. |
| No aparece tu negocio | Comprueba el nombre exacto y la dirección de su autoridad; ambos participan en la PDA. |
| No puedes repetir un SKU | Cada cliente solo puede tener una venta activa con ese SKU. |
| El RPC responde con un límite de uso | Espera y vuelve a intentar, o configura otro endpoint de Devnet en `.env.local` siguiendo `.env.example`. |
| Cambiaste el IDL y falla la comprobación | Ejecuta `npm run cliente` y reinicia el servidor. |

## Recursos y comunidad

- [GitBook de Solana Engineering Track: Advanced](https://waylearn.gitbook.io/solana-engineering-track-advanced).
- [Programa Registro de Ventas con PDAs](https://github.com/WayLearnLatam/Registro-Ventas-Solana-PDA).
- [Solana Playground](https://beta.solpg.io/).
- [Comunidad de WayLearn en Discord](https://discord.gg/hvnpbZxu9b).

Este es un proyecto educativo para **Devnet**. Las validaciones del formulario no sustituyen las restricciones del programa. Revisa [seguridad y alcance](./docs/SEGURIDAD-Y-ALCANCE.md) para conocer los límites del ejemplo y los aspectos que deben revisarse antes de producción.
