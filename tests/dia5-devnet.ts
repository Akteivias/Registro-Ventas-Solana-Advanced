import '../src/polyfills';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SendTransactionError,
  Transaction,
} from '@solana/web3.js';
import { address, createNoopSigner, getBase58Decoder } from '@solana/kit';
import {
  REGISTRO_PROGRAM_ADDRESS,
  getClienteDecoder,
  getCrearClienteInstruction,
  getCrearRegistroInstruction,
  getEliminarClienteInstruction,
  getHacerDevolucionInstruction,
  getRegistrarVentaInstruction,
  getRegistroDecoder,
} from '../clients/js/src/generated';
import { pdaCliente, pdaRegistro, pdaVenta } from '../src/solana/pdas';
import { comprobarPrograma } from '../src/solana/seguridad';
import {
  ErrorConfirmacionPendiente,
  aWeb3,
  confirmarEnvio,
  enlaceTransaccion,
  traducir,
  type InstruccionKit,
} from '../src/solana/tx';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_AUTHORITY_KEYPAIR = '~/.config/solana/registro-devnet-tester-keypair.json';
const MIN_BALANCE_LAMPORTS = Math.round(0.03 * LAMPORTS_PER_SOL); // 30_000_000 lamports (0.03 SOL)

type AccountSnapshot = {
  address: string;
  exists: boolean;
  owner: string | null;
  executable: boolean | null;
  lamports: number | null;
  dataHex: string | null;
};

function expandHome(inputPath: string): string {
  if (inputPath === '~') return homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith(`~${sep}`)) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function resolveWithExistingAncestor(targetPath: string): string {
  const abs = resolve(targetPath);
  const trailing: string[] = [];
  let cursor = abs;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    trailing.unshift(cursor.slice(parent.length === 1 ? 1 : parent.length + 1));
    cursor = parent;
  }
  const realBase = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return trailing.length > 0 ? join(realBase, ...trailing) : realBase;
}

export function assertExternalPath(rawPath: string, repoRoot: string): string {
  const expanded = expandHome(rawPath.trim());
  const realRepoRoot = realpathSync(repoRoot);
  const realTarget = resolveWithExistingAncestor(expanded);
  const rel = relative(realRepoRoot, realTarget);
  if (rel === '' || isAbsolute(rel) || (!rel.startsWith(`..${sep}`) && rel !== '..')) {
    throw new Error(`Keypair path must be outside the repository: ${rawPath}`);
  }
  return realTarget;
}

function loadExternalKeypair(rawPath: string, repoRoot: string): { keypair: Keypair; resolvedPath: string } {
  const resolvedPath = assertExternalPath(rawPath, repoRoot);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Authority keypair file not found at external path: ${resolvedPath}`);
  }
  const rawJson = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  if (!Array.isArray(rawJson) || rawJson.length !== 64) {
    throw new Error(`Invalid keypair JSON format at: ${resolvedPath}`);
  }
  return {
    keypair: Keypair.fromSecretKey(Uint8Array.from(rawJson)),
    resolvedPath,
  };
}

async function snapshotAccount(connection: Connection, pubkeyStr: string): Promise<AccountSnapshot> {
  const info = await connection.getAccountInfo(new PublicKey(pubkeyStr), 'confirmed');
  if (!info) {
    return {
      address: pubkeyStr,
      exists: false,
      owner: null,
      executable: null,
      lamports: null,
      dataHex: null,
    };
  }
  return {
    address: pubkeyStr,
    exists: true,
    owner: info.owner.toBase58(),
    executable: info.executable,
    lamports: info.lamports,
    dataHex: Buffer.from(info.data).toString('hex'),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function confirmAirdropViaStatus(connection: Connection, sig: string): Promise<void> {
  for (let i = 1; i <= 20; i++) {
    const res = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const status = res.value[0];
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
      if (status.err !== null) {
        throw new Error(`Airdrop ${sig} failed (${status.confirmationStatus}): ${JSON.stringify(status.err)}`);
      }
      return;
    }
    await sleep(1000);
  }
  throw new Error(`Airdrop ${sig} did not reach confirmed/finalized status within 20s.`);
}

async function ensureAuthorityBalance(connection: Connection, authorityPubkey: PublicKey): Promise<number> {
  const [rentRegistro, rentCliente, rentVenta] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(400),
    connection.getMinimumBalanceForRentExemption(370),
    connection.getMinimumBalanceForRentExemption(75),
  ]);
  const estimatedRent = rentRegistro + 2 * rentCliente + rentVenta;
  let balance = await connection.getBalance(authorityPubkey, 'confirmed');

  console.log(
    `Rent breakdown (lamports): Registro(400B)=${rentRegistro}, 2xCliente(370B)=${2 * rentCliente}, Venta(75B)=${rentVenta}, TotalRent=${estimatedRent}, RequiredWithFeeHeadroom=${MIN_BALANCE_LAMPORTS}`,
  );
  console.log(`Initial Devnet balance for ${authorityPubkey.toBase58()}: ${balance} lamports (${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);

  for (let attempt = 1; attempt <= 2 && balance < MIN_BALANCE_LAMPORTS; attempt++) {
    console.log(`Balance below 0.03 SOL; attempting bounded requestAirdrop (${attempt}/2)...`);
    try {
      const sig = await connection.requestAirdrop(authorityPubkey, LAMPORTS_PER_SOL);
      await confirmAirdropViaStatus(connection, sig);
      balance = await connection.getBalance(authorityPubkey, 'confirmed');
      console.log(`Airdrop ${attempt} confirmed (${sig}). New balance: ${balance} lamports.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Airdrop attempt ${attempt} failed: ${msg}`);
      balance = await connection.getBalance(authorityPubkey, 'confirmed');
    }
  }

  if (balance < MIN_BALANCE_LAMPORTS) {
    const shortfall = MIN_BALANCE_LAMPORTS - balance;
    throw new Error(
      `Insufficient Devnet balance for ${authorityPubkey.toBase58()}: have ${balance} lamports, need >= ${MIN_BALANCE_LAMPORTS} lamports (shortfall ${shortfall} lamports). ` +
        `Bounded requestAirdrop failed; fund this public address manually on Devnet (or assess devnet-pow 0.1.4 get-all-faucets, runtime/available funding unverified) and re-run.`,
    );
  }
  return balance;
}

async function sendAndConfirmWithReconciliation(
  connection: Connection,
  authority: Keypair,
  ix: InstruccionKit,
  label: string,
  inspectAccounts: string[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: authority.publicKey, blockhash, lastValidBlockHeight });
  tx.add(aWeb3(ix));
  tx.sign(authority);

  const sigBytes = tx.signatures[0]?.signature;
  if (!sigBytes) {
    throw new Error(`[${label}] Missing signature bytes after tx.sign(authority).`);
  }
  const precomputedSig = getBase58Decoder().decode(sigBytes);

  try {
    const raw = tx.serialize();
    const sentSig = await connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed' });
    assert.equal(sentSig, precomputedSig, `[${label}] RPC returned signature mismatch`);
    return await confirmarEnvio(connection, {
      signature: precomputedSig,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      throw err;
    }

    const isAmbiguous = err instanceof ErrorConfirmacionPendiente || !(err instanceof SendTransactionError);
    if (!isAmbiguous) throw err;

    const [statusesRes, currentBlockHeight, accountStates] = await Promise.all([
      connection.getSignatureStatuses([precomputedSig], { searchTransactionHistory: true }),
      connection.getBlockHeight('confirmed'),
      Promise.all(inspectAccounts.map((addr) => snapshotAccount(connection, addr))),
    ]);

    const status = statusesRes.value[0];
    const isConfirmedOrFinalized =
      status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized';
    if (status !== null && isConfirmedOrFinalized) {
      if (status.err === null) {
        console.log(`[${label}] Reconciled ambiguous outcome via getSignatureStatuses: confirmed (${status.confirmationStatus}) ${precomputedSig}`);
        return precomputedSig;
      }
      throw new Error(
        `[${label}] Reconciled landed failure (${status.confirmationStatus}) for ${precomputedSig} (${enlaceTransaccion(precomputedSig)}): ${JSON.stringify(status.err)}`,
      );
    }

    throw new Error(
      `[${label}] Unresolved transaction outcome (status=${JSON.stringify(status)}, blockHeight=${currentBlockHeight}, lastValidBlockHeight=${lastValidBlockHeight}). ` +
        `sig=${precomputedSig} explorer=${enlaceTransaccion(precomputedSig)} accounts=${JSON.stringify(accountStates)}`,
    );
  }
}

async function waitForReturnedAna(
  connection: Connection,
  anaAddr: string,
  ventaAddr: string,
): Promise<void> {
  for (let i = 1; i <= 12; i++) {
    const [anaInfo, ventaInfo] = await Promise.all([
      connection.getAccountInfo(new PublicKey(anaAddr), 'confirmed'),
      connection.getAccountInfo(new PublicKey(ventaAddr), 'confirmed'),
    ]);
    if (anaInfo && ventaInfo === null) {
      const anaDecoded = getClienteDecoder().decode(anaInfo.data);
      if (anaDecoded.compras === 0 && anaDecoded.historial.length === 0) {
        return;
      }
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for hacer_devolucion state (ana.compras === 0 && ana.historial.length === 0 && venta === null).');
}

async function fetchTransactionWithRetry(connection: Connection, sig: string) {
  for (let i = 1; i <= 10; i++) {
    const tx = await connection.getTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;
    await sleep(1000);
  }
  throw new Error(`getTransaction returned null after retries for ${sig}`);
}

async function esperarContinuar(etapa: string): Promise<void> {
  console.log(`[checkpoint:${etapa}] Pulsa Enter para continuar...`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let resolved = false;
  return new Promise<void>((resolveWait, rejectWait) => {
    const cleanup = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      rl.close();
    };
    const fail = (reason: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      rejectWait(new Error(`Ejecución pausada cancelada en ${etapa} (${reason})`));
    };
    const onSignal = () => fail('interrupción');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    rl.once('close', () => fail('EOF'));
    rl.once('line', () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolveWait();
    });
  });
}

function registrarFirma(sigs: Record<string, string>, paso: string, sig: string): void {
  sigs[paso] = sig;
  console.log(`  [sig:${paso}] ${sig} | ${enlaceTransaccion(sig)}`);
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(__dirname, '..');
  const pausar = process.argv.includes('--pausar');
  const rpcUrl = process.env.DEVNET_RPC_URL || DEFAULT_RPC_URL;
  const keypairPath = process.env.DEVNET_AUTHORITY_KEYPAIR || DEFAULT_AUTHORITY_KEYPAIR;

  const { keypair: authority, resolvedPath } = loadExternalKeypair(keypairPath, repoRoot);
  const authorityPubkey = authority.publicKey.toBase58();
  const expectedAuthority = process.env.DEVNET_EXPECTED_AUTHORITY?.trim();
  if (expectedAuthority && authorityPubkey !== expectedAuthority) {
    throw new Error(
      `Autoridad inesperada: se obtuvo ${authorityPubkey} (${resolvedPath}), pero DEVNET_EXPECTED_AUTHORITY=${expectedAuthority}`,
    );
  }

  const connection = new Connection(rpcUrl, 'confirmed');

  console.log(`Program ID: ${REGISTRO_PROGRAM_ADDRESS}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Authority pubkey: ${authorityPubkey} (keypair: ${resolvedPath})`);

  await comprobarPrograma(connection);
  await ensureAuthorityBalance(connection, authority.publicKey);

  const signer = createNoopSigner(address(authorityPubkey));
  const nombreNegocio = `DevnetD5-${Date.now().toString(36).slice(-6)}`;
  assert.ok(Buffer.byteLength(nombreNegocio, 'utf8') <= 30, 'nombreNegocio exceeds 30 bytes');

  const registro = pdaRegistro(nombreNegocio, signer.address);
  const ana = pdaCliente(registro, 1);
  const luis = pdaCliente(registro, 2);
  const venta = pdaVenta(ana, 'CAF01');
  const tracked = [registro, ana, luis, venta];

  console.log(`Business: ${nombreNegocio}`);
  console.log(`PDAs: registro=${registro}, ana=${ana}, luis=${luis}, venta=${venta}`);

  const sigs: Record<string, string> = {};
  try {
    registrarFirma(
      sigs,
      'crearRegistro',
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
        getCrearRegistroInstruction({ owner: signer, registro, nombreNegocio }),
        'crear_registro',
        tracked,
      ),
    );
    registrarFirma(
      sigs,
      'crearAna',
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
        getCrearClienteInstruction({ owner: signer, registro, cliente: ana, nombre: 'Ana' }),
        'crear_cliente(Ana)',
        tracked,
      ),
    );
    registrarFirma(
      sigs,
      'crearLuis',
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
        getCrearClienteInstruction({ owner: signer, registro, cliente: luis, nombre: 'Luis' }),
        'crear_cliente(Luis)',
        tracked,
      ),
    );
    registrarFirma(
      sigs,
      'registrarVenta',
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
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
        'registrar_venta(CAF01)',
        tracked,
      ),
    );

    if (pausar) await esperarContinuar('previo-a-rechazo');

    // Full snapshots before expected preflight rejection
    const beforeSnapshots = await Promise.all(tracked.map((addr) => snapshotAccount(connection, addr)));
    const balanceBeforeReject = await connection.getBalance(authority.publicKey, 'confirmed');

    let rejectedErr: unknown = null;
    try {
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
        getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 }),
        'eliminar_cliente(1)-expected-reject',
        tracked,
      );
      assert.fail('Expected eliminar_cliente(1) with active sale to be rejected');
    } catch (err) {
      rejectedErr = err;
    }

    assert.ok(rejectedErr instanceof SendTransactionError, 'Expected SendTransactionError on preflight rejection');
    const rejectLogs = rejectedErr.logs ?? (await rejectedErr.getLogs?.(connection)) ?? [];
    assert.match(
      rejectLogs.join('\n'),
      /Program .* failed: custom program error: 0x1773|Error Code: ClienteConVentas\. Error Number: 6003/i,
      'Expected structured ClienteConVentas (0x1773 / 6003) error in preflight logs',
    );
    console.log('Preflight rejection verified (ClienteConVentas 0x1773/6003):', traducir(rejectedErr));

    const afterRejectSnapshots = await Promise.all(tracked.map((addr) => snapshotAccount(connection, addr)));
    const balanceAfterReject = await connection.getBalance(authority.publicKey, 'confirmed');
    assert.deepEqual(afterRejectSnapshots, beforeSnapshots, 'Account snapshots must be unchanged after preflight rejection');
    assert.equal(balanceAfterReject, balanceBeforeReject, 'Authority balance must be unchanged after preflight rejection');

    if (pausar) await esperarContinuar('post-rechazo');

    // Return sale and poll for state
    registrarFirma(
      sigs,
      'hacerDevolucion',
      await sendAndConfirmWithReconciliation(
        connection,
        authority,
        getHacerDevolucionInstruction({
          owner: signer,
          registro,
          cliente: ana,
          venta,
          idCliente: 1,
          sku: 'CAF01',
        }),
        'hacer_devolucion(CAF01)',
        tracked,
      ),
    );
    await waitForReturnedAna(connection, ana, venta);

    const luisBeforeDelete = await snapshotAccount(connection, luis);
    const anaBeforeDelete = await snapshotAccount(connection, ana);
    const balanceBeforeDelete = await connection.getBalance(authority.publicKey, 'confirmed');
    assert.ok(anaBeforeDelete.exists && anaBeforeDelete.lamports !== null, 'ana must exist before eliminar_cliente');

    const delSig = await sendAndConfirmWithReconciliation(
      connection,
      authority,
      getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 }),
      'eliminar_cliente(1)',
      tracked,
    );
    registrarFirma(sigs, 'eliminarCliente', delSig);

    const delTx = await fetchTransactionWithRetry(connection, delSig);
    const delFee = delTx.meta?.fee ?? null;
    assert.ok(delFee !== null, 'Expected meta.fee on confirmed eliminar_cliente transaction');

    const anaAfterDeleteInfo = await connection.getAccountInfo(new PublicKey(ana), 'confirmed');
    assert.equal(anaAfterDeleteInfo, null, 'Expected ana account to be closed (null)');

    const regAfterInfo = await connection.getAccountInfo(new PublicKey(registro), 'confirmed');
    assert.ok(regAfterInfo, 'Expected registro account to exist');
    const regDecoded = getRegistroDecoder().decode(regAfterInfo.data);
    assert.deepEqual(regDecoded.clientes, [luis], 'Expected registro.clientes == [luis]');
    assert.equal(regDecoded.idCounter, 2, 'Expected registro.idCounter == 2');

    const luisAfterDelete = await snapshotAccount(connection, luis);
    assert.deepEqual(luisAfterDelete, luisBeforeDelete, 'Expected luis account snapshot to remain unchanged');

    const balanceAfterDelete = await connection.getBalance(authority.publicKey, 'confirmed');
    const rentRefunded = anaBeforeDelete.lamports!;
    const netDelta = balanceAfterDelete - balanceBeforeDelete;
    assert.equal(netDelta, rentRefunded - delFee, 'Expected authority net balance delta == ana rent refund - tx fee');

    console.log('\n=== Devnet Day 5 Verification Summary ===');
    console.log(`Ana rent refunded: ${rentRefunded} lamports`);
    console.log(`eliminar_cliente tx fee: ${delFee} lamports`);
    console.log(`Authority balance before->after delete: ${balanceBeforeDelete} -> ${balanceAfterDelete} (net +${netDelta} lamports)`);
    for (const [step, sig] of Object.entries(sigs)) {
      console.log(`  ${step}: ${sig} | ${enlaceTransaccion(sig)}`);
    }
  } catch (err) {
    console.error('\n=== Partial Devnet State Before Failure/Interruption ===');
    console.error(`Business: ${nombreNegocio}`);
    console.error(`PDAs: registro=${registro}, ana=${ana}, luis=${luis}, venta=${venta}`);
    console.error('Recorded signatures (confirmed on Devnet, not rolled back):', sigs);
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Devnet Day 5 verification failed:', err);
    process.exit(1);
  });
}
