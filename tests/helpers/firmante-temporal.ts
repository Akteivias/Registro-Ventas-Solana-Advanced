import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { address, createNoopSigner, getBase58Decoder } from '@solana/kit';
import {
  getCambiarMontoInstruction,
  getCrearClienteInstruction,
  getCrearRegistroInstruction,
  getRegistrarVentaInstruction,
  getVentaDecoder,
  REGISTRO_PROGRAM_ADDRESS,
} from '../../clients/js/src/generated';
import { pdaCliente, pdaRegistro, pdaVenta } from '../../src/solana/pdas';
import { aWeb3 } from '../../src/solana/tx';

export type RegistroFirmaPendiente = {
  sig: string;
  blockhash: string;
};

export type EstadoFirmantePersistido = {
  biz: string;
  stage: number;
  signedByStage: Record<string, RegistroFirmaPendiente>;
};

export type RpcFirmante = {
  isBlockhashValid: (blockhash: string, commitment: 'confirmed') => Promise<{ value: boolean }>;
  getAccountInfo: (pubkey: PublicKey, commitment: 'confirmed') => Promise<{ data: Uint8Array } | null>;
  getSignatureStatuses: (
    sigs: string[],
    opts: { searchTransactionHistory: true },
  ) => Promise<{
    value: Array<{ err: unknown; confirmationStatus?: string | null } | null>;
  }>;
};

export type ResultadoSolicitudFirma =
  | { status: 200; bytes: number[]; sig: string; stage: number }
  | { status: 400 | 409; error: string };

export type ModoFirmante = 'nuevo' | 'reanudar';

function cargarEstadoInicial(
  statePath: string | undefined,
  biz: string,
  modo: ModoFirmante,
): EstadoFirmantePersistido {
  if (modo === 'reanudar') {
    if (!statePath || !existsSync(statePath)) {
      throw new Error(
        `Missing state file for resume (${biz}): reconcile prior signatures and account state before restarting`,
      );
    }
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as EstadoFirmantePersistido;
    if (parsed.biz !== biz || typeof parsed.stage !== 'number' || typeof parsed.signedByStage !== 'object' || !parsed.signedByStage) {
      throw new Error(`Invalid state file for resume: belongs to ${parsed?.biz}, expected ${biz}`);
    }
    return {
      biz: parsed.biz,
      stage: parsed.stage,
      signedByStage: parsed.signedByStage,
    };
  }

  if (statePath && existsSync(statePath)) {
    throw new Error(`State file already exists for new business ${biz}; use modo="reanudar" to resume`);
  }
  return { biz, stage: 0, signedByStage: {} };
}

function guardarEstado(statePath: string | undefined, estado: EstadoFirmantePersistido): void {
  if (!statePath) return;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(estado, null, 2), 'utf8');
}

function estadoCuentaConfirmado(
  stage: number,
  info: { data: Uint8Array } | null,
): boolean {
  if (stage <= 2) return info !== null;
  if (!info) return false;
  return getVentaDecoder().decode(info.data).monto === 55;
}

export function crearManejadorFirmante(opts: {
  connection: RpcFirmante;
  keypair: Keypair;
  biz: string;
  statePath?: string;
  modo?: ModoFirmante;
}) {
  const { connection, keypair, biz, statePath, modo = 'nuevo' } = opts;
  const owner = createNoopSigner(address(keypair.publicKey.toBase58()));
  const registro = pdaRegistro(biz, owner.address);
  const ana = pdaCliente(registro, 1);
  const venta = pdaVenta(ana, 'CAF01');
  const estado = cargarEstadoInicial(statePath, biz, modo);
  let inFlight = false;

  const pdaPorEtapa = (stage: number): string => {
    if (stage === 0) return registro;
    if (stage === 1) return ana;
    return venta;
  };

  const instruccionEsperada = (stage: number) => {
    if (stage === 0) return getCrearRegistroInstruction({ owner, registro, nombreNegocio: biz });
    if (stage === 1) return getCrearClienteInstruction({ owner, registro, cliente: ana, nombre: 'Ana' });
    if (stage === 2) {
      return getRegistrarVentaInstruction({
        owner,
        registro,
        cliente: ana,
        venta,
        idCliente: 1,
        sku: 'CAF01',
        descripcion: 'Cafe americano',
        monto: 50,
      });
    }
    return getCambiarMontoInstruction({
      owner,
      registro,
      cliente: ana,
      venta,
      idCliente: 1,
      sku: 'CAF01',
      nuevoMonto: 55,
    });
  };

  return {
    pdas: { registro, ana, venta },
    getEstado: () => ({
      biz: estado.biz,
      stage: estado.stage,
      signedByStage: { ...estado.signedByStage },
    }),
    async verificarInicio(): Promise<void> {
      const regInfo = await connection.getAccountInfo(new PublicKey(registro), 'confirmed');
      if (modo === 'nuevo' && regInfo !== null) {
        throw new Error(
          `registro ${registro} already exists for new business ${biz}; reconcile prior signatures and resume with modo="reanudar"`,
        );
      }
    },
    async procesar(rawBytes: number[]): Promise<ResultadoSolicitudFirma> {
      if (inFlight) {
        return { status: 409, error: 'concurrent signing request rejected while previous request is in flight' };
      }
      inFlight = true;
      try {
        const tx = Transaction.from(Buffer.from(rawBytes));
        if (
          !tx.recentBlockhash ||
          (await connection.isBlockhashValid(tx.recentBlockhash, 'confirmed')).value !== true
        ) {
          return { status: 400, error: 'stale blockhash' };
        }

        if (estado.stage >= 4) {
          return { status: 409, error: 'all stages complete' };
        }

        const prev = estado.signedByStage[String(estado.stage)];
        if (prev) {
          const stRes = await connection.getSignatureStatuses([prev.sig], {
            searchTransactionHistory: true,
          });
          const st = stRes.value[0];
          if (st === null) {
            return {
              status: 409,
              error: `unresolved signature ${prev.sig} for stage ${estado.stage}; reconcile status and account state before retrying`,
            };
          }
          const landed = st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized';
          if (st.err === null) {
            if (!landed) {
              return {
                status: 409,
                error: `pending signature ${prev.sig} (${st.confirmationStatus ?? 'processed'}) for stage ${estado.stage}`,
              };
            }
            const accInfo = await connection.getAccountInfo(new PublicKey(pdaPorEtapa(estado.stage)), 'confirmed');
            if (!estadoCuentaConfirmado(estado.stage, accInfo)) {
              return {
                status: 409,
                error: `signature ${prev.sig} confirmed but expected account state for stage ${estado.stage} is missing`,
              };
            }
            estado.stage += 1;
            guardarEstado(statePath, estado);
            if (estado.stage >= 4) {
              return { status: 409, error: 'all stages complete' };
            }
          } else {
            if (!landed) {
              return {
                status: 409,
                error: `unconfirmed failed signature ${prev.sig} for stage ${estado.stage}`,
              };
            }
            const accInfo = await connection.getAccountInfo(new PublicKey(pdaPorEtapa(estado.stage)), 'confirmed');
            if (estadoCuentaConfirmado(estado.stage, accInfo)) {
              return {
                status: 409,
                error: `stage ${estado.stage} account state unexpectedly changed despite failed signature ${prev.sig}`,
              };
            }
            delete estado.signedByStage[String(estado.stage)];
            guardarEstado(statePath, estado);
          }
        }

        const expected = new Transaction({
          feePayer: keypair.publicKey,
          recentBlockhash: tx.recentBlockhash,
        }).add(aWeb3(instruccionEsperada(estado.stage)));

        if (!tx.serializeMessage().equals(expected.serializeMessage())) {
          return { status: 400, error: `unexpected message for stage ${estado.stage}` };
        }

        tx.partialSign(keypair);
        if (!tx.signature) {
          return { status: 400, error: 'missing signature' };
        }
        const sigB58 = getBase58Decoder().decode(tx.signature);
        estado.signedByStage[String(estado.stage)] = {
          sig: sigB58,
          blockhash: tx.recentBlockhash,
        };
        guardarEstado(statePath, estado);

        return {
          status: 200,
          bytes: Array.from(tx.serialize()),
          sig: sigB58,
          stage: estado.stage,
        };
      } finally {
        inFlight = false;
      }
    },
  };
}

export { REGISTRO_PROGRAM_ADDRESS };
