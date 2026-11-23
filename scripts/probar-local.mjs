import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function assertCommandAvailable(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.error || res.status !== 0) {
    throw new Error(`Falta prerequisito en PATH: ${cmd}`);
  }
}

function tryListen(port) {
  return new Promise((resolveListen) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolveListen(null));
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolveListen({ server, port: typeof addr === 'object' && addr ? addr.port : port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function allocateValidatorPorts() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = 20000 + Math.floor(Math.random() * 20000);
    const rpcProbe = await tryListen(base);
    if (!rpcProbe) continue;
    const wsProbe = await tryListen(base + 1);
    if (!wsProbe) {
      await closeServer(rpcProbe.server);
      continue;
    }
    const faucetProbe = await tryListen(base + 2);
    if (!faucetProbe) {
      await closeServer(rpcProbe.server);
      await closeServer(wsProbe.server);
      continue;
    }
    const gossipProbe = await tryListen(base + 3);
    await closeServer(rpcProbe.server);
    await closeServer(wsProbe.server);
    await closeServer(faucetProbe.server);
    if (!gossipProbe) continue;
    await closeServer(gossipProbe.server);
    return { rpcPort: base, faucetPort: base + 2, gossipPort: base + 3 };
  }
  throw new Error('No se pudieron reservar puertos consecutivos libres para solana-test-validator.');
}

function runSyncOrThrow(cmd, args, cwd, env = process.env) {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`Fallo ${cmd} ${args.join(' ')} (exit ${res.status})`);
}

export function trackChildProcess(proc) {
  const state = {
    spawned: typeof proc.pid === 'number' && proc.pid > 0,
    exited: false,
    exitCode: null,
    signalCode: null,
    spawnError: null,
    lastError: null,
  };
  proc.once('spawn', () => {
    state.spawned = true;
  });
  proc.on('error', (err) => {
    state.lastError = err;
    // Solo un error previo a la creacion del proceso (sin pid ni evento 'spawn') es fallo de spawn.
    if (!state.spawned && proc.pid == null) {
      state.spawnError = err;
    }
  });
  proc.once('exit', (code, signal) => {
    state.exited = true;
    state.exitCode = code;
    state.signalCode = signal;
  });
  return state;
}

function assertChildAlive(validatorProc, procState) {
  if (procState?.spawnError) {
    throw new Error(`No se pudo iniciar solana-test-validator: ${procState.spawnError.message}`);
  }
  if (procState?.exited || validatorProc.exitCode !== null || validatorProc.signalCode !== null) {
    const code = procState?.exitCode ?? validatorProc.exitCode;
    const signal = procState?.signalCode ?? validatorProc.signalCode;
    throw new Error(`solana-test-validator termino prematuramente (code=${code}, signal=${signal}).`);
  }
}

export async function waitForValidatorReady(rpcUrl, programId, validatorProc, procState, options = {}) {
  const { markerPubkey, timeoutMs = 45_000, pollIntervalMs = 400 } = options;
  const connection = new Connection(rpcUrl, 'confirmed');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertChildAlive(validatorProc, procState);
    try {
      await connection.getGenesisHash();
      const slot = await connection.getSlot('confirmed');
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const info = await connection.getAccountInfo(new PublicKey(programId), 'confirmed');
      const markerOk = markerPubkey
        ? (await connection.getBalance(new PublicKey(markerPubkey), 'confirmed')) > 0
        : true;
      if (slot >= 1 && blockhash && info?.executable && markerOk) {
        assertChildAlive(validatorProc, procState);
        return true;
      }
    } catch {
      // Sigue esperando al validador.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, remaining)));
  }
  assertChildAlive(validatorProc, procState);
  throw new Error(`Timeout esperando a solana-test-validator en ${rpcUrl}.`);
}

function waitForProcessExit(proc, procState, timeoutMs) {
  return new Promise((resolveWait) => {
    const cleanup = () => {
      clearTimeout(timer);
      proc.off('exit', onExit);
      proc.off('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolveWait(true);
    };
    const onError = () => {
      const preSpawn = !procState?.spawned && proc.pid == null;
      if (preSpawn) {
        cleanup();
        resolveWait(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolveWait(false);
    }, timeoutMs);
    proc.once('exit', onExit);
    proc.on('error', onError);
  });
}

function trySendSignal(proc, signal) {
  try {
    proc.kill(signal);
  } catch {
    // El error al senalar no confirma que el proceso haya terminado; waitForProcessExit decide.
  }
}

export async function stopValidator(proc, procState, options = {}) {
  const { termTimeoutMs = 5000, killTimeoutMs = 5000 } = options;
  if (!proc) return { stopped: true, reason: 'not-started' };
  const genuineSpawnFailure = Boolean(procState?.spawnError && !procState?.spawned && proc.pid == null);
  if (procState?.exited || genuineSpawnFailure || proc.exitCode !== null || proc.signalCode !== null) {
    return { stopped: true, reason: 'already-exited' };
  }

  const termWait = waitForProcessExit(proc, procState, termTimeoutMs);
  trySendSignal(proc, 'SIGTERM');
  if (await termWait) return { stopped: true, reason: 'sigterm' };

  const killWait = waitForProcessExit(proc, procState, killTimeoutMs);
  trySendSignal(proc, 'SIGKILL');
  if (await killWait) return { stopped: true, reason: 'sigkill' };

  return { stopped: false, reason: 'unconfirmed-exit' };
}

export function cleanupRunDir(runDir, stopResult) {
  if (!stopResult?.stopped) {
    throw new Error(`No se pudo confirmar la terminacion de solana-test-validator; se preserva el directorio de ejecucion: ${runDir}`);
  }
  rmSync(runDir, { recursive: true, force: true });
}

async function main() {
  assertCommandAvailable('solana-test-validator');
  assertCommandAvailable('cargo-build-sbf');
  assertCommandAvailable('anchor');

  const lockfile = resolve(REPO_ROOT, 'tests/fixtures/registro-Cargo.lock');
  if (!existsSync(lockfile)) throw new Error(`Falta ${lockfile}`);
  const toolsDir = join(homedir(), '.cache', 'solana', 'v1.57');
  if (!existsSync(toolsDir)) throw new Error(`Falta cache de platform-tools v1.57 en ${toolsDir}`);

  const programaConfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/config/programa.json'), 'utf8'));
  const programId = programaConfig.programId;

  const runsBase = resolve(REPO_ROOT, '.aula', 'local-runs');
  mkdirSync(runsBase, { recursive: true });
  const runDir = mkdtempSync(join(runsBase, 'run-'));
  let validatorProc = null;
  let validatorState = null;

  try {
    const workDir = join(runDir, 'cargo-build');
    const outDir = join(runDir, 'build');
    const workspaceDir = join(runDir, 'workspace');
    const ledgerDir = join(runDir, 'ledger');

    console.log(`1. Compilando programa e IDL en entorno aislado (${runDir})...`);
    runSyncOrThrow(
      process.execPath,
      [
        'scripts/desplegar-devnet.mjs',
        '--solo-build',
        '--program-id',
        programId,
        '--work-dir',
        workDir,
        '--out-dir',
        outDir,
      ],
      REPO_ROOT,
    );

    console.log('2. Preparando copia aislada del workspace para IDL, cliente y pruebas...');
    mkdirSync(workspaceDir, { recursive: true });
    for (const rel of [
      'package.json',
      'codama.json',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.app.json',
      'tsconfig.node.json',
      'idl.json',
      '.aula/idl-codama.json',
      'src',
      'tests',
      'scripts',
      'clients/js/package.json',
      'clients/js/src/generated',
    ]) {
      const srcPath = resolve(REPO_ROOT, rel);
      if (!existsSync(srcPath)) continue;
      const dstPath = join(workspaceDir, rel);
      mkdirSync(dirname(dstPath), { recursive: true });
      cpSync(srcPath, dstPath, { recursive: true });
    }
    symlinkSync(resolve(REPO_ROOT, 'node_modules'), join(workspaceDir, 'node_modules'), 'dir');

    runSyncOrThrow(
      process.execPath,
      ['scripts/configurar-idl.mjs', join(outDir, 'idl.json'), '--program-id', programId],
      workspaceDir,
    );
    runSyncOrThrow('npm', ['run', 'comprobar:idl'], workspaceDir);
    runSyncOrThrow('npm', ['run', 'typecheck'], workspaceDir);
    runSyncOrThrow('npm', ['test'], workspaceDir, { ...process.env, REQUIRE_ZERO_AMOUNT_IDL: '1' });

    const { rpcPort, faucetPort, gossipPort } = await allocateValidatorPorts();
    const rpcUrl = `http://127.0.0.1:${rpcPort}`;
    const markerPubkey = Keypair.generate().publicKey.toBase58();
    console.log(`3. Iniciando solana-test-validator aislado en ${rpcUrl} (faucet ${faucetPort}, gossip ${gossipPort})...`);
    validatorProc = spawn(
      'solana-test-validator',
      [
        '--bind-address',
        '127.0.0.1',
        '--ledger',
        ledgerDir,
        '--reset',
        '--mint',
        markerPubkey,
        '--rpc-port',
        String(rpcPort),
        '--faucet-port',
        String(faucetPort),
        '--gossip-port',
        String(gossipPort),
        '--bpf-program',
        programId,
        join(outDir, 'registro.so'),
      ],
      { cwd: workspaceDir, stdio: 'ignore' },
    );
    validatorState = trackChildProcess(validatorProc);

    await waitForValidatorReady(rpcUrl, programId, validatorProc, validatorState, { markerPubkey });
    console.log('4. Ejecutando tests/dia5-local.ts contra el programa compilado...');
    runSyncOrThrow(
      process.execPath,
      ['--import', 'tsx', 'tests/dia5-local.ts'],
      workspaceDir,
      { ...process.env, LOCAL_RPC_URL: rpcUrl },
    );
  } finally {
    const stopResult = await stopValidator(validatorProc, validatorState);
    cleanupRunDir(runDir, stopResult);
  }
}

const isMain = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
