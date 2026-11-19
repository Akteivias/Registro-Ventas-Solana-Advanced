import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { REFERENCIA_ID } from '../scripts/contrato-idl.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'tests/fixtures/idl-base-5ix.json');
const idlBase = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  address?: string;
  metadata?: { address?: string };
  instructions: { name: string }[];
};

assert.equal(idlBase.instructions.length, 5, 'El fixture base debe tener exactamente 5 instrucciones.');
assert.equal(
  idlBase.instructions.some((item) => item.name.toLowerCase().replace(/_/g, '') === 'eliminarcliente'),
  false,
  'El fixture base no debe incluir eliminar_cliente.',
);
assert.equal(
  idlBase.address ?? idlBase.metadata?.address,
  REFERENCIA_ID,
  'El fixture base debe apuntar al Program ID de referencia.',
);

function ejecutar(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8' });
}

function probarEliminarClienteEnSubproceso(cwd: string, esperado: RegExp) {
  const codigo = `
import { registerHooks } from 'node:module';
registerHooks({
  load(url, context, nextLoad) {
    const res = nextLoad(url, context);
    if (url.endsWith('/src/solana/conexion.ts') && res.source) {
      return {
        ...res,
        source: String(res.source).replaceAll('import.meta.env.', 'import.meta.env?.'),
      };
    }
    return res;
  },
});
const assert = (await import('node:assert/strict')).default;
const { PublicKey } = await import('@solana/web3.js');
const { eliminarCliente } = await import('./src/solana/acciones');

const wallet = {
  publicKey: new PublicKey(new Uint8Array(32).fill(7)),
  sendTransaction: async () => {
    throw new Error('sendTransaction no debe ejecutarse');
  },
};

await assert.rejects(
  eliminarCliente(wallet, {} as never, 'Cafe', 1),
  new RegExp(${JSON.stringify(esperado.source)}),
);
`;
  const res = ejecutar(process.execPath, ['--import', 'tsx', '-e', codigo], cwd);
  assert.equal(
    res.status,
    0,
    `Subproceso fallo (${esperado}):\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`,
  );
}

const tempProj = mkdtempSync(join(tmpdir(), 'dia5-five-ix-proj-'));

try {
  for (const archivo of [
    'package.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'index.html',
    'codama.json',
  ]) {
    cpSync(join(root, archivo), join(tempProj, archivo));
  }

  mkdirSync(join(tempProj, 'clients/js'), { recursive: true });
  cpSync(join(root, 'clients/js/package.json'), join(tempProj, 'clients/js/package.json'));
  cpSync(join(root, 'scripts'), join(tempProj, 'scripts'), { recursive: true });
  cpSync(join(root, 'src'), join(tempProj, 'src'), { recursive: true });
  mkdirSync(join(tempProj, 'tests'), { recursive: true });
  cpSync(join(root, 'tests/integracion-cliente.test.ts'), join(tempProj, 'tests/integracion-cliente.test.ts'));
  cpSync(join(root, 'tests/fixtures'), join(tempProj, 'tests/fixtures'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(tempProj, 'node_modules'), 'dir');

  // Condicion A: Modo referencia con 5 instrucciones (esReferencia: true).
  writeFileSync(
    join(tempProj, 'src/config/programa.json'),
    JSON.stringify(
      {
        programId: REFERENCIA_ID,
        esReferencia: true,
        origen: 'IDL de referencia de David. Escritura bloqueada.',
        idlSha256: '',
      },
      null,
      2,
    ) + '\n',
  );
  cpSync(fixturePath, join(tempProj, 'idl.json'));

  const genRef = ejecutar(process.execPath, ['scripts/generar-cliente.mjs'], tempProj);
  assert.equal(genRef.status, 0, `generar-cliente (Condicion A) fallo:\n${genRef.stdout}\n${genRef.stderr}`);

  const configRef = JSON.parse(readFileSync(join(tempProj, 'src/config/programa.json'), 'utf8')) as {
    esReferencia: boolean;
    programId: string;
  };
  assert.equal(configRef.esReferencia, true);
  assert.equal(configRef.programId, REFERENCIA_ID);
  assert.equal(existsSync(join(tempProj, 'clients/js/src/generated/instructions/eliminarCliente.ts')), false);

  probarEliminarClienteEnSubproceso(tempProj, /Importa el IDL de tu programa/);

  // Condicion B: Modo importado no-referencia con 5 instrucciones (esReferencia: false).
  const cfgImport = ejecutar(
    process.execPath,
    ['scripts/configurar-idl.mjs', './tests/fixtures/idl-base-5ix.json'],
    tempProj,
  );
  assert.equal(cfgImport.status, 0, `configurar-idl (Condicion B) fallo:\n${cfgImport.stdout}\n${cfgImport.stderr}`);

  const configImportado = JSON.parse(readFileSync(join(tempProj, 'src/config/programa.json'), 'utf8')) as {
    esReferencia: boolean;
    programId: string;
  };
  assert.equal(configImportado.esReferencia, false);
  assert.equal(configImportado.programId, REFERENCIA_ID);

  const regen = ejecutar(process.execPath, ['scripts/generar-cliente.mjs'], tempProj);
  assert.equal(regen.status, 0, `Re-ejecucion de generar-cliente fallo:\n${regen.stdout}\n${regen.stderr}`);
  const configTrasRegen = JSON.parse(readFileSync(join(tempProj, 'src/config/programa.json'), 'utf8')) as {
    esReferencia: boolean;
  };
  assert.equal(configTrasRegen.esReferencia, false);

  const idlAntesConflicto = readFileSync(join(tempProj, 'idl.json'), 'utf8');
  const otroProgramId = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
  const cfgConflicto = ejecutar(
    process.execPath,
    ['scripts/configurar-idl.mjs', './tests/fixtures/idl-base-5ix.json', '--program-id', otroProgramId],
    tempProj,
  );
  assert.notEqual(cfgConflicto.status, 0, 'configurar-idl con --program-id en conflicto debe fallar.');
  assert.match(cfgConflicto.stderr, /El --program-id y la direccion del IDL no coinciden/);
  assert.equal(readFileSync(join(tempProj, 'idl.json'), 'utf8'), idlAntesConflicto);

  probarEliminarClienteEnSubproceso(tempProj, /El cliente generado no incluye eliminar_cliente/);

  const verificar = ejecutar('npm', ['run', 'verificar'], tempProj);
  assert.equal(
    verificar.status,
    0,
    `npm run verificar en proyecto 5-ix fallo:\nSTDOUT:\n${verificar.stdout}\nSTDERR:\n${verificar.stderr}`,
  );

  console.log('Dual-IDL 5-instruction verification passed (Conditions A & B + npm run verificar).');
} finally {
  rmSync(tempProj, { recursive: true, force: true });
}
