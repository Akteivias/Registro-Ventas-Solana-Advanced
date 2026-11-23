import '../src/polyfills';
import assert from 'node:assert/strict';
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction, PublicKey } from '@solana/web3.js';
import { address, createNoopSigner } from '@solana/kit';
import {
  getCrearRegistroInstruction,
  getCrearClienteInstruction,
  getRegistrarVentaInstruction,
  getCambiarMontoInstruction,
  getHacerDevolucionInstruction,
  getEliminarClienteInstruction,
  getRegistroDecoder,
  getClienteDecoder,
  getVentaDecoder,
  REGISTRO_PROGRAM_ADDRESS,
} from '../clients/js/src/generated';
import { pdaRegistro, pdaCliente, pdaVenta } from '../src/solana/pdas';
import { aWeb3 } from '../src/solana/tx';
import { DEVNET_GENESIS } from '../src/solana/seguridad';
import { expectProgramRejection } from './helpers/rechazo';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function parseLocalRpcUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`LOCAL_RPC_URL debe usar http o https: ${rawUrl}`);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error(`LOCAL_RPC_URL debe apuntar a loopback local, recibido: ${parsed.hostname}`);
  }
  return parsed.toString();
}

const rpcUrl = parseLocalRpcUrl(process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:18899');
const c = new Connection(rpcUrl, 'confirmed');
const genesis = await c.getGenesisHash();
assert.notEqual(genesis, DEVNET_GENESIS, 'dia5-local.ts no debe ejecutarse contra Devnet.');
assert.notEqual(genesis, MAINNET_GENESIS, 'dia5-local.ts no debe ejecutarse contra Mainnet.');
const programInfo = await c.getAccountInfo(new PublicKey(REGISTRO_PROGRAM_ADDRESS), 'confirmed');
assert.equal(programInfo?.executable, true, `Programa ${REGISTRO_PROGRAM_ADDRESS} no esta desplegado/ejecutable en ${rpcUrl}`);

const owner = Keypair.generate(), other = Keypair.generate();
for (const k of [owner, other]) {
  const sig = await c.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL);
  const b = await c.getLatestBlockhash();
  await c.confirmTransaction({ signature: sig, ...b }, 'confirmed');
}
const signer = createNoopSigner(address(owner.publicKey.toBase58()));
const otherSigner = createNoopSigner(address(other.publicKey.toBase58()));
const registro = pdaRegistro('Prueba Dia 5', signer.address);
const ana = pdaCliente(registro, 1);
const luis = pdaCliente(registro, 2);
const marta = pdaCliente(registro, 3);
const venta = pdaVenta(ana, 'CAF01');

const send = async (ix: any, key = owner) => {
  const bh = await c.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: key.publicKey, ...bh }).add(aWeb3(ix));
  tx.sign(key);
  const sig = await c.sendRawTransaction(tx.serialize());
  const res = await c.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
};
const read = async (a: string) => c.getAccountInfo(new PublicKey(a), 'confirmed');
const snapshotAccount = (info: Awaited<ReturnType<typeof read>>) =>
  info
    ? {
        owner: info.owner.toBase58(),
        executable: info.executable,
        lamports: info.lamports,
        data: Buffer.from(info.data),
      }
    : null;
const reg = async () => getRegistroDecoder().decode((await read(registro))!.data);
const cli = async (a: string) => getClienteDecoder().decode((await read(a))!.data);
const sale = async (a: string) => getVentaDecoder().decode((await read(a))!.data);
const reject = (ix: any, code: RegExp, key = owner) =>
  expectProgramRejection(() => send(ix, key), code, (err: any) => err?.getLogs?.(c));

const sigs: string[] = [];
sigs.push(await send(getCrearRegistroInstruction({ owner: signer, registro, nombreNegocio: 'Prueba Dia 5' })));
for (const [cliente, nombre] of [[ana, 'Ana'], [luis, 'Luis']] as const) {
  sigs.push(await send(getCrearClienteInstruction({ owner: signer, registro, cliente, nombre })));
}
sigs.push(await send(getRegistrarVentaInstruction({ owner: signer, registro, cliente: ana, venta, idCliente: 1, sku: 'CAF01', descripcion: 'Cafe', monto: 50 })));

const before = (await Promise.all([registro, ana, luis, venta].map(read))).map(snapshotAccount);
await reject(getEliminarClienteInstruction({ owner: otherSigner, registro, cliente: ana, idCliente: 1 }), /NoOwner|0x1770/i, other);
await reject(getEliminarClienteInstruction({ owner: signer, registro, cliente: luis, idCliente: 1 }), /ConstraintSeeds|0x7d6/i);
await reject(getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 }), /ClienteConVentas|0x1773/i);
const after = (await Promise.all([registro, ana, luis, venta].map(read))).map(snapshotAccount);
assert.deepEqual(after, before);

sigs.push(await send(getHacerDevolucionInstruction({ owner: signer, registro, cliente: ana, venta, idCliente: 1, sku: 'CAF01' })));
assert.equal((await cli(ana)).compras, 0);
assert.equal((await cli(ana)).historial.length, 0);
sigs.push(await send(getEliminarClienteInstruction({ owner: signer, registro, cliente: ana, idCliente: 1 })));
assert.equal(await read(ana), null);
assert.deepEqual((await reg()).clientes, [luis]);
assert.equal((await reg()).idCounter, 2);
assert.equal((await cli(luis)).nombre, 'Luis');

sigs.push(await send(getCrearClienteInstruction({ owner: signer, registro, cliente: marta, nombre: 'Marta' })));
assert.equal((await cli(marta)).idCliente, 3);
assert.equal((await reg()).idCounter, 3);

// --- Validacion de monto > 0 (aporte funcional) con SKUs distintos ---
const ventaZero = pdaVenta(luis, 'ZER01');
const beforeZeroSale = (await Promise.all([registro, luis].map(read))).map(snapshotAccount);
await reject(
  getRegistrarVentaInstruction({ owner: signer, registro, cliente: luis, venta: ventaZero, idCliente: 2, sku: 'ZER01', descripcion: 'Invalida', monto: 0 }),
  /MontoInvalido|0x1774/i,
);
assert.equal(await read(ventaZero), null);
const afterZeroSale = (await Promise.all([registro, luis].map(read))).map(snapshotAccount);
assert.deepEqual(afterZeroSale, beforeZeroSale);

const ventaPos = pdaVenta(luis, 'POS01');
sigs.push(await send(getRegistrarVentaInstruction({ owner: signer, registro, cliente: luis, venta: ventaPos, idCliente: 2, sku: 'POS01', descripcion: 'Valida', monto: 1 })));
assert.equal((await sale(ventaPos)).monto, 1);
assert.equal((await cli(luis)).compras, 1);

const beforeZeroUpdate = (await Promise.all([registro, luis, ventaPos].map(read))).map(snapshotAccount);
await reject(
  getCambiarMontoInstruction({ owner: signer, registro, cliente: luis, venta: ventaPos, idCliente: 2, sku: 'POS01', nuevoMonto: 0 }),
  /MontoInvalido|0x1774/i,
);
const afterZeroUpdate = (await Promise.all([registro, luis, ventaPos].map(read))).map(snapshotAccount);
assert.deepEqual(afterZeroUpdate, beforeZeroUpdate);
assert.equal((await sale(ventaPos)).monto, 1);

sigs.push(await send(getCambiarMontoInstruction({ owner: signer, registro, cliente: luis, venta: ventaPos, idCliente: 2, sku: 'POS01', nuevoMonto: 55 })));
assert.equal((await sale(ventaPos)).monto, 55);
assert.equal((await cli(luis)).compras, 1);

sigs.push(await send(getHacerDevolucionInstruction({ owner: signer, registro, cliente: luis, venta: ventaPos, idCliente: 2, sku: 'POS01' })));
assert.equal((await cli(luis)).compras, 0);
assert.equal(await read(ventaPos), null);
console.log('Local validator verification passed. Signatures:', sigs.length);
