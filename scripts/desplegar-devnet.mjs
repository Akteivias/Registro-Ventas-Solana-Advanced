import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { huellaIdl, validarIdl } from './contrato-idl.mjs';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_PROGRAM_KEYPAIR = '~/.config/solana/registro-devnet-program-keypair.json';
const DEFAULT_AUTHORITY_KEYPAIR = '~/.config/solana/registro-devnet-tester-keypair.json';
const BPF_LOADER_UPGRADEABLE_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
const ANCHOR_REV = '33868ffeecdc96803e87cfb27748e9ec1f069eec';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function expandHome(rawPath) {
  if (rawPath === '~') return homedir();
  if (rawPath.startsWith('~/') || rawPath.startsWith('~' + sep)) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function resolveRealWithMissing(targetPath) {
  let current = resolve(targetPath);
  const trailing = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    trailing.unshift(basename(current));
    current = parent;
  }
  const realBase = existsSync(current) ? realpathSync(current) : current;
  return trailing.length > 0 ? join(realBase, ...trailing) : realBase;
}

/**
 * Ensures a keypair path resolves strictly outside the repository root,
 * accounting for `~` expansion, `..` traversal, and symlinks.
 */
export function assertExternalPath(rawPath, repoRoot = REPO_ROOT) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Ruta de keypair invalida o vacia.');
  }
  const expanded = expandHome(rawPath.trim());
  const realRepoRoot = realpathSync(repoRoot);
  const realTarget = resolveRealWithMissing(expanded);
  const rel = relative(realRepoRoot, realTarget);
  if (rel === '' || isAbsolute(rel) || (!rel.startsWith('..' + sep) && rel !== '..')) {
    throw new Error(`El keypair debe vivir fuera del repositorio: ${rawPath}`);
  }
  return realTarget;
}

function runCmd(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: opts.capture ? 'pipe' : 'inherit',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const detail = opts.capture ? `\n${res.stderr || res.stdout || ''}`.trim() : '';
    throw new Error(`Fallo ${cmd} ${args.join(' ')} (exit ${res.status})${detail ? ': ' + detail : ''}`);
  }
  return res;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function loadKeypair(filePath) {
  const secret = JSON.parse(readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function normalizar(valor) {
  return String(valor).replace(/_/g, '').toLowerCase();
}

function validarIdlCompleto(idl, programId) {
  const datos = validarIdl(idl, programId);
  const elimIx = idl.instructions?.find((item) => normalizar(item.name) === 'eliminarcliente');
  if (!elimIx || !Array.isArray(elimIx.args) || elimIx.args.length !== 1) {
    throw new Error('El IDL compilado no contiene eliminar_cliente con exactamente 1 argumento.');
  }
  const arg = elimIx.args[0];
  if (normalizar(arg.name) !== 'idcliente' || arg.type !== 'u16') {
    throw new Error(`Argumento inesperado en eliminar_cliente: ${arg.name}:${JSON.stringify(arg.type)}`);
  }
  return datos;
}

function ensureKeypair(keypairPath) {
  const parent = dirname(keypairPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  if (!existsSync(keypairPath)) {
    runCmd('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '--outfile', keypairPath]);
  }
  chmodSync(keypairPath, 0o600);
  return loadKeypair(keypairPath).publicKey.toBase58();
}

function runGenerarKeypairs() {
  const programPath = assertExternalPath(process.env.DEVNET_PROGRAM_KEYPAIR || DEFAULT_PROGRAM_KEYPAIR);
  const authorityPath = assertExternalPath(process.env.DEVNET_AUTHORITY_KEYPAIR || DEFAULT_AUTHORITY_KEYPAIR);
  const programPubkey = ensureKeypair(programPath);
  const authorityPubkey = ensureKeypair(authorityPath);
  console.log(`Program Keypair (${programPath}): ${programPubkey}`);
  console.log(`Authority Keypair (${authorityPath}): ${authorityPubkey}`);
}

function getToolchainVersion(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.error || res.status !== 0) return 'unknown';
  return (res.stdout || res.stderr || '').trim().split('\n')[0];
}

function buildOfflineProgramAndIdl(programId, buildDir) {
  const cargoLockSrc = resolve(REPO_ROOT, 'tests/fixtures/registro-Cargo.lock');
  const libRsSrc = resolve(REPO_ROOT, 'programa/src/lib.rs');
  if (!existsSync(cargoLockSrc)) {
    throw new Error(`Falta ${cargoLockSrc}. Copia tests/fixtures/registro-Cargo.lock primero.`);
  }
  const rawLibRs = readFileSync(libRsSrc, 'utf8');
  if (!/declare_id!\(\s*""\s*\)/.test(rawLibRs)) {
    throw new Error('programa/src/lib.rs no contiene declare_id!("") esperado.');
  }

  const programDir = join(buildDir, 'programs', 'registro');
  mkdirSync(join(programDir, 'src'), { recursive: true });
  writeFileSync(
    join(buildDir, 'Cargo.toml'),
    `[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
`,
  );
  writeFileSync(
    join(programDir, 'Cargo.toml'),
    `[package]
name = "registro"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "registro"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build"]

[dependencies]
anchor-lang = { git = "https://github.com/otter-sec/anchor", rev = "${ANCHOR_REV}" }
`,
  );
  writeFileSync(
    join(buildDir, 'Anchor.toml'),
    `[toolchain]
anchor_version = "1.2.2"

[features]
resolution = true
skip-lint = false

[programs.devnet]
registro = "${programId}"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
`,
  );
  cpSync(cargoLockSrc, join(buildDir, 'Cargo.lock'));
  writeFileSync(
    join(programDir, 'src', 'lib.rs'),
    rawLibRs.replace(/declare_id!\(\s*""\s*\)/, `declare_id!("${programId}")`),
  );

  runCmd(
    'cargo-build-sbf',
    ['--manifest-path', 'programs/registro/Cargo.toml', '--tools-version', 'v1.57', '--arch', 'v3', '--sbf-out-dir', 'target/deploy', '--', '--locked'],
    { cwd: buildDir },
  );
  const tempIdlPath = join(buildDir, 'idl.json');
  runCmd('anchor', ['idl', 'build', '-o', tempIdlPath, '--', '--locked'], { cwd: programDir });

  const soPath = join(buildDir, 'target', 'deploy', 'registro.so');
  if (!existsSync(soPath)) {
    throw new Error(`No se encontro el binario SBF compilado en ${soPath}`);
  }
  const idl = JSON.parse(readFileSync(tempIdlPath, 'utf8'));
  validarIdlCompleto(idl, programId);
  return {
    soPath,
    tempIdlPath,
    idl,
    soSha256: sha256File(soPath),
    idlSha256: huellaIdl(idl),
    soBytes: statSync(soPath).size,
  };
}

/**
 * Stages IDL import and client generation in an isolated `/tmp` directory,
 * backs up the 4 repository target artifacts, applies the staged outputs,
 * runs `verificar-contrato.mjs`, and rolls back all 4 targets on any failure.
 */
export function stageIdlImport({ repoRoot = REPO_ROOT, idlPath, programId, backupDir, postApplyHook }) {
  const stageDir = mkdtempSync(join(tmpdir(), 'dia5-idl-stage-'));
  try {
    const copyPairs = [
      'package.json',
      'codama.json',
      'idl.json',
      'src/config/programa.json',
      'clients/js/package.json',
      'scripts/configurar-idl.mjs',
      'scripts/generar-cliente.mjs',
      'scripts/contrato-idl.mjs',
      'scripts/verificar-contrato.mjs',
    ];
    for (const rel of copyPairs) {
      const src = resolve(repoRoot, rel);
      const dst = join(stageDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
    }
    mkdirSync(join(stageDir, 'clients/js/src'), { recursive: true });
    cpSync(resolve(repoRoot, 'clients/js/src/generated'), join(stageDir, 'clients/js/src/generated'), { recursive: true });
    symlinkSync(resolve(repoRoot, 'node_modules'), join(stageDir, 'node_modules'), 'dir');

    runCmd(process.execPath, ['scripts/configurar-idl.mjs', resolve(idlPath), '--program-id', programId], { cwd: stageDir });
    runCmd(process.execPath, ['scripts/verificar-contrato.mjs'], { cwd: stageDir });

    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const targets = ['idl.json', 'src/config/programa.json', 'clients/js/package.json'];
    for (const rel of targets) {
      const dst = join(backupDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(resolve(repoRoot, rel), dst);
    }
    const repoGenerated = resolve(repoRoot, 'clients/js/src/generated');
    const backupGenerated = join(backupDir, 'clients/js/src/generated');
    mkdirSync(dirname(backupGenerated), { recursive: true });
    cpSync(repoGenerated, backupGenerated, { recursive: true });

    try {
      for (const rel of targets) {
        cpSync(join(stageDir, rel), resolve(repoRoot, rel));
      }
      rmSync(repoGenerated, { recursive: true, force: true });
      cpSync(join(stageDir, 'clients/js/src/generated'), repoGenerated, { recursive: true });
      runCmd(process.execPath, ['scripts/verificar-contrato.mjs'], { cwd: repoRoot });
      if (postApplyHook) postApplyHook();
    } catch (applyErr) {
      try {
        for (const rel of targets) {
          cpSync(join(backupDir, rel), resolve(repoRoot, rel));
        }
        rmSync(repoGenerated, { recursive: true, force: true });
        cpSync(backupGenerated, repoGenerated, { recursive: true });
      } catch (rollbackErr) {
        throw new Error(
          `Fallo al aplicar IDL (${applyErr.message}) y fallo el rollback (${rollbackErr.message}). Respaldo en: ${backupDir}`,
        );
      }
      throw new Error(`Fallo al aplicar IDL; rollback completo restaurado. Program ID ${programId}, IDL en ${idlPath}. Causa: ${applyErr.message}`);
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

async function ensureDevnetFunding(connection, authorityPubkey, estimatedRequired) {
  const pk = new PublicKey(authorityPubkey);
  let balance = await connection.getBalance(pk, 'confirmed');
  if (balance >= estimatedRequired) return balance;

  console.log(`Balance actual: ${balance} lamports; estimado requerido: ${estimatedRequired} lamports. Intentando airdrop Devnet (max 2)...`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = spawnSync('solana', ['airdrop', '2', authorityPubkey, '--url', connection.rpcEndpoint], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (res.status === 0) {
      balance = await connection.getBalance(pk, 'confirmed');
      if (balance >= estimatedRequired) return balance;
    } else {
      console.warn(`Airdrop intento ${attempt}/2 fallo: ${(res.stderr || res.stdout || '').trim()}`);
    }
  }

  const shortfall = estimatedRequired - balance;
  const powCheck = spawnSync('which', ['devnet-pow'], { encoding: 'utf8', stdio: 'pipe' });
  const powNote = powCheck.status === 0
    ? 'devnet-pow disponible: verifica `devnet-pow get-all-faucets --url devnet` antes de minar.'
    : 'devnet-pow no esta instalado en PATH.';
  throw new Error(
    `Fondos insuficientes en Devnet para ${authorityPubkey}. Balance=${balance}, estimado=${estimatedRequired}, faltante=${shortfall} lamports. ${powNote} Fondea manualmente esta direccion publica y reintenta.`,
  );
}

function parseArgs(argv) {
  const soloBuild = argv.includes('--solo-build');
  const generarKeypairs = argv.includes('--generar-keypairs');
  const upgrade = argv.includes('--upgrade');
  const idxPid = argv.indexOf('--program-id');
  let programIdArg;
  if (idxPid >= 0) {
    programIdArg = argv[idxPid + 1];
    if (!programIdArg || programIdArg.startsWith('--')) throw new Error('Falta el valor de --program-id.');
    programIdArg = new PublicKey(programIdArg).toBase58();
  }
  return { soloBuild, generarKeypairs, upgrade, programIdArg };
}

async function main() {
  const { soloBuild, generarKeypairs, upgrade, programIdArg } = parseArgs(process.argv.slice(2));
  if (generarKeypairs) {
    runGenerarKeypairs();
    return;
  }

  if (soloBuild) {
    let programId = programIdArg;
    if (!programId) {
      const candidatePath = assertExternalPath(process.env.DEVNET_PROGRAM_KEYPAIR || DEFAULT_PROGRAM_KEYPAIR);
      programId = existsSync(candidatePath)
        ? loadKeypair(candidatePath).publicKey.toBase58()
        : Keypair.generate().publicKey.toBase58();
    }
    const buildDir = mkdtempSync(join(tmpdir(), 'dia5-devnet-build-'));
    try {
      const built = buildOfflineProgramAndIdl(programId, buildDir);
      console.log(JSON.stringify({
        mode: 'solo-build',
        programId,
        soBytes: built.soBytes,
        soSha256: built.soSha256,
        idlSha256: built.idlSha256,
      }, null, 2));
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
    return;
  }

  const programKeypairPath = assertExternalPath(process.env.DEVNET_PROGRAM_KEYPAIR || DEFAULT_PROGRAM_KEYPAIR);
  const authorityKeypairPath = assertExternalPath(process.env.DEVNET_AUTHORITY_KEYPAIR || DEFAULT_AUTHORITY_KEYPAIR);
  if (!existsSync(programKeypairPath) || !existsSync(authorityKeypairPath)) {
    throw new Error('Faltan keypairs externos. Ejecuta primero: node scripts/desplegar-devnet.mjs --generar-keypairs');
  }
  const programKeypair = loadKeypair(programKeypairPath);
  const authorityKeypair = loadKeypair(authorityKeypairPath);
  const programId = programKeypair.publicKey.toBase58();
  const authorityPubkey = authorityKeypair.publicKey.toBase58();

  const rpcUrl = process.env.DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const connection = new Connection(rpcUrl, 'confirmed');
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(`RPC no corresponde a Devnet (genesis=${genesis}, esperado=${DEVNET_GENESIS}).`);
  }

  const existingInfo = await connection.getAccountInfo(programKeypair.publicKey, 'confirmed');
  if (existingInfo !== null) {
    if (!existingInfo.executable || existingInfo.owner.toBase58() !== BPF_LOADER_UPGRADEABLE_ID) {
      throw new Error(`La cuenta ${programId} ya existe en Devnet pero no es un programa BPFUpgradeable ejecutable.`);
    }
    const showRes = runCmd('solana', ['program', 'show', programId, '--url', rpcUrl, '--output', 'json'], { capture: true });
    const showJson = JSON.parse(showRes.stdout);
    if (showJson.authority !== authorityPubkey) {
      throw new Error(`Upgrade authority mismatch: en cadena=${showJson.authority}, local=${authorityPubkey}.`);
    }
    if (!upgrade) {
      console.log(`El programa ${programId} ya existe en Devnet bajo la autoridad ${authorityPubkey}. Una cuenta ejecutable existente por si sola no prueba bytecode ni IDL coincidentes; pasa --upgrade para redesplegar.`);
      return;
    }
  }

  const buildDir = mkdtempSync(join(tmpdir(), 'dia5-devnet-build-'));
  let recoveryDir;
  let bufferPubkey;
  try {
    const built = buildOfflineProgramAndIdl(programId, buildDir);
    recoveryDir = mkdtempSync(join(homedir(), '.config', 'solana', `registro-devnet-recovery-${programId.slice(0, 8)}-`));
    chmodSync(recoveryDir, 0o700);
    const savedIdlPath = join(recoveryDir, 'idl.json');
    cpSync(built.tempIdlPath, savedIdlPath);
    writeFileSync(
      join(recoveryDir, 'provenance.json'),
      JSON.stringify({
        programId,
        authorityPubkey,
        soSha256: built.soSha256,
        idlSha256: built.idlSha256,
        soBytes: built.soBytes,
        toolchain: {
          cargoBuildSbf: getToolchainVersion('cargo-build-sbf'),
          rustc: getToolchainVersion('rustc'),
          anchor: getToolchainVersion('anchor'),
          solana: getToolchainVersion('solana'),
        },
      }, null, 2) + '\n',
    );

    const rentProgramData = await connection.getMinimumBalanceForRentExemption(45 + built.soBytes);
    const rentProgram = await connection.getMinimumBalanceForRentExemption(36);
    const estimatedRequired = rentProgramData + rentProgram + 10_000_000;
    await ensureDevnetFunding(connection, authorityPubkey, estimatedRequired);

    const bufferKeypairPath = join(recoveryDir, 'buffer-keypair.json');
    runCmd('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '--outfile', bufferKeypairPath]);
    chmodSync(bufferKeypairPath, 0o600);
    bufferPubkey = loadKeypair(bufferKeypairPath).publicKey.toBase58();
    writeFileSync(
      join(recoveryDir, 'buffer-info.json'),
      JSON.stringify({ bufferPubkey, programId, authorityPubkey, rpcUrl }, null, 2) + '\n',
    );

    try {
      runCmd('solana', [
        'program',
        'deploy',
        built.soPath,
        '--program-id',
        programKeypairPath,
        '--buffer',
        bufferKeypairPath,
        '--keypair',
        authorityKeypairPath,
        '--url',
        rpcUrl,
        '--commitment',
        'confirmed',
      ]);
    } catch (deployErr) {
      console.error(`Despliegue fallido. Directorio de recuperacion preservado en: ${recoveryDir}`);
      console.error(`Para recuperar SOL del buffer, ejecuta:\nsolana program close ${bufferPubkey} --authority ${authorityKeypairPath} --recipient ${authorityPubkey} --url ${rpcUrl}`);
      throw deployErr;
    }

    stageIdlImport({
      repoRoot: REPO_ROOT,
      idlPath: savedIdlPath,
      programId,
      backupDir: join(recoveryDir, 'pre-import-backup'),
    });

    rmSync(bufferKeypairPath, { force: true });
    console.log(JSON.stringify({
      status: 'deploy-ready',
      programId,
      authorityPubkey,
      soSha256: built.soSha256,
      idlSha256: built.idlSha256,
      recoveryDir,
    }, null, 2));
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
