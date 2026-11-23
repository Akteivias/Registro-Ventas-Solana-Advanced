/**
 * tests/dia5-browser-devnet.ts
 *
 * Opt-in Devnet browser walkthrough using the extension-free loopback signer
 * (tests/helpers/firmante-temporal.ts) and chrome-devtools-mcp@1.13.0 CLI.
 *
 * Requires:
 * - DEVNET_EXPECTED_AUTHORITY=<base58 pubkey>
 * - External keypair (~/.config/solana/registro-devnet-tester-keypair.json or DEVNET_AUTHORITY_KEYPAIR)
 * - >= 0.03 SOL on Devnet (creates Registro, Cliente, Venta accounts; spends tx fees + rent)
 *
 * Optional flags:
 * - `--grabar <path.mp4>` or `BROWSER_RECORD_PATH=<path.mp4>`
 * - `--explorer` (after closing the signing bridge, visits Solana Explorer on the recorded page)
 */

import '../src/polyfills';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import {
  getClienteDecoder,
  getRegistroDecoder,
  getVentaDecoder,
  REGISTRO_PROGRAM_ADDRESS,
} from '../clients/js/src/generated';
import { comprobarPrograma } from '../src/solana/seguridad';
import { enlaceTransaccion } from '../src/solana/tx';
import { assertExternalPath } from './dia5-devnet';
import { crearManejadorFirmante } from './helpers/firmante-temporal';

const APP_URL = 'http://127.0.0.1:5173/';
const REPO_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_AUTHORITY_KEYPAIR = '~/.config/solana/registro-devnet-tester-keypair.json';
const MIN_BALANCE_LAMPORTS = Math.round(0.03 * LAMPORTS_PER_SOL);
const CHROME_DEVTOOLS_MCP_PKG = 'chrome-devtools-mcp@1.13.0';
const MAX_UNIX_SOCKET_BYTES = 103;

export const HISTORICAL_ZERO_AMOUNT_FAILURES = [
  {
    label: 'Historical registrar_venta (monto=0, MontoInvalido 6004)',
    sig: '4W3Ra3Y1VDP7m15vbj4h7kRnVnCNoJXtQpLjhE2G4zv4GmboKQvv4NsURBV2Qs1MvjobBsjyoXNvH4VZGYgVU87H',
  },
  {
    label: 'Historical cambiar_monto (nuevo_monto=0, MontoInvalido 6004)',
    sig: '2FYFdWARtoSa85j7mHVzicCB9cBRKGxnSt53pHYV5kfyHs963fvFCnxiqoNkUoixuMrKSfEP67Nw8G5DUiPsFhf2',
  },
] as const;

export type BrowserDevnetOptions = {
  expectedAuthority: string;
  keypairPath: string;
  rpcUrl: string;
  recordPath?: string;
  explorer: boolean;
};

export function parseBrowserDevnetOptions(
  argv: string[],
  env: NodeJS.ProcessEnv,
): BrowserDevnetOptions {
  const expectedAuthority = env.DEVNET_EXPECTED_AUTHORITY?.trim();
  if (!expectedAuthority) {
    throw new Error(
      'DEVNET_EXPECTED_AUTHORITY es obligatorio para verificar:browser:devnet (evita usar una clave inesperada).',
    );
  }
  new PublicKey(expectedAuthority);

  let recordPath = env.BROWSER_RECORD_PATH?.trim() || undefined;
  const grabarIdx = argv.indexOf('--grabar');
  if (grabarIdx >= 0) {
    const val = argv[grabarIdx + 1];
    if (!val || val.startsWith('--')) {
      throw new Error('Falta la ruta .mp4 despues de --grabar.');
    }
    recordPath = val.trim();
  }
  if (recordPath && !recordPath.endsWith('.mp4')) {
    throw new Error(`La ruta de grabacion debe terminar en .mp4: ${recordPath}`);
  }

  return {
    expectedAuthority,
    keypairPath: env.DEVNET_AUTHORITY_KEYPAIR?.trim() || DEFAULT_AUTHORITY_KEYPAIR,
    rpcUrl: env.DEVNET_RPC_URL?.trim() || 'https://api.devnet.solana.com',
    recordPath,
    explorer: argv.includes('--explorer'),
  };
}

export function buildWalletInitScript(opts: {
  address: string;
  publicKeyBytes: number[];
  port: number;
  token: string;
}): string {
  return `(()=>{if(location.origin!=="http://127.0.0.1:5173")return;window.__signCalls=0;const address=${JSON.stringify(opts.address)},publicKey=new Uint8Array(${JSON.stringify(opts.publicKeyBytes)});const account=Object.freeze({address,publicKey,chains:["solana:devnet"],features:["solana:signTransaction"]});let accounts=[];const listeners=new Set();const wallet={version:"1.0.0",name:"Dedicated Devnet Test Wallet",icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PC9zdmc+",chains:["solana:devnet"],get accounts(){return accounts},features:{"standard:connect":{version:"1.0.0",connect:async()=>{accounts=[account];listeners.forEach(f=>f({accounts}));return {accounts}}},"standard:disconnect":{version:"1.0.0",disconnect:async()=>{accounts=[];listeners.forEach(f=>f({accounts}))}},"standard:events":{version:"1.0.0",on:(event,f)=>{if(event==="change")listeners.add(f);return()=>listeners.delete(f)}},"solana:signTransaction":{version:"1.0.0",supportedTransactionVersions:["legacy",0],signTransaction:async(...inputs)=>{window.__signCalls+=1;if(inputs.length!==1||inputs[0].chain!=="solana:devnet")throw Error("unexpected request");const r=await fetch("http://127.0.0.1:${opts.port}",{method:"POST",headers:{"Content-Type":"application/json","X-Test-Token":${JSON.stringify(opts.token)}},body:JSON.stringify({bytes:Array.from(inputs[0].transaction)})});if(!r.ok)throw Error("test signer refused");const result=await r.json();return [{signedTransaction:new Uint8Array(result.bytes)}]}}}};const register=({register})=>register(wallet);window.addEventListener("wallet-standard:app-ready",e=>register(e.detail));window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet",{detail:register}));})();`;
}

export function allocateRuntimeDir(baseRoot = join(REPO_ROOT, '.aula', 'r')): string {
  mkdirSync(baseRoot, { recursive: true });
  for (let i = 0; i < 32; i++) {
    const id = randomBytes(1).toString('hex');
    const dir = join(baseRoot, id);
    if (existsSync(dir)) continue;
    const sockPath = join(dir, 'chrome-devtools-mcp', 'server.sock');
    if (Buffer.byteLength(sockPath, 'utf8') > MAX_UNIX_SOCKET_BYTES) {
      throw new Error(
        `Unix socket path exceeds ${MAX_UNIX_SOCKET_BYTES} bytes (${Buffer.byteLength(sockPath, 'utf8')}): ${sockPath}`,
      );
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  throw new Error(`Could not allocate free runtime directory under ${baseRoot}`);
}

export function formatRecoveryReport(info: {
  biz: string;
  authorityPubkey: string;
  pdas: { registro: string; ana: string; venta: string };
  statePath: string;
  capturedSigs: Map<number, string>;
}): string {
  const lines = [
    '=== Recovery & Reconciliation Summary (Do NOT blindly resend) ===',
    `Business: ${info.biz}`,
    `Authority: ${info.authorityPubkey}`,
    `PDAs: registro=${info.pdas.registro}, ana=${info.pdas.ana}, venta=${info.pdas.venta}`,
    `State file: ${info.statePath}`,
  ];
  if (info.capturedSigs.size === 0) {
    lines.push('Captured signatures: none');
  } else {
    for (const [stage, sig] of [...info.capturedSigs.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`  stage=${stage}: ${sig} | ${enlaceTransaccion(sig)}`);
    }
  }
  lines.push(
    'Action: reconcile getSignatureStatuses(sigs, { searchTransactionHistory: true }) and PDA state before starting a new run.',
  );
  return lines.join('\n');
}

class ChromeDevTools113Cli {
  private readonly useGlobalBin: boolean;
  readonly runtimeDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    let hasGlobal113 = false;
    try {
      const ver = execFileSync('chrome-devtools', ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      hasGlobal113 = ver === '1.13.0';
    } catch {
      hasGlobal113 = false;
    }
    this.useGlobalBin = hasGlobal113;
  }

  private runCli(subcommand: string, args: string[] = []): string {
    const cmd = this.useGlobalBin ? 'chrome-devtools' : 'npx';
    const fullArgs = this.useGlobalBin
      ? [subcommand, ...args]
      : ['-p', CHROME_DEVTOOLS_MCP_PKG, 'chrome-devtools', subcommand, ...args];
    try {
      return execFileSync(cmd, fullArgs, {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, NODE_NO_WARNINGS: '1', XDG_RUNTIME_DIR: this.runtimeDir },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`chrome-devtools (${CHROME_DEVTOOLS_MCP_PKG}) [${subcommand}] failed: ${msg}`);
    }
  }

  status(): 'running' | 'stopped' {
    const out = this.runCli('status');
    if (out.includes('daemon is running')) return 'running';
    if (out.includes('not running')) return 'stopped';
    throw new Error(`Unexpected chrome-devtools status output: ${out}`);
  }

  startIsolated(): string {
    return this.runCli('start', ['--isolated']);
  }

  stop(): void {
    try {
      this.runCli('stop');
    } catch {
      // Best-effort cleanup of this run's owned daemon
    }
  }

  newPage(url: string): number {
    const out = this.runCli('new_page', [url]);
    const lines = out.split('\n');
    for (const line of lines) {
      if (line.includes('[selected]')) {
        const m = line.match(/^(\d+):/);
        if (m) return Number(m[1]);
      }
    }
    const matches = [...out.matchAll(/^(\d+):/gm)];
    if (matches.length > 0) return Number(matches[matches.length - 1][1]);
    throw new Error(`Could not determine pageId from new_page output:\n${out}`);
  }

  navigatePage(pageId: number, url: string, initScript?: string): string {
    const args = [String(pageId), '--type', 'url', '--url', url];
    if (initScript) args.push('--initScript', initScript);
    return this.runCli('navigate_page', args);
  }

  takeSnapshot(pageId: number): string {
    return this.runCli('take_snapshot', [String(pageId)]);
  }

  fill(pageId: number, uid: string, value: string): string {
    return this.runCli('fill', [String(pageId), uid, value]);
  }

  click(pageId: number, uid: string): string {
    return this.runCli('click', [String(pageId), uid]);
  }

  evaluateScript(pageId: number, fnSource: string): string {
    return this.runCli('evaluate_script', [fnSource, '--pageId', String(pageId)]);
  }

  resizePage(pageId: number, width: number, height: number): string {
    return this.runCli('resize_page', [String(pageId), String(width), String(height)]);
  }

  screencastStart(pageId: number, filePath: string): string {
    return this.runCli('screencast_start', [String(pageId), '--filePath', filePath]);
  }

  screencastStop(pageId: number): string {
    return this.runCli('screencast_stop', [String(pageId)]);
  }

  findUid(snapshot: string, label: string | RegExp, role?: string): string {
    for (const line of snapshot.split('\n')) {
      if (role && !line.includes(role)) continue;
      const matches = typeof label === 'string' ? line.includes(label) : label.test(line);
      if (matches) {
        const m = line.match(/uid=([^\s]+)/);
        if (m) return m[1];
      }
    }
    throw new Error(`Element matching "${label}" (role: ${role || 'any'}) not found in snapshot.`);
  }

  findFormButton(snapshot: string, label: string): string {
    const lines = snapshot.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('button') && lines[i].includes(`"${label}"`)) {
        const m = lines[i].match(/uid=([^\s]+)/);
        if (m) return m[1];
      }
    }
    throw new Error(`Form submit button matching "${label}" not found.`);
  }
}

async function isViteListening(): Promise<boolean> {
  try {
    const res = await fetch(APP_URL, { method: 'HEAD' });
    return res.ok || res.status === 200 || res.status === 304;
  } catch {
    return false;
  }
}

async function ensureViteServer(): Promise<ChildProcess> {
  if (await isViteListening()) {
    throw new Error(
      `Ya existe un servidor escuchando en ${APP_URL}. Detenlo antes para que verificar:browser:devnet gestione su propio proceso Vite.`,
    );
  }
  const viteProc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isViteListening()) return viteProc;
    await new Promise((r) => setTimeout(r, 400));
  }
  viteProc.kill('SIGTERM');
  throw new Error(`Vite dev server failed to start on ${APP_URL}`);
}

async function waitConfirmUi(
  cli: ChromeDevTools113Cli,
  pageId: number,
  expectedText: string,
  timeoutMs = 45000,
): Promise<{ ok: boolean; snapshot: string }> {
  const start = Date.now();
  let lastSnap = '';
  while (Date.now() - start < timeoutMs) {
    lastSnap = cli.takeSnapshot(pageId);
    if (lastSnap.includes('Operación confirmada.') && (!expectedText || lastSnap.includes(expectedText))) {
      return { ok: true, snapshot: lastSnap };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, snapshot: lastSnap };
}

async function reconcileStageSignature(
  connection: Connection,
  sig: string,
  timeoutMs = 30000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const st = res.value[0];
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      if (st.err !== null) {
        throw new Error(`Signature ${sig} landed with error: ${JSON.stringify(st.err)}`);
      }
      return st.confirmationStatus;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timeout reconciling signature ${sig}; inspect Explorer before retrying.`);
}

function readSignCalls(cli: ChromeDevTools113Cli, pageId: number): number {
  const out = cli.evaluateScript(pageId, '() => ({ signCalls: window.__signCalls ?? -1 })');
  const m = out.match(/"signCalls"\s*:\s*(\d+)/);
  if (!m) throw new Error(`Failed to read window.__signCalls: ${out}`);
  return Number(m[1]);
}

async function checkZeroAmountBlocked(
  cli: ChromeDevTools113Cli,
  pageId: number,
  spec: { tab: string; amountLabel: string; submit: string; includeDesc?: boolean },
): Promise<string> {
  let snap = cli.takeSnapshot(pageId);
  cli.click(pageId, cli.findUid(snap, spec.tab, 'button'));
  await new Promise((r) => setTimeout(r, 400));
  snap = cli.takeSnapshot(pageId);

  cli.fill(pageId, cli.findUid(snap, 'ID del cliente', 'spinbutton'), '1');
  cli.fill(pageId, cli.findUid(snap, 'SKU', 'textbox'), 'CAF01');
  if (spec.includeDesc) {
    cli.fill(pageId, cli.findUid(snap, 'Descripción', 'textbox'), 'Cafe americano');
  }
  cli.fill(pageId, cli.findUid(snap, spec.amountLabel, 'spinbutton'), '0');

  const beforeCalls = readSignCalls(cli, pageId);
  cli.click(pageId, cli.findFormButton(snap, spec.submit));
  await new Promise((r) => setTimeout(r, 400));

  const checkOut = cli.evaluateScript(
    pageId,
    `() => { const el = Array.from(document.querySelectorAll('form input[type="number"]')).find((i) => i.min === '1' && i.max === '4294967295'); el?.reportValidity?.(); return { valid: el?.validity?.valid ?? null, rangeUnderflow: el?.validity?.rangeUnderflow ?? null, validationMessage: el?.validationMessage ?? '', signCalls: window.__signCalls ?? -1 }; }`,
  );
  const afterCalls = readSignCalls(cli, pageId);
  assert.ok(
    checkOut.includes('"rangeUnderflow":true') && checkOut.includes('"valid":false'),
    `${spec.tab} monto=0 did not trigger HTML5 rangeUnderflow: ${checkOut}`,
  );
  assert.equal(afterCalls, beforeCalls, `${spec.tab} monto=0 invoked signing (${beforeCalls} -> ${afterCalls})`);
  console.log(`✔ ${spec.tab} monto=0 blocked in UI (rangeUnderflow=true, signCalls=${afterCalls}).`);
  await new Promise((r) => setTimeout(r, 1200));
  return cli.takeSnapshot(pageId);
}

async function visitExplorerPage(
  cli: ChromeDevTools113Cli,
  pageId: number,
  label: string,
  url: string,
): Promise<void> {
  console.log(`Visiting Explorer (${label}): ${url}`);
  try {
    cli.navigatePage(pageId, url);
    await new Promise((r) => setTimeout(r, 4000));
    const snap = cli.takeSnapshot(pageId);
    const originCheck = cli.evaluateScript(
      pageId,
      '() => ({ origin: location.origin, hasSignCalls: typeof window.__signCalls !== "undefined" })',
    );
    assert.ok(
      originCheck.includes('"hasSignCalls":false'),
      `Origin guard failed on ${url}: ${originCheck}`,
    );
    console.log(`  Explorer snapshot [${label}] (${snap.split('\n').length} lines, originCheck=${originCheck.trim().split('\n').pop()})`);
  } catch (err) {
    console.warn(`  Warning: Explorer view [${label}] unavailable (${err instanceof Error ? err.message : String(err)}); preserving public link.`);
  }
}

async function main() {
  const opts = parseBrowserDevnetOptions(process.argv.slice(2), process.env);
  const resolvedKeyPath = assertExternalPath(opts.keypairPath, REPO_ROOT);
  if (!existsSync(resolvedKeyPath)) {
    throw new Error(`Authority keypair not found at external path: ${resolvedKeyPath}`);
  }
  const rawKey = JSON.parse(readFileSync(resolvedKeyPath, 'utf8'));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
  const authorityPubkey = keypair.publicKey.toBase58();
  if (authorityPubkey !== opts.expectedAuthority) {
    throw new Error(
      `Autoridad inesperada: se obtuvo ${authorityPubkey}, pero DEVNET_EXPECTED_AUTHORITY=${opts.expectedAuthority}`,
    );
  }

  const connection = new Connection(opts.rpcUrl, 'confirmed');
  await comprobarPrograma(connection);
  const initialBalance = await connection.getBalance(keypair.publicKey, 'confirmed');
  if (initialBalance < MIN_BALANCE_LAMPORTS) {
    throw new Error(
      `Saldo insuficiente en Devnet para ${authorityPubkey}: ${initialBalance} lamports (< ${MIN_BALANCE_LAMPORTS}).`,
    );
  }

  const biz = `DevnetZ0-${Date.now().toString(36).slice(-6)}`;
  const statePath = assertExternalPath(
    join(homedir(), `.config/solana/registro-firmante-state-${biz}.json`),
    REPO_ROOT,
  );
  const manejador = crearManejadorFirmante({ connection, keypair, biz, statePath, modo: 'nuevo' });
  await manejador.verificarInicio();

  const runtimeDir = allocateRuntimeDir();
  const cli = new ChromeDevTools113Cli(runtimeDir);
  const token = randomBytes(24).toString('hex');
  const capturedSigs = new Map<number, string>();
  let server: Server | null = null;
  let viteProc: ChildProcess | null = null;
  let startedDaemon = false;
  let pageId: number | null = null;
  let recordingStarted = false;

  try {
    if (cli.status() !== 'stopped') {
      throw new Error(`Expected fresh isolated runtime dir ${runtimeDir} to be stopped.`);
    }

    server = createServer(async (req, res) => {
      const origin = req.headers.origin;
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Test-Token');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      if (req.method !== 'POST' || origin !== 'http://127.0.0.1:5173' || req.headers['x-test-token'] !== token) {
        res.writeHead(403);
        return res.end();
      }
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 10_000) throw new Error('oversized');
        }
        const data = JSON.parse(body);
        const out = await manejador.procesar(data.bytes);
        if (out.status !== 200) {
          res.writeHead(out.status);
          return res.end(JSON.stringify({ error: out.error }));
        }
        capturedSigs.set(out.stage, out.sig);
        console.log(`SIGNED stage=${out.stage} sig=${out.sig}`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ bytes: out.bytes }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    await new Promise<void>((resolveListen) => server!.listen(0, '127.0.0.1', resolveListen));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind loopback signer port.');

    viteProc = await ensureViteServer();
    cli.startIsolated();
    startedDaemon = true;
    pageId = cli.newPage('about:blank');
    cli.resizePage(pageId, 1280, 800);

    if (opts.recordPath) {
      const absRecord = resolve(REPO_ROOT, opts.recordPath);
      if (existsSync(absRecord)) {
        throw new Error(`La ruta de grabacion ya existe (elige una ruta nueva): ${absRecord}`);
      }
      mkdirSync(dirname(absRecord), { recursive: true });
      cli.screencastStart(pageId, absRecord);
      recordingStarted = true;
    }

    const initScript = buildWalletInitScript({
      address: authorityPubkey,
      publicKeyBytes: Array.from(keypair.publicKey.toBytes()),
      port: addr.port,
      token,
    });
    cli.navigatePage(pageId, APP_URL, initScript);
    await new Promise((r) => setTimeout(r, 1200));

    let snap = cli.takeSnapshot(pageId);
    cli.click(pageId, cli.findUid(snap, 'Conectar wallet', 'button'));
    await new Promise((r) => setTimeout(r, 500));
    snap = cli.takeSnapshot(pageId);
    cli.click(pageId, cli.findUid(snap, 'Dedicated Devnet Test Wallet', 'button'));
    await new Promise((r) => setTimeout(r, 800));
    snap = cli.takeSnapshot(pageId);

    // Part A: Zero-amount UI blocking in both enabled amount forms
    cli.fill(pageId, cli.findUid(snap, 'Nombre exacto del negocio', 'textbox'), biz);
    await checkZeroAmountBlocked(cli, pageId, {
      tab: 'Registrar venta',
      amountLabel: 'Importe',
      submit: 'Registrar venta',
      includeDesc: true,
    });
    snap = await checkZeroAmountBlocked(cli, pageId, {
      tab: 'Corregir importe',
      amountLabel: 'Nuevo importe',
      submit: 'Corregir importe',
    });

    // Part B: 4 positive Devnet transactions
    cli.click(pageId, cli.findUid(snap, 'Crear registro', 'button'));
    await new Promise((r) => setTimeout(r, 300));
    snap = cli.takeSnapshot(pageId);
    cli.click(pageId, cli.findFormButton(snap, 'Crear registro'));
    const s0Ui = await waitConfirmUi(cli, pageId, biz);
    const sig0 = capturedSigs.get(0);
    assert.ok(sig0, 'Expected Stage 0 signature to be captured');
    const st0 = await reconcileStageSignature(connection, sig0);
    assert.ok(s0Ui.ok, `Stage 0 UI confirmation missing for ${biz}`);
    await new Promise((r) => setTimeout(r, 1000));

    snap = s0Ui.snapshot;
    cli.click(pageId, cli.findUid(snap, 'Crear cliente', 'button'));
    await new Promise((r) => setTimeout(r, 400));
    snap = cli.takeSnapshot(pageId);
    cli.fill(pageId, cli.findUid(snap, 'Nombre del cliente', 'textbox'), 'Ana');
    cli.click(pageId, cli.findFormButton(snap, 'Crear cliente'));
    let s1Ui = await waitConfirmUi(cli, pageId, 'Ana');
    const sig1 = capturedSigs.get(1);
    assert.ok(sig1, 'Expected Stage 1 signature to be captured');
    const st1 = await reconcileStageSignature(connection, sig1);
    if (!s1Ui.ok) {
      cli.click(pageId, cli.findUid(s1Ui.snapshot, 'Consultar registro', 'button'));
      await new Promise((r) => setTimeout(r, 1500));
      s1Ui = { ok: cli.takeSnapshot(pageId).includes('Ana'), snapshot: cli.takeSnapshot(pageId) };
    }
    assert.ok(s1Ui.ok, 'Expected Ana visible in UI after Stage 1');
    await new Promise((r) => setTimeout(r, 1000));

    snap = s1Ui.snapshot;
    cli.click(pageId, cli.findUid(snap, 'Registrar venta', 'button'));
    await new Promise((r) => setTimeout(r, 400));
    snap = cli.takeSnapshot(pageId);
    cli.fill(pageId, cli.findUid(snap, 'ID del cliente', 'spinbutton'), '1');
    cli.fill(pageId, cli.findUid(snap, 'SKU', 'textbox'), 'CAF01');
    cli.fill(pageId, cli.findUid(snap, 'Descripción', 'textbox'), 'Cafe americano');
    cli.fill(pageId, cli.findUid(snap, 'Importe', 'spinbutton'), '50');
    cli.click(pageId, cli.findFormButton(snap, 'Registrar venta'));
    const s2Ui = await waitConfirmUi(cli, pageId, 'CAF01');
    const sig2 = capturedSigs.get(2);
    assert.ok(sig2, 'Expected Stage 2 signature to be captured');
    const st2 = await reconcileStageSignature(connection, sig2);
    assert.ok(s2Ui.ok && s2Ui.snapshot.includes('50'), 'Expected CAF01 and 50 in UI after Stage 2');
    await new Promise((r) => setTimeout(r, 1200));

    snap = s2Ui.snapshot;
    cli.click(pageId, cli.findUid(snap, 'Corregir importe', 'button'));
    await new Promise((r) => setTimeout(r, 400));
    snap = cli.takeSnapshot(pageId);
    cli.fill(pageId, cli.findUid(snap, 'ID del cliente', 'spinbutton'), '1');
    cli.fill(pageId, cli.findUid(snap, 'SKU', 'textbox'), 'CAF01');
    cli.fill(pageId, cli.findUid(snap, 'Nuevo importe', 'spinbutton'), '55');
    cli.click(pageId, cli.findFormButton(snap, 'Corregir importe'));
    const s3Ui = await waitConfirmUi(cli, pageId, '55');
    const sig3 = capturedSigs.get(3);
    assert.ok(sig3, 'Expected Stage 3 signature to be captured');
    const st3 = await reconcileStageSignature(connection, sig3);
    assert.ok(s3Ui.ok, 'Expected 55 in UI after Stage 3');
    await new Promise((r) => setTimeout(r, 1200));

    // Close loopback signing bridge BEFORE navigating to Explorer
    server.close();
    server = null;

    if (opts.explorer) {
      await visitExplorerPage(
        cli,
        pageId,
        'Program',
        `https://explorer.solana.com/address/${REGISTRO_PROGRAM_ADDRESS}?cluster=devnet`,
      );
      await visitExplorerPage(cli, pageId, 'Current registrar_venta (50)', enlaceTransaccion(sig2));
      await visitExplorerPage(cli, pageId, 'Current cambiar_monto (55)', enlaceTransaccion(sig3));
      for (const hist of HISTORICAL_ZERO_AMOUNT_FAILURES) {
        await visitExplorerPage(cli, pageId, hist.label, enlaceTransaccion(hist.sig));
      }
    }

    const [regInfo, anaInfo, ventaInfo, finalBalance] = await Promise.all([
      connection.getAccountInfo(new PublicKey(manejador.pdas.registro), 'confirmed'),
      connection.getAccountInfo(new PublicKey(manejador.pdas.ana), 'confirmed'),
      connection.getAccountInfo(new PublicKey(manejador.pdas.venta), 'confirmed'),
      connection.getBalance(keypair.publicKey, 'confirmed'),
    ]);
    assert.ok(regInfo && anaInfo && ventaInfo, 'Expected Registro, Cliente, and Venta accounts on-chain');
    const regDec = getRegistroDecoder().decode(regInfo.data);
    const anaDec = getClienteDecoder().decode(anaInfo.data);
    const ventaDec = getVentaDecoder().decode(ventaInfo.data);
    assert.equal(regDec.owner, authorityPubkey);
    assert.equal(anaDec.nombre, 'Ana');
    assert.equal(anaDec.compras, 1);
    assert.equal(ventaDec.sku, 'CAF01');
    assert.equal(ventaDec.monto, 55);

    console.log('\n=== Devnet Browser Sale Walkthrough Summary ===');
    console.log(`Program ID: ${REGISTRO_PROGRAM_ADDRESS}`);
    console.log(`Business: ${biz}`);
    console.log(`Authority: ${authorityPubkey}`);
    console.log(`Balance before -> after: ${initialBalance} -> ${finalBalance} lamports (delta ${finalBalance - initialBalance})`);
    console.log(`Stage 0 (crear_registro): ${sig0} [${st0}] | ${enlaceTransaccion(sig0)}`);
    console.log(`Stage 1 (crear_cliente):  ${sig1} [${st1}] | ${enlaceTransaccion(sig1)}`);
    console.log(`Stage 2 (registrar_venta): ${sig2} [${st2}] | ${enlaceTransaccion(sig2)}`);
    console.log(`Stage 3 (cambiar_monto):  ${sig3} [${st3}] | ${enlaceTransaccion(sig3)}`);
  } catch (err) {
    console.error('\n' + formatRecoveryReport({ biz, authorityPubkey, pdas: manejador.pdas, statePath, capturedSigs }));
    throw err;
  } finally {
    if (recordingStarted && pageId !== null) {
      try {
        cli.screencastStop(pageId);
      } catch {
        // Best-effort cleanup
      }
    }
    if (pageId !== null) {
      try {
        cli.navigatePage(pageId, 'about:blank');
      } catch {
        // Best-effort cleanup
      }
    }
    if (startedDaemon) cli.stop();
    if (server) server.close();
    if (viteProc) viteProc.kill('SIGTERM');
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Devnet browser verification failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
