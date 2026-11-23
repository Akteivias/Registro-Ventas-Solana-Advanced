# ADR 0001: Decoupled CLI Signing and Chrome DevTools MCP Observation

## Status
Accepted

## Context
Validating the Day 5 customer deletion feature on Solana Devnet requires exercising:
1. Multi-account on-chain transitions (creating registry, adding customers, recording sales).
2. Negative preflight simulation checks (`ClienteConVentas 0x1773/6003`).
3. Verification that UI state reflects on-chain data accurately at each stage.
4. Rent refund accounting upon account closure.

Automating this in a browser typically involves browser wallet extensions (e.g., Solflare, Phantom) or synthetic browser automation frameworks (Playwright, Puppeteer) with injected web3 providers.

## Options Considered

1. **Full Browser Automation Suite (Playwright + Synthetic Wallet Injection):**
   * *Pros:* Fully automated browser-driven transaction generation.
   * *Cons:* Requires maintaining heavy test dependencies (`@playwright/test`, browser binaries); complex extension popup handling; high brittleness in CI and AI agent workflows; risks accidental wallet key exposure in browser context.
2. **Pure Mocking (No Live Devnet):**
   * *Pros:* Fast, zero SOL required.
   * *Cons:* Fails to validate real RPC serialization, real compute budgets, actual blockhash expiration, or on-chain program behavior.
3. **Decoupled Architecture (Node CLI Signing + Chrome DevTools MCP Observation):**
   * *Pros:* Node CLI (`tests/dia5-devnet.ts --pausar`) manages secure transaction signing and reconciliation; Chrome DevTools MCP attaches to standard local Vite server (`http://127.0.0.1:5173`) to observe public state at checkpoints. For interactive signing, a minimal Wallet Standard bridge coordinates with an external Node signer process.
   * *Cons:* Requires coordinated checkpoint pauses rather than a single black-box script.

## Decision
Adopt **Option 3: Decoupled Architecture**.
* Node CLI acts as the authoritative transaction generator and signer on Devnet.
* Chrome DevTools MCP acts as the non-invasive observation layer, querying public accounts through the UI without requiring an extension or browser-held private keys.
* For interactive browser tests, use standard `wallet-standard:register-wallet` events coupled with an ephemeral loopback signer.

## Consequences
* **Positive:**
  * Clean repository dependencies (zero heavy browser testing frameworks in `package.json`).
  * Absolute security isolation: private keys remain strictly outside the browser context.
  * Deterministic test output with Explorer transaction signatures recorded at each checkpoint.
* **Negative:**
  * Requires agents or maintainers to coordinate terminal execution with DevTools inspection.
* **Review Criteria:**
  * Revisit if an official, lightweight headless wallet adapter runner becomes standardized across Solana dApps.
