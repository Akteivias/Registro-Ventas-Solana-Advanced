import '../src/polyfills';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { address, createNoopSigner } from '@solana/kit';
import { getRegistrarVentaInstruction, getRegistrarVentaInstructionDataDecoder, getCambiarMontoInstruction, getEliminarClienteInstruction, getEliminarClienteInstructionDataDecoder, REGISTRO_PROGRAM_ADDRESS } from '../clients/js/src/generated';
import { pdaRegistro, pdaCliente, pdaVenta } from '../src/solana/pdas';
import { s } from '../src/solana/seeds';
import { aWeb3, confirmarEnvio, ErrorTransaccion, ErrorConfirmacionPendiente, traducir } from '../src/solana/tx';
import { comprobarDevnet, DEVNET_GENESIS } from '../src/solana/seguridad';
import { montoValido, skuValido, nombreValido, idValido } from '../src/solana/validaciones';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import idl from '../idl.json';
import { validarIdl, prepararIdl, REFERENCIA_ID } from '../scripts/contrato-idl.mjs';
import { stageIdlImport, withWorkDir } from '../scripts/desplegar-devnet.mjs';
import {
  cleanupRunDir,
  stopValidator,
  trackChildProcess,
  waitForValidatorReady,
} from '../scripts/probar-local.mjs';
import { expectProgramRejection } from './helpers/rechazo';
import { crearManejadorFirmante, type RpcFirmante } from './helpers/firmante-temporal';
import { Keypair, Transaction } from '@solana/web3.js';
import { getCrearRegistroInstruction, getCrearClienteInstruction } from '../clients/js/src/generated';

function assertZeroAmountIdlGate(
  idlData: { errors?: { code: number; name: string }[] },
  traducirFn: (err: unknown) => string,
  requireZeroAmount: boolean,
) {
  const hasMontoInvalido =
    idlData.errors?.some((item) => item.code === 6004 && item.name === 'MontoInvalido') ?? false;
  const translated = traducirFn(new Error('custom program error: 0x1774'));
  if (requireZeroAmount) {
    assert.equal(hasMontoInvalido, true, 'El IDL actualizado debe incluir MontoInvalido (6004).');
    assert.match(translated, /MontoInvalido/);
    return;
  }
  if (hasMontoInvalido) {
    assert.match(translated, /MontoInvalido/);
  } else {
    assert.match(translated, /6004/);
    assert.doesNotMatch(translated, /MontoInvalido/);
  }
}

// Direccion publica de fixture. No se crean wallets ni se envian transacciones.
const owner = address(new PublicKey(new Uint8Array(32).fill(7)).toBase58());

test('la baja codifica el ID y conserva los permisos de las cuentas', () => {
  const registro = pdaRegistro('Cafe', owner);
  for (const idCliente of [1, 256, 65_535]) {
    const cliente = pdaCliente(registro, idCliente);
    const ix = getEliminarClienteInstruction({ owner: createNoopSigner(owner), registro, cliente, idCliente });
    assert.deepEqual(Buffer.from(ix.data.subarray(0, 8)), createHash('sha256').update('global:eliminar_cliente').digest().subarray(0, 8));
    assert.equal(getEliminarClienteInstructionDataDecoder().decode(ix.data).idCliente, idCliente);
    assert.deepEqual(aWeb3(ix).keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [[true, true], [false, true], [false, true]]);
  }
  assert.match(traducir(new Error('custom program error: 0x1772')), /NoCliente/);
  assert.match(traducir(new Error('custom program error: 0x1773')), /ClienteConVentas/);
});

test('las semillas u16 conservan dos bytes little-endian y sus limites', () => {
  assert.deepEqual([...s.u16(256)], [0, 1]);
  assert.deepEqual([...s.u16(65_535)], [255, 255]);
  assert.throws(() => s.u16(65_536));
  assert.throws(() => s.u16(1.5));
});

test('Registro, Cliente y Venta coinciden con las semillas del programa Rust', () => {
  const programa = new PublicKey(REGISTRO_PROGRAM_ADDRESS);
  const [registro] = PublicKey.findProgramAddressSync([Buffer.from('registro'), Buffer.from('Cafe WayLearn D1'), new PublicKey(owner).toBuffer()], programa);
  const id = Buffer.alloc(2); id.writeUInt16LE(256);
  const [cliente] = PublicKey.findProgramAddressSync([Buffer.from('cliente'), registro.toBuffer(), id], programa);
  const [venta] = PublicKey.findProgramAddressSync([Buffer.from('venta'), cliente.toBuffer(), Buffer.from('CAF01')], programa);
  assert.equal(pdaRegistro('Cafe WayLearn D1', owner), registro.toBase58());
  assert.equal(pdaCliente(address(registro.toBase58()), 256), cliente.toBase58());
  assert.equal(pdaVenta(address(cliente.toBase58()), 'CAF01'), venta.toBase58());
});

test('Codama serializa la instruccion y el puente conserva datos, orden y roles', () => {
  const registro = pdaRegistro('Cafe', owner), cliente = pdaCliente(registro, 1), venta = pdaVenta(cliente, 'CAF01');
  const ix = getRegistrarVentaInstruction({ owner: createNoopSigner(owner), registro, cliente, venta, idCliente: 1, sku: 'CAF01', descripcion: 'Cafe americano', monto: 50 });
  const esperado = createHash('sha256').update('global:registrar_venta').digest().subarray(0, 8);
  assert.deepEqual(Buffer.from(ix.data.subarray(0, 8)), esperado);
  assert.equal(getRegistrarVentaInstructionDataDecoder().decode(ix.data).monto, 50);
  const convertida = aWeb3(ix);
  assert.equal(convertida.programId.toBase58(), REGISTRO_PROGRAM_ADDRESS);
  assert.deepEqual(convertida.data, Buffer.from(ix.data));
  assert.deepEqual(convertida.keys.map((cuenta) => [cuenta.isSigner, cuenta.isWritable]), [[true, true], [false, false], [false, true], [false, true], [false, false]]);
  const correccion = aWeb3(getCambiarMontoInstruction({ owner: createNoopSigner(owner), registro, cliente, venta, idCliente: 1, sku: 'CAF01', nuevoMonto: 55 }));
  assert.equal(correccion.keys[0].isSigner, true);
  assert.equal(correccion.keys[0].isWritable, false);
});

test('una confirmacion con error nunca produce un resultado de exito', async () => {
  const estrategia = { signature: 'firma-de-prueba', blockhash: 'blockhash-de-prueba', lastValidBlockHeight: 123 };
  const connection = { confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6000 }] } } }) } as unknown as Pick<Connection, 'confirmTransaction'>;
  await assert.rejects(confirmarEnvio(connection, estrategia), (error: unknown) => error instanceof ErrorTransaccion && error.firma === estrategia.signature);
  const correcta = { confirmTransaction: async (_datos: unknown, commitment: string) => { assert.equal(commitment, 'confirmed'); return { context: { slot: 1 }, value: { err: null } }; } } as unknown as Pick<Connection, 'confirmTransaction'>;
  assert.equal(await confirmarEnvio(correcta, estrategia), estrategia.signature);
});

test('se exige el genesis completo de Devnet para escribir', async () => {
  await comprobarDevnet({ getGenesisHash: async () => DEVNET_GENESIS });
  await assert.rejects(comprobarDevnet({ getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }), /solo permite escribir en Devnet/);
  await assert.rejects(comprobarDevnet({ getGenesisHash: async () => DEVNET_GENESIS.slice(0, 32) }));
});

test('una interrupcion del RPC conserva la firma y no afirma que la transaccion fallo', async () => {
  const estrategia = { signature: 'firma-ya-enviada', blockhash: 'blockhash', lastValidBlockHeight: 123 };
  const connection = { confirmTransaction: async () => { throw new Error('RPC timeout'); } } as unknown as Pick<Connection, 'confirmTransaction'>;
  await assert.rejects(confirmarEnvio(connection, estrategia), (error: unknown) => error instanceof ErrorConfirmacionPendiente && error.firma === estrategia.signature && /antes de repetirla/.test(error.message));
});

test('validaciones de UI comprueban bytes UTF-8 y enteros positivos', () => {
  assert.equal(skuValido('CAF01'), 'CAF01');
  assert.throws(() => skuValido('Cafe☕'));
  assert.equal(nombreValido(' Ana '), 'Ana');
  for (const invalido of [0, -1, 1.5, NaN, 4_294_967_296]) assert.throws(() => montoValido(invalido));
  assert.equal(montoValido(4_294_967_295), 4_294_967_295);
  assert.throws(() => idValido(65_536));
});

test('los errores distinguen cancelacion, autoridad, semillas y RPC', () => {
  assert.match(traducir(new Error('User rejected the request')), /cancelada/);
  assert.match(traducir(new Error('custom program error: 0x1770')), /NoOwner/);
  assert.match(traducir(new Error('custom program error: 0x7d6')), /ConstraintSeeds/);
  assert.match(traducir(new Error('429 Too Many Requests')), /RPC/);
  assertZeroAmountIdlGate(idl, traducir, process.env.REQUIRE_ZERO_AMOUNT_IDL === '1');
});

test('el gate estricto de IDL actualizado rechaza un IDL obsoleto sin MontoInvalido (6004)', () => {
  const staleIdl = structuredClone(idl);
  staleIdl.errors = (staleIdl.errors ?? []).filter((item) => item.code !== 6004);
  assert.throws(
    () => assertZeroAmountIdlGate(staleIdl, traducir, true),
    /El IDL actualizado debe incluir MontoInvalido \(6004\)/,
  );
  // Incluso en modo no estricto, un IDL sin 6004 traduce por fallback numerico sin inventar MontoInvalido.
  assertZeroAmountIdlGate(
    staleIdl,
    () => 'El programa rechazo la operacion con el codigo 6004.',
    false,
  );
});

test('withWorkDir y --solo-build --work-dir preservan el directorio del llamador en exito y fallo', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runsBase = resolve(root, '.aula', 'local-runs');
  mkdirSync(runsBase, { recursive: true });
  const callerWorkDir = mkdtempSync(join(runsBase, 'test-workdir-'));
  const sentinel = join(callerWorkDir, 'caller-sentinel.txt');
  writeFileSync(sentinel, 'intacto');
  try {
    let seenBuildDir = '';
    const ok = withWorkDir(callerWorkDir, (buildDir: string) => {
      seenBuildDir = buildDir;
      writeFileSync(join(buildDir, 'scratch.txt'), 'temporal');
      return 'ok';
    });
    assert.equal(ok, 'ok');
    assert.equal(existsSync(seenBuildDir), false);
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'intacto');

    let failedBuildDir = '';
    assert.throws(
      () =>
        withWorkDir(callerWorkDir, (buildDir: string) => {
          failedBuildDir = buildDir;
          writeFileSync(join(buildDir, 'scratch.txt'), 'temporal');
          throw new Error('fallo simulado');
        }),
      /fallo simulado/,
    );
    assert.equal(existsSync(failedBuildDir), false);
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'intacto');

    // Ejerce el flujo CLI --solo-build --work-dir en ruta de fallo rapido sin invocar cargo-build-sbf.
    const cliFail = spawnSync(
      process.execPath,
      ['scripts/desplegar-devnet.mjs', '--solo-build', '--work-dir', callerWorkDir, '--program-id', REFERENCIA_ID],
      { cwd: root, env: { ...process.env, PATH: '' }, encoding: 'utf8', stdio: 'pipe' },
    );
    assert.notEqual(cliFail.status, 0);
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'intacto');
  } finally {
    rmSync(callerWorkDir, { recursive: true, force: true });
  }
});

test('expectProgramRejection falla ante exito inesperado y acepta rechazo esperado', async () => {
  await assert.rejects(
    () => expectProgramRejection(async () => 'ok-inesperado', /MontoInvalido|0x1774/i),
    /Expected rejection/,
  );
  await expectProgramRejection(
    async () => {
      throw new Error('custom program error: 0x1774');
    },
    /MontoInvalido|0x1774/i,
  );
});

test('desplegar-devnet --solo-build rechaza --out-dir no vacio sin borrar archivos previos', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runsBase = resolve(root, '.aula', 'local-runs');
  mkdirSync(runsBase, { recursive: true });
  const tempRoot = mkdtempSync(join(runsBase, 'test-outdir-'));
  const sentinel = join(tempRoot, 'keep.txt');
  writeFileSync(sentinel, 'preservado');
  try {
    const res = spawnSync(
      process.execPath,
      ['scripts/desplegar-devnet.mjs', '--solo-build', '--out-dir', tempRoot],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' },
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr + res.stdout, /--out-dir debe estar vacio o no existir/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preservado');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('se valida el contrato IDL y la normalizacion no cambia el orden ni tipos', () => {
  const copia = structuredClone(idl);
  if ('address' in copia) delete (copia as unknown as Record<string, unknown>).address;
  copia.metadata = { ...copia.metadata, address: REFERENCIA_ID };
  assert.equal(validarIdl(copia).esReferencia, true);
  const ix = copia.instructions.find((item) => item.name.toLowerCase().replace(/_/g, '') === 'registrarventa')!;
  ix.args[0].name = '_id_cliente';
  assert.equal(validarIdl(copia).programId, REFERENCIA_ID);
  const normalizada = prepararIdl(copia, REFERENCIA_ID);
  assert.equal(normalizada.instructions.find((item: { name: string }) => item.name === ix.name).args[0].name, 'id_cliente');
  assert.equal(ix.args[0].name, '_id_cliente');
  const invalida = structuredClone(copia); invalida.instructions = [];
  assert.throws(() => validarIdl(invalida), /Falta la instruccion/);
  const otroTipo = structuredClone(copia);
  otroTipo.instructions[0].args[0].type = 'u64';
  assert.throws(() => validarIdl(otroTipo), /tipos de los argumentos/);
  const otraCuenta = structuredClone(copia) as unknown as { accounts: { name: string; type?: { fields: unknown[] } }[]; types?: { name: string; type: { fields: unknown[] } }[] };
  const cuenta = otraCuenta.accounts[0];
  const esquema = cuenta.type ?? otraCuenta.types?.find((item) => item.name === cuenta.name)?.type;
  esquema!.fields.reverse();
  assert.throws(() => validarIdl(otraCuenta), /campos de la cuenta/);
  assert.throws(() => validarIdl(copia, new PublicKey(new Uint8Array(32).fill(9)).toBase58()), /no coinciden/);

  // Entrega final exige eliminar_cliente y MontoInvalido (6004); referencia de 5 instrucciones sigue compatible.
  assert.equal(validarIdl(idl).esReferencia, false);
  const ref5Ix = structuredClone(idl);
  if ('address' in ref5Ix) (ref5Ix as unknown as { address: string }).address = REFERENCIA_ID;
  ref5Ix.metadata = { ...ref5Ix.metadata, address: REFERENCIA_ID };
  ref5Ix.instructions = ref5Ix.instructions.filter((item) => item.name.toLowerCase().replace(/_/g, '') !== 'eliminarcliente');
  ref5Ix.errors = (ref5Ix.errors ?? []).filter((item) => item.code !== 6004);
  assert.equal(validarIdl(ref5Ix).esReferencia, true);

  const sinEliminar = structuredClone(idl);
  sinEliminar.instructions = sinEliminar.instructions.filter((item) => item.name.toLowerCase().replace(/_/g, '') !== 'eliminarcliente');
  assert.throws(() => validarIdl(sinEliminar), /Falta la instruccion eliminarcliente/);

  const sinMontoInvalido = structuredClone(idl);
  sinMontoInvalido.errors = (sinMontoInvalido.errors ?? []).filter((item) => item.code !== 6004);
  assert.throws(() => validarIdl(sinMontoInvalido), /MontoInvalido \(6004\)/);
});

async function startRpcStub(markerBalance: number) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = JSON.parse(body) as { id: number; method: string };
      let result: unknown = null;
      if (payload.method === 'getGenesisHash') {
        result = 'LocAL11111111111111111111111111111111111111';
      } else if (payload.method === 'getSlot') {
        result = 2;
      } else if (payload.method === 'getLatestBlockhash') {
        result = {
          context: { slot: 2 },
          value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10 },
        };
      } else if (payload.method === 'getAccountInfo') {
        result = {
          context: { slot: 2 },
          value: { data: ['', 'base64'], executable: true, lamports: 1_000_000, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', rentEpoch: 0 },
        };
      } else if (payload.method === 'getBalance') {
        result = { context: { slot: 2 }, value: markerBalance };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    rpcUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

test('waitForValidatorReady exige marcador de ejecucion y rechaza RPC ajeno sin marcador', async () => {
  const marker = new PublicKey(new Uint8Array(32).fill(11)).toBase58();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const state = trackChildProcess(child);
  const matchingRpc = await startRpcStub(500_000_000);
  const foreignRpc = await startRpcStub(0);
  try {
    const ok = await waitForValidatorReady(matchingRpc.rpcUrl, REFERENCIA_ID, child, state, {
      markerPubkey: marker,
      timeoutMs: 1500,
      pollIntervalMs: 25,
    });
    assert.equal(ok, true);

    await assert.rejects(
      () =>
        waitForValidatorReady(foreignRpc.rpcUrl, REFERENCIA_ID, child, state, {
          markerPubkey: marker,
          timeoutMs: 150,
          pollIntervalMs: 25,
        }),
      /Timeout esperando a solana-test-validator/,
    );
  } finally {
    await stopValidator(child, state, { termTimeoutMs: 1000, killTimeoutMs: 1000 });
    await matchingRpc.close();
    await foreignRpc.close();
  }
});

test('waitForValidatorReady y stopValidator manejan salida temprana, senal SIGKILL, error de spawn y teardown acotado', async () => {
  // 1. Salida temprana con codigo no cero
  const earlyChild = spawn(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'ignore' });
  const earlyState = trackChildProcess(earlyChild);
  await assert.rejects(
    () => waitForValidatorReady('http://127.0.0.1:1', REFERENCIA_ID, earlyChild, earlyState, { timeoutMs: 2000, pollIntervalMs: 25 }),
    /termino prematuramente \(code=2, signal=null\)/,
  );
  assert.deepEqual(await stopValidator(earlyChild, earlyState), { stopped: true, reason: 'already-exited' });

  // 2. Terminacion por senal (SIGKILL) antes de estar listo
  const sigChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const sigState = trackChildProcess(sigChild);
  sigChild.kill('SIGKILL');
  await assert.rejects(
    () => waitForValidatorReady('http://127.0.0.1:1', REFERENCIA_ID, sigChild, sigState, { timeoutMs: 2000, pollIntervalMs: 25 }),
    /termino prematuramente \(code=null, signal=SIGKILL\)/,
  );
  assert.deepEqual(await stopValidator(sigChild, sigState), { stopped: true, reason: 'already-exited' });

  // 3. Error de spawn (binario inexistente)
  const badChild = spawn('nonexistent-validator-bin-xyz-999', [], { stdio: 'ignore' });
  const badState = trackChildProcess(badChild);
  await assert.rejects(
    () => waitForValidatorReady('http://127.0.0.1:1', REFERENCIA_ID, badChild, badState, { timeoutMs: 2000, pollIntervalMs: 25 }),
    /No se pudo iniciar solana-test-validator/,
  );
  assert.deepEqual(await stopValidator(badChild, badState), { stopped: true, reason: 'already-exited' });

  // 4. Teardown de hijo vivo antes de limpiar runDir
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runsBase = resolve(root, '.aula', 'local-runs');
  mkdirSync(runsBase, { recursive: true });
  const liveRunDir = mkdtempSync(join(runsBase, 'test-live-rundir-'));
  const liveChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const liveState = trackChildProcess(liveChild);
  try {
    const stopOk = await stopValidator(liveChild, liveState, { termTimeoutMs: 1000, killTimeoutMs: 1000 });
    assert.equal(stopOk.stopped, true);
    assert.equal(liveState.exited, true);
    cleanupRunDir(liveRunDir, stopOk);
    assert.equal(existsSync(liveRunDir), false);
  } finally {
    rmSync(liveRunDir, { recursive: true, force: true });
  }

  // 5. Terminacion no confirmada preserva runDir y reporta ruta
  const preservedRunDir = mkdtempSync(join(runsBase, 'test-preserved-rundir-'));
  const ledgerSentinel = join(preservedRunDir, 'ledger-sentinel.txt');
  writeFileSync(ledgerSentinel, 'vivo');
  try {
    const stubborn = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: () => true,
    });
    const stubbornState = { exited: false, exitCode: null, signalCode: null, spawnError: null };
    const unconfirmed = await stopValidator(stubborn as never, stubbornState, { termTimeoutMs: 25, killTimeoutMs: 25 });
    assert.deepEqual(unconfirmed, { stopped: false, reason: 'unconfirmed-exit' });
    assert.throws(
      () => cleanupRunDir(preservedRunDir, unconfirmed),
      new RegExp(preservedRunDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.equal(existsSync(ledgerSentinel), true);
    assert.equal(readFileSync(ledgerSentinel, 'utf8'), 'vivo');
  } finally {
    rmSync(preservedRunDir, { recursive: true, force: true });
  }

  // 6. Error post-spawn al enviar senal (sin 'exit') no marca spawnError ni confirma terminacion; preserva runDir
  const postSpawnRunDir = mkdtempSync(join(runsBase, 'test-postspawn-error-'));
  const postSpawnSentinel = join(postSpawnRunDir, 'ledger-postspawn.txt');
  writeFileSync(postSpawnSentinel, 'aun-vivo');
  try {
    const mockProc = Object.assign(new EventEmitter(), {
      pid: 424242,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal?: NodeJS.Signals) {
        this.emit('error', new Error(`kill ${signal ?? 'SIGTERM'} EPERM`));
        return false;
      },
    });
    const postSpawnState = trackChildProcess(mockProc as never);
    mockProc.emit('spawn');
    const stopRes = await stopValidator(mockProc as never, postSpawnState, { termTimeoutMs: 25, killTimeoutMs: 25 });
    assert.equal(postSpawnState.spawned, true);
    assert.equal(postSpawnState.spawnError, null);
    assert.match(postSpawnState.lastError?.message ?? '', /EPERM/);
    assert.equal(postSpawnState.exited, false);
    assert.deepEqual(stopRes, { stopped: false, reason: 'unconfirmed-exit' });
    assert.throws(
      () => cleanupRunDir(postSpawnRunDir, stopRes),
      new RegExp(postSpawnRunDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.equal(existsSync(postSpawnSentinel), true);
    assert.equal(readFileSync(postSpawnSentinel, 'utf8'), 'aun-vivo');
  } finally {
    rmSync(postSpawnRunDir, { recursive: true, force: true });
  }
});

test('stageIdlImport sincroniza .aula/idl-codama.json y lo revierte ante fallo', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runsBase = resolve(root, '.aula', 'local-runs');
  mkdirSync(runsBase, { recursive: true });
  const tempRoot = mkdtempSync(join(runsBase, 'test-stage-idl-'));
  const fakeRepo = join(tempRoot, 'repo');
  try {
    for (const rel of [
      'package.json',
      'codama.json',
      'idl.json',
      '.aula/idl-codama.json',
      'src/config/programa.json',
      'clients/js/package.json',
      'clients/js/src/generated',
      'scripts/configurar-idl.mjs',
      'scripts/generar-cliente.mjs',
      'scripts/contrato-idl.mjs',
      'scripts/verificar-contrato.mjs',
    ]) {
      const dst = join(fakeRepo, rel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(resolve(root, rel), dst, { recursive: true });
    }
    symlinkSync(resolve(root, 'node_modules'), join(fakeRepo, 'node_modules'), 'dir');

    const newPid = new PublicKey(new Uint8Array(32).fill(5)).toBase58();
    const newIdlPath = join(tempRoot, 'new-idl.json');
    const newIdl = structuredClone(idl);
    if ('address' in newIdl) (newIdl as unknown as { address: string }).address = newPid;
    newIdl.metadata = { ...newIdl.metadata, address: newPid };
    writeFileSync(newIdlPath, JSON.stringify(newIdl, null, 2) + '\n');

    // Simula .aula/idl-codama.json obsoleto previo al import
    const codamaIdlPath = join(fakeRepo, '.aula', 'idl-codama.json');
    const staleCodama = JSON.parse(readFileSync(codamaIdlPath, 'utf8'));
    staleCodama.address = REFERENCIA_ID;
    writeFileSync(codamaIdlPath, JSON.stringify(staleCodama, null, 2) + '\n');

    // 1. Aplicacion exitosa actualiza tambien .aula/idl-codama.json y cliente generado
    stageIdlImport({
      repoRoot: fakeRepo,
      idlPath: newIdlPath,
      programId: newPid,
      backupDir: join(tempRoot, 'backup-ok'),
    });
    const updatedCodama = JSON.parse(readFileSync(codamaIdlPath, 'utf8'));
    assert.equal(updatedCodama.address, newPid);
    assert.equal(
      updatedCodama.errors.some((item: { code: number; name: string }) => item.code === 6004 && item.name === 'MontoInvalido'),
      true,
    );
    assert.equal(JSON.parse(readFileSync(join(fakeRepo, 'src/config/programa.json'), 'utf8')).programId, newPid);
    assert.match(readFileSync(join(fakeRepo, 'clients/js/src/generated/programs/registro.ts'), 'utf8'), new RegExp(newPid));

    // 2. Fallo post-apply revierte .aula/idl-codama.json, idl.json, programa.json y cliente generado
    const beforeRollbackCodama = readFileSync(codamaIdlPath, 'utf8');
    const beforeRollbackProg = readFileSync(join(fakeRepo, 'src/config/programa.json'), 'utf8');
    const secondPid = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
    const secondIdlPath = join(tempRoot, 'second-idl.json');
    const secondIdl = structuredClone(idl);
    if ('address' in secondIdl) (secondIdl as unknown as { address: string }).address = secondPid;
    secondIdl.metadata = { ...secondIdl.metadata, address: secondPid };
    writeFileSync(secondIdlPath, JSON.stringify(secondIdl, null, 2) + '\n');

    assert.throws(
      () =>
        stageIdlImport({
          repoRoot: fakeRepo,
          idlPath: secondIdlPath,
          programId: secondPid,
          backupDir: join(tempRoot, 'backup-fail'),
          postApplyHook: () => {
            throw new Error('post-apply boom');
          },
        }),
      /rollback completo restaurado.*post-apply boom/,
    );
    assert.equal(readFileSync(codamaIdlPath, 'utf8'), beforeRollbackCodama);
    assert.equal(readFileSync(join(fakeRepo, 'src/config/programa.json'), 'utf8'), beforeRollbackProg);
    assert.doesNotMatch(readFileSync(join(fakeRepo, 'clients/js/src/generated/programs/registro.ts'), 'utf8'), new RegExp(secondPid));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('firmante temporal aplica bloqueo conservador, serializacion, avance estricto y reinicio seguro', async () => {
  const localRunsDir = resolve(process.cwd(), '.aula', 'local-runs');
  mkdirSync(localRunsDir, { recursive: true });
  const tempRoot = mkdtempSync(join(localRunsDir, 'test-firmante-'));
  const statePath = join(tempRoot, 'state.json');

  try {
    const kp = Keypair.generate();
    const ownerSigner = createNoopSigner(address(kp.publicKey.toBase58()));
    const biz = 'OfflineZ0-test';
    const bh1 = new PublicKey(new Uint8Array(32).fill(11)).toBase58();
    const bh2 = new PublicKey(new Uint8Array(32).fill(12)).toBase58();

    let sigStatus: { err: unknown; confirmationStatus?: string | null } | null = null;
    const accounts = new Map<string, { data: Uint8Array }>();
    let delayBlockhash = false;

    const rpc: RpcFirmante = {
      async isBlockhashValid() {
        if (delayBlockhash) await new Promise((r) => setTimeout(r, 40));
        return { value: true };
      },
      async getAccountInfo(pubkey) {
        return accounts.get(pubkey.toBase58()) ?? null;
      },
      async getSignatureStatuses() {
        return { value: [sigStatus] };
      },
    };

    const manejador = crearManejadorFirmante({ connection: rpc, keypair: kp, biz, statePath });
    await manejador.verificarInicio();

    const buildTxBytes = (stage: number, blockhash: string) => {
      const ix =
        stage === 0
          ? getCrearRegistroInstruction({ owner: ownerSigner, registro: manejador.pdas.registro, nombreNegocio: biz })
          : getCrearClienteInstruction({
              owner: ownerSigner,
              registro: manejador.pdas.registro,
              cliente: manejador.pdas.ana,
              nombre: 'Ana',
            });
      const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(aWeb3(ix));
      return Array.from(tx.serialize({ requireAllSignatures: false }));
    };

    // 1. Etapa 0 firma y persiste { sig, blockhash } antes de devolver bytes
    const stage0Bytes = buildTxBytes(0, bh1);
    const res0 = await manejador.procesar(stage0Bytes);
    assert.equal(res0.status, 200);
    assert.equal(res0.stage, 0);
    const saved = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(saved.signedByStage['0'].sig, res0.sig);
    assert.equal(saved.signedByStage['0'].blockhash, bh1);

    // 2. Estado null (no resuelto) bloquea segundo intento de firma
    sigStatus = null;
    const resNull = await manejador.procesar(buildTxBytes(0, bh2));
    assert.equal(resNull.status, 409);
    assert.match(resNull.error, /unresolved signature/);

    // 3. Estado processed con err === null sigue bloqueado
    sigStatus = { err: null, confirmationStatus: 'processed' };
    const resProc = await manejador.procesar(buildTxBytes(0, bh2));
    assert.equal(resProc.status, 409);
    assert.match(resProc.error, /pending signature/);

    // 4. Firma confirmed sin cuenta esperada en cadena no avanza etapa
    sigStatus = { err: null, confirmationStatus: 'confirmed' };
    const resNoAcc = await manejador.procesar(buildTxBytes(0, bh2));
    assert.equal(resNoAcc.status, 409);
    assert.match(resNoAcc.error, /expected account state/);

    // 5. Firma confirmed + cuenta presente avanza a etapa 1 y firma crear_cliente
    accounts.set(manejador.pdas.registro, { data: new Uint8Array([1]) });
    const res1 = await manejador.procesar(buildTxBytes(1, bh2));
    assert.equal(res1.status, 200);
    assert.equal(res1.stage, 1);

    // 6. Firma confirmed con err !== null y cuenta sin cambios limpia pendiente y permite reintento
    sigStatus = { err: { InstructionError: [0, { Custom: 6004 }] }, confirmationStatus: 'confirmed' };
    const resRetry = await manejador.procesar(buildTxBytes(1, bh1));
    assert.equal(resRetry.status, 200);
    assert.equal(resRetry.stage, 1);

    // 7. Solicitud concurrente rechazada por bloqueo inFlight al reanudar con modo="reanudar"
    sigStatus = null;
    const restarted = crearManejadorFirmante({ connection: rpc, keypair: kp, biz, statePath, modo: 'reanudar' });
    delayBlockhash = true;
    const p1 = restarted.procesar(buildTxBytes(1, bh2));
    const p2 = restarted.procesar(buildTxBytes(1, bh2));
    const [r1, r2] = await Promise.all([p1, p2]);
    delayBlockhash = false;
    assert.equal(r1.status, 409);
    assert.equal(r2.status, 409);
    assert.match(r2.error, /concurrent signing request/);

    // 8. Reanudar en etapa 0 sin statePath (incluso cuando registro sigue null on-chain) falla cerrado
    assert.throws(
      () => crearManejadorFirmante({ connection: rpc, keypair: kp, biz: 'Etapa0Perdida', statePath: join(tempRoot, 'missing.json'), modo: 'reanudar' }),
      /Missing state file for resume/,
    );
    assert.throws(
      () => crearManejadorFirmante({ connection: rpc, keypair: kp, biz: 'Etapa0Perdida', modo: 'reanudar' }),
      /Missing state file for resume/,
    );

    // 9. Nuevo negocio rechaza statePath preexistente o registro ya existente on-chain
    assert.throws(
      () => crearManejadorFirmante({ connection: rpc, keypair: kp, biz, statePath, modo: 'nuevo' }),
      /State file already exists for new business/,
    );
    const freshRegistroExists = crearManejadorFirmante({ connection: rpc, keypair: kp, biz, modo: 'nuevo' });
    await assert.rejects(() => freshRegistroExists.verificarInicio(), /already exists for new business/);

    // 10. Mensaje inesperado rechazado sin firmar
    const freshBiz = crearManejadorFirmante({ connection: rpc, keypair: kp, biz: 'OtroNegocio', modo: 'nuevo' });
    const resBadMsg = await freshBiz.procesar(buildTxBytes(0, bh1));
    assert.equal(resBadMsg.status, 400);
    assert.match(resBadMsg.error, /unexpected message/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
