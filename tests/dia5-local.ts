import '../src/polyfills';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type AccountInfo,
} from '@solana/web3.js';
import { address, createNoopSigner } from '@solana/kit';
import {
  REGISTRO_PROGRAM_ADDRESS,
  getCambiarMontoInstruction,
  getClienteDecoder,
  getClienteEncoder,
  getCrearClienteInstruction,
  getCrearRegistroInstruction,
  getEliminarClienteInstruction,
  getHacerDevolucionInstruction,
  getRegistrarVentaInstruction,
  getRegistroDecoder,
} from '../clients/js/src/generated';
import { pdaCliente, pdaRegistro, pdaVenta } from '../src/solana/pdas';
import { aWeb3 } from '../src/solana/tx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');
const LIB_RS_PATH = join(ROOT_DIR, 'programa', 'src', 'lib.rs');
const LOCKFILE_FIXTURE_PATH = join(ROOT_DIR, 'tests', 'fixtures', 'registro-Cargo.lock');

const ANCHOR_GIT_REV = '33868ffeecdc96803e87cfb27748e9ec1f069eec';
const EXPECTED_LOCK_SOURCE = `source = "git+https://github.com/otter-sec/anchor?rev=${ANCHOR_GIT_REV}#${ANCHOR_GIT_REV}"`;
const NO_CLIENTE_LINE = 'require!(registro.clientes.contains(&cliente_key), Errores::NoCliente);';
const CLIENTE_ACCOUNT_SPACE = 370;

function assertSupportedNodeVersion(): void {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(process.version);
  assert.ok(match, `No se pudo parsear la versión de Node: ${process.version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const inRange =
    (major === 22 && minor >= 12) ||
    major === 23 ||
    major === 24;
  assert.ok(
    inRange,
    `Node ${process.version} fuera del rango requerido (>=22.12.0 <25). Ejecuta con: fnm exec --using=24 node --import tsx tests/dia5-local.ts`,
  );
}

function assertToolAvailable(tool: string, args: string[] = ['--version']): void {
  const res = spawnSync(tool, args, { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    const detail = res.error?.message ?? res.stderr?.trim() ?? `exit ${res.status}`;
    throw new Error(`Herramienta requerida no disponible (${tool}): ${detail}`);
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function buildSbfProgram(options: {
  label: string;
  programId: string;
  mutateRemoveNoCliente: boolean;
  lockfileBytes: Buffer;
  registerTempDir: (dir: string) => void;
}): { tempDir: string; soPath: string; sha256: string } {
  const tempDir = mkdtempSync(join(tmpdir(), `dia5-build-${options.label}-`));
  options.registerTempDir(tempDir);
  const programDir = join(tempDir, 'programs', 'registro');
  const srcDir = join(programDir, 'src');
  const outDir = join(tempDir, 'target', 'deploy');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(tempDir, 'Cargo.toml'),
    [
      '[workspace]',
      'members = ["programs/registro"]',
      'resolver = "2"',
      '',
      '[profile.release]',
      'overflow-checks = true',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(programDir, 'Cargo.toml'),
    [
      '[package]',
      'name = "registro"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[lib]',
      'crate-type = ["cdylib", "lib"]',
      'name = "registro"',
      '',
      '[features]',
      'default = []',
      'no-entrypoint = []',
      'cpi = ["no-entrypoint"]',
      'idl-build = ["anchor-lang/idl-build"]',
      '',
      '[dependencies]',
      `anchor-lang = { git = "https://github.com/otter-sec/anchor", rev = "${ANCHOR_GIT_REV}" }`,
      '',
    ].join('\n'),
    'utf8',
  );

  let libRs = readFileSync(LIB_RS_PATH, 'utf8');
  assert.ok(libRs.includes('declare_id!("")'), 'programa/src/lib.rs debe contener declare_id!("")');
  libRs = libRs.replace('declare_id!("")', `declare_id!("${options.programId}")`);

  if (options.mutateRemoveNoCliente) {
    assert.ok(
      libRs.includes(NO_CLIENTE_LINE),
      'No se encontró la línea de guardia NoCliente en programa/src/lib.rs',
    );
    libRs = libRs.replace(
      NO_CLIENTE_LINE,
      '// MUTATION CONTROL: NoCliente guard removed in isolated temp build',
    );
  }

  writeFileSync(join(srcDir, 'lib.rs'), libRs, 'utf8');
  const tempLockPath = join(tempDir, 'Cargo.lock');
  writeFileSync(tempLockPath, options.lockfileBytes);

  const manifestPath = join(programDir, 'Cargo.toml');
  const buildRes = spawnSync(
    'cargo-build-sbf',
    [
      '--manifest-path',
      manifestPath,
      '--tools-version',
      'v1.57',
      '--arch',
      'v3',
      '--sbf-out-dir',
      outDir,
      '--',
      '--locked',
    ],
    { cwd: tempDir, encoding: 'utf8' },
  );

  if (buildRes.error || buildRes.status !== 0) {
    throw new Error(
      `cargo-build-sbf (${options.label}) falló:\n${buildRes.stdout ?? ''}\n${buildRes.stderr ?? ''}`,
    );
  }

  const lockAfter = readFileSync(tempLockPath);
  assert.ok(
    lockAfter.equals(options.lockfileBytes),
    `Cargo.lock cambió tras cargo-build-sbf --locked (${options.label})`,
  );

  const soPath = join(outDir, 'registro.so');
  assert.ok(existsSync(soPath), `No se generó el binario SBF en ${soPath}`);

  return {
    tempDir,
    soPath,
    sha256: sha256File(soPath),
  };
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', () => resolvePromise(false));
    srv.listen({ host: '127.0.0.1', port }, () => {
      srv.close(() => resolvePromise(true));
    });
  });
}

async function allocateValidatorPorts(excludePorts: Set<number>): Promise<{
  rpcPort: number;
  faucetPort: number;
}> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = 19000 + Math.floor(Math.random() * 10000);
    const rpcPort = base;
    const wsPort = base + 1;
    const faucetPort = base + 2;
    if (
      excludePorts.has(rpcPort) ||
      excludePorts.has(wsPort) ||
      excludePorts.has(faucetPort)
    ) {
      continue;
    }
    const [okRpc, okWs, okFaucet] = await Promise.all([
      isPortFree(rpcPort),
      isPortFree(wsPort),
      isPortFree(faucetPort),
    ]);
    if (okRpc && okWs && okFaucet) {
      excludePorts.add(rpcPort);
      excludePorts.add(wsPort);
      excludePorts.add(faucetPort);
      return { rpcPort, faucetPort };
    }
  }
  throw new Error('No se encontraron puertos libres para solana-test-validator');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function startValidator(options: {
  label: string;
  programId: string;
  soPath: string;
  preloadAccountAddress: string;
  preloadAccountPath: string;
  excludePorts: Set<number>;
}): Promise<{
  rpcUrl: string;
  connection: Connection;
  ledgerDir: string;
  stop: () => Promise<void>;
}> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { rpcPort, faucetPort } = await allocateValidatorPorts(options.excludePorts);
    const ledgerDir = mkdtempSync(join(tmpdir(), `dia5-ledger-${options.label}-`));
    const rpcUrl = `http://127.0.0.1:${rpcPort}`;
    const wsUrl = `ws://127.0.0.1:${rpcPort + 1}`;

    let proc: ChildProcess | null = null;
    let spawned = false;
    let spawnError: Error | null = null;
    let childError: Error | null = null;
    let exited = false;
    let exitInfo = '';
    let stderrBuf = '';
    let settled = false;
    let resolveTermination!: () => void;
    const terminationPromise = new Promise<void>((r) => {
      resolveTermination = r;
    });

    const settleTermination = () => {
      if (!settled) {
        settled = true;
        resolveTermination();
      }
    };

    const hasProcessExited = (p: ChildProcess | null): boolean =>
      p !== null && (p.exitCode !== null || p.signalCode !== null);

    const isConfirmedNonStart = (): boolean =>
      proc === null || (spawnError !== null && !spawned && proc.pid === undefined);

    const waitForTermination = async (timeoutMs: number): Promise<boolean> => {
      if (isConfirmedNonStart() || exited || hasProcessExited(proc)) {
        return true;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          terminationPromise.then(() => true),
          new Promise<boolean>((resolveTimeout) => {
            timer = setTimeout(() => resolveTimeout(false), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    let connectionRef: Connection | null = null;
    let stopPromise: Promise<void> | null = null;

    const runStop = async () => {
      try {
        const internal = connectionRef as unknown as {
          _rpcWebSocket?: { autoReconnect?: boolean; close?: () => void };
          _rpcWebSocketHeartbeat?: ReturnType<typeof setInterval> | null;
        } | null;
        if (internal?._rpcWebSocketHeartbeat) {
          clearInterval(internal._rpcWebSocketHeartbeat);
          internal._rpcWebSocketHeartbeat = null;
        }
        if (internal?._rpcWebSocket) {
          internal._rpcWebSocket.autoReconnect = false;
          internal._rpcWebSocket.close?.();
        }
      } catch {
        // ignore websocket close errors during teardown
      }

      if (!isConfirmedNonStart() && !exited && !hasProcessExited(proc) && proc !== null) {
        proc.kill('SIGTERM');
        const exitedSigterm = await waitForTermination(3000);
        if (!exitedSigterm) {
          proc.kill('SIGKILL');
          const exitedSigkill = await waitForTermination(3000);
          if (!exitedSigkill) {
            throw new Error(
              `solana-test-validator (${options.label}) no terminó tras SIGTERM/SIGKILL; ledger preservado en ${ledgerDir}`,
            );
          }
        }
      }

      rmSync(ledgerDir, { recursive: true, force: true });
    };

    const stop = (): Promise<void> => (stopPromise ??= runStop());

    try {
      proc = spawn(
        'solana-test-validator',
        [
          '--ledger',
          ledgerDir,
          '--reset',
          '--rpc-port',
          String(rpcPort),
          '--faucet-port',
          String(faucetPort),
          '--bpf-program',
          options.programId,
          options.soPath,
          '--account',
          options.preloadAccountAddress,
          options.preloadAccountPath,
          '--quiet',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      proc.stderr?.on('data', (chunk) => {
        stderrBuf += String(chunk);
      });
      proc.once('spawn', () => {
        spawned = true;
      });
      proc.on('error', (err) => {
        const normalized = err instanceof Error ? err : new Error(String(err));
        if (!spawned && proc !== null && proc.pid === undefined) {
          spawnError = normalized;
          if (!exitInfo) exitInfo = `spawn error: ${normalized.message}`;
          settleTermination();
        } else {
          childError = normalized;
        }
      });
      const markExited = (code: number | null, signal: NodeJS.Signals | null) => {
        exited = true;
        if (!exitInfo) {
          exitInfo = `code=${code}, signal=${signal}, stderr=${stderrBuf.trim()}`;
        }
        settleTermination();
      };
      proc.once('exit', markExited);
      proc.once('close', markExited);

      const connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: wsUrl,
      });
      connectionRef = connection;

      let ready = false;
      for (let poll = 0; poll < 60; poll++) {
        if (spawnError) {
          throw new Error(
            `No se pudo iniciar solana-test-validator (${options.label}): ${spawnError.message}`,
          );
        }
        if (childError) {
          throw new Error(
            `Error en proceso solana-test-validator (${options.label}): ${childError.message}`,
          );
        }
        if (exited) {
          throw new Error(`solana-test-validator (${options.label}) terminó antes de estar listo: ${exitInfo}`);
        }
        try {
          await connection.getLatestBlockhash('confirmed');
          ready = true;
          break;
        } catch {
          await sleep(500);
        }
      }

      if (!ready) {
        throw new Error(`Timeout esperando RPC de solana-test-validator (${options.label}) en ${rpcUrl}`);
      }

      const [programAcc, fantasmaAcc] = await Promise.all([
        connection.getAccountInfo(new PublicKey(options.programId), 'confirmed'),
        connection.getAccountInfo(new PublicKey(options.preloadAccountAddress), 'confirmed'),
      ]);
      assert.ok(programAcc && programAcc.executable, `El programa ${options.programId} no cargó en ${options.label}`);
      assert.ok(
        fantasmaAcc && fantasmaAcc.data.length === CLIENTE_ACCOUNT_SPACE,
        `La cuenta pre-cargada ${options.preloadAccountAddress} no tiene ${CLIENTE_ACCOUNT_SPACE} bytes en ${options.label}`,
      );
      assert.equal(fantasmaAcc.owner.toBase58(), options.programId);

      return { rpcUrl, connection, ledgerDir, stop };
    } catch (err) {
      lastError = err;
      try {
        await stop();
      } catch (stopErr) {
        const startupMsg = err instanceof Error ? err.message : String(err);
        const cleanupMsg = stopErr instanceof Error ? stopErr.message : String(stopErr);
        throw new Error(
          `Fallo al iniciar solana-test-validator (${options.label}): ${startupMsg}; además falló la limpieza (ledger preservado): ${cleanupMsg}`,
        );
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function snapshotAccount(info: AccountInfo<Buffer> | null) {
  if (!info) return null;
  return {
    exists: true,
    owner: info.owner.toBase58(),
    executable: info.executable,
    lamports: info.lamports,
    dataHex: info.data.toString('hex'),
  };
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash('confirmed');
  const res = await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  assert.equal(res.value.err, null, `Airdrop falló para ${pubkey.toBase58()}`);
}

async function assertRejectedWith(
  action: () => Promise<unknown>,
  code: string,
  connection?: Connection,
): Promise<void> {
  let caught: unknown;
  let threw = false;
  try {
    await action();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.ok(threw, `Se esperaba rechazo ${code}, pero la operación tuvo éxito`);
  const errObj = caught as {
    message?: string;
    logs?: string[];
    getLogs?: (conn: Connection) => Promise<string[]>;
  };
  const logs = errObj.logs ?? (connection ? await errObj.getLogs?.(connection) : undefined) ?? [];
  assert.match(JSON.stringify([errObj.message ?? String(caught), logs]), new RegExp(code, 'i'));
}

async function fetchTransactionWithRetry(connection: Connection, signature: string) {
  for (let i = 0; i < 20; i++) {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await sleep(250);
  }
  throw new Error(`getTransaction no devolvió metadatos para ${signature} tras 20 intentos`);
}

async function main(): Promise<void> {
  assertSupportedNodeVersion();
  assertToolAvailable('cargo-build-sbf');
  assertToolAvailable('rustc');
  assertToolAvailable('solana-test-validator');

  // Self-check: ensure assertRejectedWith fails when action succeeds (even if code matches message)
  await assert.rejects(
    () => assertRejectedWith(async () => 'ok', 'Se esperaba rechazo|ok'),
    /Se esperaba rechazo/,
  );
  await assertRejectedWith(async () => {
    throw new Error('Custom program error: NoOwner (0x1770)');
  }, 'NoOwner|0x1770');
  console.log('0. Self-check assertRejectedWith OK.');

  assert.ok(
    existsSync(LOCKFILE_FIXTURE_PATH),
    `Falta el lockfile fijado en ${LOCKFILE_FIXTURE_PATH}`,
  );
  const lockfileBytes = readFileSync(LOCKFILE_FIXTURE_PATH);
  const lockfileText = lockfileBytes.toString('utf8');
  assert.ok(
    lockfileText.includes(EXPECTED_LOCK_SOURCE),
    `registro-Cargo.lock debe contener ${EXPECTED_LOCK_SOURCE}`,
  );

  const programId = String(REGISTRO_PROGRAM_ADDRESS);
  const tempDirsToClean: string[] = [];
  const usedPorts = new Set<number>();

  try {
    console.log('1. Compilando binario SBF sin modificar y mutado con -- --locked...');
    const unmodifiedBuild = buildSbfProgram({
      label: 'unmodified',
      programId,
      mutateRemoveNoCliente: false,
      lockfileBytes,
      registerTempDir: (dir) => tempDirsToClean.push(dir),
    });

    const mutatedBuild = buildSbfProgram({
      label: 'mutated',
      programId,
      mutateRemoveNoCliente: true,
      lockfileBytes,
      registerTempDir: (dir) => tempDirsToClean.push(dir),
    });

    assert.notEqual(
      unmodifiedBuild.sha256,
      mutatedBuild.sha256,
      'El binario mutado y el sin modificar deben tener SHA-256 distintos',
    );
    console.log('   unmodified.so:', unmodifiedBuild.soPath, 'sha256:', unmodifiedBuild.sha256);
    console.log('   mutated.so:   ', mutatedBuild.soPath, 'sha256:', mutatedBuild.sha256);

    // Deterministic owner & orphan Cliente PDA ("Fantasma", id_cliente = 99)
    const owner = Keypair.fromSeed(new Uint8Array(32).fill(5));
    const other = Keypair.generate();
    const signer = createNoopSigner(address(owner.publicKey.toBase58()));
    const otherSigner = createNoopSigner(address(other.publicKey.toBase58()));

    const registro = pdaRegistro('Prueba Dia 5', signer.address);
    const ana = pdaCliente(registro, 1);
    const luis = pdaCliente(registro, 2);
    const marta = pdaCliente(registro, 3);
    const fantasma = pdaCliente(registro, 99);
    const venta = pdaVenta(ana, 'CAF01');

    const encodedFantasma = getClienteEncoder().encode({
      idCliente: 99,
      nombre: 'Fantasma',
      compras: 0,
      historial: [],
    });
    const paddedFantasma = Buffer.alloc(CLIENTE_ACCOUNT_SPACE);
    Buffer.from(encodedFantasma).copy(paddedFantasma);
    const decodedFantasma = getClienteDecoder().decode(paddedFantasma);
    assert.equal(decodedFantasma.idCliente, 99);
    assert.equal(decodedFantasma.nombre, 'Fantasma');
    assert.equal(decodedFantasma.compras, 0);
    assert.deepEqual(decodedFantasma.historial, []);

    const fixtureDir = mkdtempSync(join(tmpdir(), 'dia5-fixture-'));
    tempDirsToClean.push(fixtureDir);
    const fantasmaFixturePath = join(fixtureDir, 'fantasma.json');
    writeFileSync(
      fantasmaFixturePath,
      JSON.stringify(
        {
          pubkey: fantasma,
          account: {
            lamports: 10_000_000,
            data: [paddedFantasma.toString('base64'), 'base64'],
            owner: programId,
            executable: false,
            rentEpoch: 0,
            space: CLIENTE_ACCOUNT_SPACE,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    // 2. Isolated mutation control
    console.log('2. Ejecutando control de mutación aislado (mutated.so)...');
    const mutatedVal = await startValidator({
      label: 'mutated',
      programId,
      soPath: mutatedBuild.soPath,
      preloadAccountAddress: fantasma,
      preloadAccountPath: fantasmaFixturePath,
      excludePorts: usedPorts,
    });
    try {
      await airdrop(mutatedVal.connection, owner.publicKey);
      const sigCrearRegMut = await sendAndConfirmTransaction(
        mutatedVal.connection,
        new Transaction().add(
          aWeb3(getCrearRegistroInstruction({ owner: signer, registro, nombreNegocio: 'Prueba Dia 5' })),
        ),
        [owner],
      );
      const sigElimMut = await sendAndConfirmTransaction(
        mutatedVal.connection,
        new Transaction().add(
          aWeb3(getEliminarClienteInstruction({ owner: signer, registro, cliente: fantasma, idCliente: 99 })),
        ),
        [owner],
      );
      const fantasmaAfterMut = await mutatedVal.connection.getAccountInfo(
        new PublicKey(fantasma),
        'confirmed',
      );
      assert.equal(
        fantasmaAfterMut,
        null,
        'En el binario mutado, eliminar_cliente(99) debe cerrar fantasma',
      );
      console.log('   control mutado OK. crear_registro:', sigCrearRegMut, 'eliminar_cliente(99):', sigElimMut);
    } finally {
      await mutatedVal.stop();
    }

    // 3. Unmodified validator instance
    console.log('3. Ejecutando suite completa en validador sin modificar (unmodified.so)...');
    const val = await startValidator({
      label: 'unmodified',
      programId,
      soPath: unmodifiedBuild.soPath,
      preloadAccountAddress: fantasma,
      preloadAccountPath: fantasmaFixturePath,
      excludePorts: usedPorts,
    });

    try {
      const c = val.connection;
      await airdrop(c, owner.publicKey);
      await airdrop(c, other.publicKey);

      const read = async (a: string) => c.getAccountInfo(new PublicKey(a), 'confirmed');
      const reg = async () => getRegistroDecoder().decode((await read(registro))!.data);
      const cli = async (a: string) => getClienteDecoder().decode((await read(a))!.data);
      const send = async (ix: Parameters<typeof aWeb3>[0], key = owner): Promise<string> => {
        const latest = await c.getLatestBlockhash('confirmed');
        const tx = new Transaction({
          feePayer: key.publicKey,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        }).add(aWeb3(ix));
        tx.sign(key);
        const sig = await c.sendRawTransaction(tx.serialize());
        const conf = await c.confirmTransaction(
          { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
          'confirmed',
        );
        if (conf.value.err !== null) {
          throw new Error(`Transacción fallida (${sig}): ${JSON.stringify(conf.value.err)}`);
        }
        return sig;
      };
      const reject = async (ix: Parameters<typeof aWeb3>[0], code: string, key = owner) => {
        await assertRejectedWith(() => send(ix, key), code, c);
        console.log('   rejected', code);
      };

      const sigs: string[] = [];
      sigs.push(await send(getCrearRegistroInstruction({ owner: signer, registro, nombreNegocio: 'Prueba Dia 5' })));
      for (const [cliente, nombre] of [
        [ana, 'Ana'],
        [luis, 'Luis'],
      ] as const) {
        sigs.push(await send(getCrearClienteInstruction({ owner: signer, registro, cliente, nombre })));
      }
      sigs.push(
        await send(
          getRegistrarVentaInstruction({
            owner: signer,
            registro,
            cliente: ana,
            venta,
            idCliente: 1,
            sku: 'CAF01',
            descripcion: 'Cafe',
            monto: 50,
          }),
        ),
      );

      // Positive controls on Day 5
      await reject(
        getEliminarClienteInstruction({ owner: otherSigner, registro, cliente: ana, idCliente: 1 }),
        'NoOwner|0x1770',
        other,
      );
      await reject(
        getEliminarClienteInstruction({ owner: signer, registro, cliente: luis, idCliente: 1 }),
        'ConstraintSeeds|0x7d6',
      );
      await reject(
        getEliminarClienteInstruction({ owner: signer, registro, cliente: fantasma, idCliente: 98 }),
        'ConstraintSeeds|0x7d6',
      );
      await reject(
        getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 }),
        'ClienteConVentas|0x1773',
      );

      // Legacy simulateTransaction(tx, [owner]) check for NoCliente
      const simBh = await c.getLatestBlockhash('confirmed');
      const simTx = new Transaction({
        feePayer: owner.publicKey,
        blockhash: simBh.blockhash,
        lastValidBlockHeight: simBh.lastValidBlockHeight,
      }).add(
        aWeb3(getEliminarClienteInstruction({ owner: signer, registro, cliente: fantasma, idCliente: 99 })),
      );
      const simRes = await c.simulateTransaction(simTx, [owner]);
      assert.deepEqual(simRes.value.err, { InstructionError: [0, { Custom: 6002 }] });
      assert.match((simRes.value.logs ?? []).join('\n'), /NoCliente|6002/);
      console.log('   simulateTransaction(tx, [owner]) NoCliente OK:', JSON.stringify(simRes.value.err));

      // Before snapshot for landed failed NoCliente transaction
      const [beforeReg, beforeFantasma, beforeAna, beforeLuis, beforeVenta] = await Promise.all(
        [registro, fantasma, ana, luis, venta].map((a) => read(a).then(snapshotAccount)),
      );
      const ownerBalanceBefore = await c.getBalance(owner.publicKey, 'confirmed');

      const bh = await c.getLatestBlockhash('confirmed');
      const landedTx = new Transaction({
        feePayer: owner.publicKey,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      }).add(
        aWeb3(getEliminarClienteInstruction({ owner: signer, registro, cliente: fantasma, idCliente: 99 })),
      );
      landedTx.sign(owner);
      const noClienteSig = await c.sendRawTransaction(landedTx.serialize(), { skipPreflight: true });
      const confirmRes = await c.confirmTransaction(
        { signature: noClienteSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        'confirmed',
      );
      assert.deepEqual(confirmRes.value.err, { InstructionError: [0, { Custom: 6002 }] });

      const txMeta = await fetchTransactionWithRetry(c, noClienteSig);
      assert.ok(txMeta.meta, 'txMeta.meta debe estar presente');
      assert.deepEqual(txMeta.meta.err, { InstructionError: [0, { Custom: 6002 }] });
      assert.match((txMeta.meta.logMessages ?? []).join('\n'), /NoCliente.*6002|Error Number: 6002/);
      assert.ok(txMeta.meta.fee > 0, 'La transacción fallida en cadena debe cobrar fee');

      const ownerBalanceAfter = await c.getBalance(owner.publicKey, 'confirmed');
      assert.equal(
        ownerBalanceAfter,
        ownerBalanceBefore - txMeta.meta.fee,
        'El saldo del owner debe disminuir exactamente en meta.fee',
      );

      const [afterReg, afterFantasma, afterAna, afterLuis, afterVenta] = await Promise.all(
        [registro, fantasma, ana, luis, venta].map((a) => read(a).then(snapshotAccount)),
      );
      assert.deepEqual(afterReg, beforeReg, 'registro no debe cambiar tras NoCliente');
      assert.deepEqual(afterFantasma, beforeFantasma, 'fantasma no debe cambiar ni cerrarse tras NoCliente');
      assert.deepEqual(afterAna, beforeAna, 'ana no debe cambiar tras NoCliente');
      assert.deepEqual(afterLuis, beforeLuis, 'luis no debe cambiar tras NoCliente');
      assert.deepEqual(afterVenta, beforeVenta, 'venta no debe cambiar tras NoCliente');

      console.log(
        '   landed NoCliente OK. signature:',
        noClienteSig,
        'fee:',
        txMeta.meta.fee,
        'ownerBalanceBefore:',
        ownerBalanceBefore,
        'ownerBalanceAfter:',
        ownerBalanceAfter,
      );

      // Remaining Day 5 checks
      sigs.push(
        await send(
          getHacerDevolucionInstruction({
            owner: signer,
            registro,
            cliente: ana,
            venta,
            idCliente: 1,
            sku: 'CAF01',
          }),
        ),
      );
      assert.equal((await cli(ana)).compras, 0);
      assert.equal((await cli(ana)).historial.length, 0);

      const bajaAnaSig = await send(
        getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 }),
      );
      sigs.push(bajaAnaSig);
      assert.equal(await read(ana), null);
      assert.deepEqual((await reg()).clientes, [luis]);
      assert.equal((await reg()).idCounter, 2);
      assert.equal((await cli(luis)).nombre, 'Luis');

      sigs.push(await send(getCrearClienteInstruction({ owner: signer, registro, cliente: marta, nombre: 'Marta' })));
      assert.equal((await cli(marta)).idCliente, 3);
      assert.equal((await reg()).idCounter, 3);

      const v2 = pdaVenta(luis, 'TE01');
      sigs.push(
        await send(
          getRegistrarVentaInstruction({
            owner: signer,
            registro,
            cliente: luis,
            venta: v2,
            idCliente: 2,
            sku: 'TE01',
            descripcion: 'Te',
            monto: 10,
          }),
        ),
      );
      sigs.push(
        await send(
          getCambiarMontoInstruction({
            owner: signer,
            registro,
            cliente: luis,
            venta: v2,
            idCliente: 2,
            sku: 'TE01',
            nuevoMonto: 20,
          }),
        ),
      );
      sigs.push(
        await send(
          getHacerDevolucionInstruction({
            owner: signer,
            registro,
            cliente: luis,
            venta: v2,
            idCliente: 2,
            sku: 'TE01',
          }),
        ),
      );
      assert.equal((await cli(luis)).compras, 0);
      assert.equal(await read(v2), null);

      console.log('Local validator verification passed.');
      console.log('  noClienteSig:', noClienteSig);
      console.log('  bajaAnaSig:  ', bajaAnaSig);
      console.log('  allSigs:     ', sigs);
    } finally {
      await val.stop();
    }
  } finally {
    for (const dir of tempDirsToClean) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await main();
}
