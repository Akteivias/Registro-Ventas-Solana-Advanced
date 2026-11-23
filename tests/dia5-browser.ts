/**
 * tests/dia5-browser.ts
 *
 * Automated Browser Verification
 * Covers the offline simulated-wallet and public-read browser checks from
 * docs/PRUEBAS-AUTOMATIZADAS.md using the chrome-devtools CLI (Option A)
 * without adding heavy dependencies (Playwright/Puppeteer) to package.json.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { address, createNoopSigner, AccountRole } from '@solana/kit';
import {
  getRegistrarVentaInstruction,
  getHacerDevolucionInstruction,
  REGISTRO_PROGRAM_ADDRESS,
} from '../clients/js/src/generated/index.js';
import { cadena } from '../src/solana/pdas.js';
import { assertExternalPath } from './dia5-devnet.js';

const APP_URL = 'http://127.0.0.1:5173/';
const REPO_ROOT = resolve(import.meta.dirname, '..');
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// --- OFFLINE SIMULATED WALLET INIT SCRIPT (Section 4 of PRUEBAS-AUTOMATIZADAS.md) ---
const OFFLINE_WALLET_INIT_SCRIPT = `
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin) return originalFetch(input, init);
    try {
      const request = JSON.parse(typeof init?.body === 'string' ? init.body : '');
      const reply = (q) => {
        let result = null;
        if (q.method === 'getGenesisHash') result = '${DEVNET_GENESIS}';
        if (q.method === 'getAccountInfo') result = { context: { slot: 1 }, value: q.params?.[0] === '${REGISTRO_PROGRAM_ADDRESS}' ? { data: ['', 'base64'], executable: true, lamports: 1141440, owner: 'BPFLoaderUpgradeab1e11111111111111111111111', rentEpoch: 0, space: 36 } : null };
        if (q.method === 'getLatestBlockhash') result = { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 999999999 } };
        if (q.method === 'getBalance') result = { context: { slot: 1 }, value: 0 };
        return { jsonrpc: '2.0', id: q.id, result };
      };
      return new Response(JSON.stringify(Array.isArray(request) ? request.map(reply) : reply(request)), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch { return new Response('', { status: 403 }); }
  };
  const address = '61mKpgKTsuBpSVrX3o2GtuXkLtcrwFkCSH9gnYVFnUTW';
  const publicKey = new Uint8Array([74,124,141,114,51,140,197,63,223,196,42,160,81,178,246,29,3,208,156,177,47,38,88,190,154,56,102,195,193,211,223,117]);
  const account = Object.freeze({ address, publicKey, chains: ['solana:devnet'], features: ['solana:signTransaction'] });
  let accounts = [];
  const listeners = new Set();
  window.__offlineSignCalls = 0;
  const wallet = {
    version: '1.0.0', name: 'Offline Test Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PC9zdmc+',
    chains: ['solana:devnet'], get accounts() { return accounts; },
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { accounts = [account]; listeners.forEach((f) => f({ accounts })); return { accounts }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { accounts = []; listeners.forEach((f) => f({ accounts })); } },
      'standard:events': { version: '1.0.0', on: (event, f) => { if (event === 'change') listeners.add(f); return () => listeners.delete(f); } },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async () => { window.__offlineSignCalls += 1; throw new Error('User rejected the request'); } },
    },
  };
  const register = ({ register }) => register(wallet);
  window.addEventListener('wallet-standard:app-ready', (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
})();
`;

// --- CHROME DEVTOOLS CLI WRAPPER ---
const CHROME_DEVTOOLS_MCP_PKG = 'chrome-devtools-mcp@1.0.1';

class ChromeDevToolsCli {
  private runCli(subcommand: string, args: string[] = []): string {
    const fullArgs = ['-p', CHROME_DEVTOOLS_MCP_PKG, 'chrome-devtools', subcommand, ...args];
    try {
      return execFileSync('npx', fullArgs, {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`chrome-devtools CLI [${subcommand}] failed: ${msg}`);
    }
  }

  status(): boolean {
    try {
      const out = this.runCli('status');
      return out.includes('daemon is running');
    } catch {
      return false;
    }
  }

  stop(): void {
    try {
      this.runCli('stop');
    } catch {
      // Ignored if already stopped
    }
  }

  newPage(url: string): string {
    return this.runCli('new_page', [url]);
  }

  navigatePage(options: { url?: string; initScript?: string }): string {
    const args: string[] = ['--type', 'url'];
    if (options.url) args.push('--url', options.url);
    if (options.initScript) args.push('--initScript', options.initScript);
    return this.runCli('navigate_page', args);
  }

  takeSnapshot(): string {
    return this.runCli('take_snapshot');
  }

  fill(uid: string, value: string): string {
    return this.runCli('fill', [uid, value]);
  }

  click(uid: string): string {
    return this.runCli('click', [uid]);
  }

  evaluateScript(fnSource: string): string {
    return this.runCli('evaluate_script', [fnSource]);
  }

  findUid(snapshot: string, label: string | RegExp, role?: string): string {
    const lines = snapshot.split('\n');
    for (const line of lines) {
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
    let insideForm = false;
    for (const line of lines) {
      if (line.includes('form')) insideForm = true;
      if (insideForm && line.includes('button') && line.includes(`"${label}"`)) {
        const m = line.match(/uid=([^\s]+)/);
        if (m) return m[1];
      }
    }
    // Fallback: reverse search for the button inside the active panel
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.includes('button') && line.includes(`"${label}"`)) {
        const m = line.match(/uid=([^\s]+)/);
        if (m) return m[1];
      }
    }
    throw new Error(`Form submit button matching "${label}" not found.`);
  }

  hasText(snapshot: string, text: string | RegExp): boolean {
    return typeof text === 'string' ? snapshot.includes(text) : text.test(snapshot);
  }
}

// --- VITE SERVER PROBE & LIFECYCLE ---
async function isViteListening(): Promise<boolean> {
  try {
    const res = await fetch(APP_URL, { method: 'HEAD' });
    return res.ok || res.status === 200 || res.status === 304;
  } catch {
    return false;
  }
}

async function ensureViteServer(): Promise<ChildProcess | null> {
  if (await isViteListening()) {
    console.log('✔ Vite dev server is already running on ' + APP_URL);
    return null;
  }

  console.log('Starting local Vite dev server...');
  const viteProc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });

  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isViteListening()) {
      console.log('✔ Vite dev server ready on ' + APP_URL);
      return viteProc;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  viteProc.kill();
  throw new Error('Vite dev server failed to start on ' + APP_URL);
}

// --- SUITE 1: OFFLINE SIMULATED WALLET & BOUNDARIES ---
async function runOfflineWalletSuite(cli: ChromeDevToolsCli): Promise<void> {
  console.log('\n--- [Suite 1] Offline Simulated Wallet & Boundary Validation ---');

  // 1. Open new page and navigate with initScript
  console.log('1. Navigating with Offline Test Wallet initScript...');
  cli.newPage('about:blank');
  cli.navigatePage({ url: APP_URL, initScript: OFFLINE_WALLET_INIT_SCRIPT });
  await new Promise((r) => setTimeout(r, 1200));

  let snapshot = cli.takeSnapshot();

  // 2. Connect Offline Test Wallet
  console.log('2. Connecting Offline Test Wallet...');
  if (cli.hasText(snapshot, 'Conectar wallet')) {
    const connectUid = cli.findUid(snapshot, 'Conectar wallet', 'button');
    cli.click(connectUid);
    await new Promise((r) => setTimeout(r, 600));
    snapshot = cli.takeSnapshot();

    if (cli.hasText(snapshot, 'Offline Test Wallet')) {
      const walletItemUid = cli.findUid(snapshot, 'Offline Test Wallet', 'button');
      cli.click(walletItemUid);
      await new Promise((r) => setTimeout(r, 800));
      snapshot = cli.takeSnapshot();
    }
  }

  // Verify wallet is shown as connected with its short address
  if (!cli.hasText(snapshot, '61mK') && !cli.hasText(snapshot, 'FnUTW')) {
    throw new Error('Offline Test Wallet did not connect as expected.');
  }
  console.log('✔ Offline Test Wallet successfully connected (address: 61mKpgKT...FnUTW).');

  // Ensure autoridad textbox has the connected wallet address
  const authUid = cli.findUid(snapshot, 'Dirección de la autoridad', 'textbox');
  cli.fill(authUid, '61mKpgKTsuBpSVrX3o2GtuXkLtcrwFkCSH9gnYVFnUTW');
  await new Promise((r) => setTimeout(r, 400));
  snapshot = cli.takeSnapshot();

  // 3. Click "Crear registro" form submit button -> Verify rejection message
  console.log('3. Testing signature cancellation on "Crear registro"...');
  const crearRegistroBtnUid = cli.findFormButton(snapshot, 'Crear registro');
  cli.click(crearRegistroBtnUid);
  await new Promise((r) => setTimeout(r, 1200));
  snapshot = cli.takeSnapshot();

  if (!cli.hasText(snapshot, 'La firma fue cancelada en la wallet')) {
    throw new Error('Expected cancellation alert not found after clicking Crear registro.');
  }
  console.log('✔ Cancellation alert verified: «La firma fue cancelada en la wallet. Puedes volver a intentarlo.»');

  // 4. Test "Eliminar cliente" boundary validations
  console.log('4. Navigating to "Eliminar cliente" tab...');
  const eliminarTabUid = cli.findUid(snapshot, 'Eliminar cliente', 'button');
  cli.click(eliminarTabUid);
  await new Promise((r) => setTimeout(r, 600));
  snapshot = cli.takeSnapshot();

  // Test ID 0 -> boundary rejection
  console.log('5. Testing invalid customer ID "0" boundary validation...');
  // Find the actual input element (spinbutton or textbox) associated with ID del cliente
  let idInputUid: string;
  try {
    idInputUid = cli.findUid(snapshot, 'ID del cliente', 'spinbutton');
  } catch {
    idInputUid = cli.findUid(snapshot, 'ID del cliente', 'textbox');
  }
  cli.fill(idInputUid, '0');
  const submitEliminarUid = cli.findFormButton(snapshot, 'Eliminar cliente');
  cli.click(submitEliminarUid);
  await new Promise((r) => setTimeout(r, 600));
  snapshot = cli.takeSnapshot();
  if (cli.hasText(snapshot, 'La firma fue cancelada en la wallet')) {
    throw new Error('Boundary validation failed: form was submitted with invalid customer ID 0');
  }
  console.log('✔ ID 0 boundary validation verified (HTML5 input validation blocks submit).');

  // Test ID 1 -> wallet cancellation
  console.log('6. Testing customer ID "1" wallet cancellation...');
  cli.fill(idInputUid, '1');
  cli.click(submitEliminarUid);
  await new Promise((r) => setTimeout(r, 1200));
  snapshot = cli.takeSnapshot();

  if (!cli.hasText(snapshot, 'La firma fue cancelada en la wallet')) {
    throw new Error('Expected cancellation alert not found after submitting Eliminar cliente with ID 1.');
  }
  console.log('✔ Customer ID 1 cancellation verified: «La firma fue cancelada en la wallet. Puedes volver a intentarlo.»');

  // 7. Test "Registrar venta" and "Corregir importe" monto = 0 blocking + positive control (monto = 1)
  for (const spec of [
    { tab: 'Registrar venta', amountLabel: 'Importe', submit: 'Registrar venta' },
    { tab: 'Corregir importe', amountLabel: 'Nuevo importe', submit: 'Corregir importe' },
  ]) {
    console.log(`7. Testing "${spec.tab}" monto = 0 HTML5 rangeUnderflow + positive control (monto = 1)...`);
    cli.click(cli.findUid(snapshot, spec.tab, 'button'));
    await new Promise((r) => setTimeout(r, 500));
    snapshot = cli.takeSnapshot();

    const idUid = cli.findUid(snapshot, 'ID del cliente', 'spinbutton');
    cli.fill(idUid, '1');
    const skuUid = cli.findUid(snapshot, 'SKU', 'textbox');
    cli.fill(skuUid, 'CAF01');
    if (spec.tab === 'Registrar venta') {
      const descUid = cli.findUid(snapshot, 'Descripción', 'textbox');
      cli.fill(descUid, 'Cafe americano');
    }

    let amountUid: string;
    try {
      amountUid = cli.findUid(snapshot, spec.amountLabel, 'spinbutton');
    } catch {
      amountUid = cli.findUid(snapshot, spec.amountLabel, 'textbox');
    }
    cli.fill(amountUid, '0');
    const beforeZero = cli.evaluateScript('() => ({ signCalls: window.__offlineSignCalls || 0 })');
    const submitUid = cli.findFormButton(snapshot, spec.submit);
    cli.click(submitUid);
    await new Promise((r) => setTimeout(r, 500));
    snapshot = cli.takeSnapshot();

    const zeroEval = cli.evaluateScript(
      `() => { const el = Array.from(document.querySelectorAll('form input[type="number"]')).find((i) => i.min === '1' && i.max === '4294967295'); return { value: el?.value ?? null, valid: el?.validity?.valid ?? null, rangeUnderflow: el?.validity?.rangeUnderflow ?? null, min: el?.min ?? null, signCalls: window.__offlineSignCalls || 0 }; }`,
    );
    const beforeCalls = Number(beforeZero.match(/"signCalls"\s*:\s*(\d+)/)?.[1] ?? '-1');
    const afterZeroCalls = Number(zeroEval.match(/"signCalls"\s*:\s*(\d+)/)?.[1] ?? '-1');
    if (!zeroEval.includes('"rangeUnderflow":true') || !zeroEval.includes('"valid":false') || afterZeroCalls !== beforeCalls) {
      throw new Error(`${spec.tab} monto=0 validation/no-sign check failed: ${zeroEval}`);
    }
    console.log(`✔ ${spec.tab} monto=0 blocked by HTML5 min="1" (rangeUnderflow=true, signCalls unchanged=${afterZeroCalls}).`);

    // Positive control: same completed form with amount 1 reaches the simulated wallet
    cli.fill(amountUid, '1');
    cli.click(submitUid);
    await new Promise((r) => setTimeout(r, 1200));
    snapshot = cli.takeSnapshot();
    const posEval = cli.evaluateScript('() => ({ signCalls: window.__offlineSignCalls || 0 })');
    const afterPosCalls = Number(posEval.match(/"signCalls"\s*:\s*(\d+)/)?.[1] ?? '-1');
    if (afterPosCalls !== beforeCalls + 1 || !cli.hasText(snapshot, 'La firma fue cancelada en la wallet')) {
      throw new Error(`${spec.tab} positive control (monto=1) did not reach simulated wallet: ${posEval}`);
    }
    console.log(`✔ ${spec.tab} monto=1 positive control reached simulated wallet (signCalls=${afterPosCalls}).`);
  }
}

// --- SUITE 2: COORDINATED DEVNET READ OBSERVATION ---
async function runReadObservationSuite(cli: ChromeDevToolsCli, businessName?: string, authorityPubkey?: string): Promise<void> {
  console.log('\n--- [Suite 2] Public Read Observation ---');

  const biz = businessName || 'DevnetD5-og2vqf';
  const auth = authorityPubkey || 'A8dR6DpBnipYr7Rgi3pLA3ARM3sCAocbwvTmcjEfjb8t';

  console.log(`1. Navigating to ${APP_URL} for clean public query...`);
  cli.navigatePage({ url: APP_URL });
  await new Promise((r) => setTimeout(r, 1200));

  let snapshot = cli.takeSnapshot();

  console.log(`2. Querying business "${biz}" with authority "${auth}"...`);
  const nombreUid = cli.findUid(snapshot, 'Nombre exacto del negocio', 'textbox');
  cli.fill(nombreUid, biz);

  const authUid = cli.findUid(snapshot, 'Dirección de la autoridad', 'textbox');
  cli.fill(authUid, auth);

  const consultarUid = cli.findUid(snapshot, 'Consultar registro', 'button');
  cli.click(consultarUid);
  await new Promise((r) => setTimeout(r, 2000));

  snapshot = cli.takeSnapshot();
  if (cli.hasText(snapshot, 'El registro todavía no existe') || cli.hasText(snapshot, 'Clientes y ventas')) {
    console.log('✔ Public RPC query executed and response rendered reactively in UI.');
  } else {
    throw new Error('Public query did not produce expected UI reaction.');
  }
}

// --- MAIN RUNNER ---
async function main() {
  console.log('======================================================');
  console.log('  Automated Browser Verification (docs/PRUEBAS-AUTOMATIZADAS.md)');
  console.log('  Driver: Option A (chrome-devtools CLI)');
  console.log('======================================================');

  let viteProc: ChildProcess | null = null;
  const cli = new ChromeDevToolsCli();

  try {
    viteProc = await ensureViteServer();

    // Ensure daemon is clean
    if (cli.status()) {
      cli.stop();
    }

    // Run Suite 1
    await runOfflineWalletSuite(cli);

    // Run Suite 2
    await runReadObservationSuite(cli);

    console.log('\n======================================================');
    console.log('✔ ALL AUTOMATED BROWSER CHECKS PASSED SUCCESSFULLY!');
    console.log('======================================================');
    process.exitCode = 0;
  } catch (err: unknown) {
    console.error('\n❌ Browser verification failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    console.log('\nTearing down browser daemon and test server...');
    cli.stop();
    if (viteProc) {
      viteProc.kill('SIGTERM');
      console.log('✔ Vite child process terminated.');
    }
  }
}

main();
