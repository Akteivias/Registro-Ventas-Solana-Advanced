# Agent Guidelines · Registro de Ventas App

Durable operational instructions, project guardrails, and conventions for AI agents working in this repository.

---

## 1. Project Overview & Architecture

This repository is an educational Solana full-stack application from WayLearn's **Solana Engineering Track: Advanced**. It connects a custom on-chain Anchor program with a TypeScript/React frontend on Solana Devnet.

The system follows a 4-tier model:
1. **On-Chain Anchor Program (`programa/src/lib.rs`):** Deployed to Devnet at `F4DhinubMRrYQ3zFCKDe8xW4mu8gKFdkXTEKigwKGMht`. Manages three account types linked via Program Derived Addresses (PDAs): `Registro` (business entity), `Cliente` (customer index and history), and `Venta` (sales record).
2. **Contract Interface (`idl.json`):** Describes instructions, arguments, and account structures extracted from the Anchor build.
3. **Generated Client (`clients/js/src/generated/`):** Generated via Codama (`npm run cliente`) using `@solana/kit` and `@solana/program-client-core` (with `@solana/web3.js` used in app bridge & wallet-adapter).
4. **Web Frontend (`src/`):** React 19.3 + Vite 8.3 + `@solana/wallet-adapter-react`. Allows reading accounts without signatures and submitting transactions with a connected wallet.

### Source Precedence
When resolving conflicts or deciding implementation details:
1. Current user prompt
2. This `AGENTS.md`
3. Repository documentation in `docs/`
4. Existing code, tests, and configuration
5. Official technology documentation (`@solana/kit`, `codama`, `anchor`)

---

## 2. Environment & Tooling Conventions

### Node & Execution
* **Node Version:** Strict engine requirement `>=22.12.0 <25`. Prefer Node 24 via `fnm exec --using=24 <command>`.
* **Standard Verification:**
  ```bash
  fnm exec --using=24 npm run comprobar:idl   # Checks IDL, Program ID, and Codama client parity
  fnm exec --using=24 npm run verificar       # Runs typecheck (tsc -b), unit tests, and vite build
  git diff --check                            # Checks for formatting or whitespace anomalies
  ```

### Standard Commands
* `npm run dev`: Starts the local Vite development server on `http://127.0.0.1:5173`.
* `npm run cliente`: Regenerates `clients/js/src/generated/` from `idl.json` via Codama.
* `npm test`: Runs test suite (`node --import tsx --test tests/*.test.ts`).
* `npm run verificar:devnet`: Runs the headless Devnet test (`tests/dia5-devnet.ts`).

### Strict Prohibitions
* **NEVER run `npm run clase:dia3`, `clase:dia4`, or `clase:resuelto` on active branches:** These scripts copy boilerplate templates from `materiales/` and overwrite active implementation files in `src/solana/`.
* **DO NOT install heavy browser automation frameworks (Playwright, Puppeteer) into package.json:** Browser inspection is handled externally via Chrome DevTools MCP.
* **DO NOT write temporary or test files into `/tmp`:** Keep all files, test fixtures, and scripts inside the repository or the agent scratch directory (`scratch/`). Do not scatter files in global OS temp directories.

---

## 3. Solana & Security Guardrails

### Keypair Isolation
* **Zero Private Keys in Repo:** Private keys, mnemonics, or keypair JSON files MUST NEVER be created inside or committed to the repository.
* **External Path Enforcement:** All Devnet scripts (`tests/dia5-devnet.ts`, `scripts/desplegar-devnet.mjs`) enforce `assertExternalPath()`, requiring keypair files to reside outside the repository tree (default: `~/.config/solana/registro-devnet-tester-keypair.json`).
* `.gitignore` strictly ignores `*-keypair.json`.

### Pre-Transaction Validations
Before broadcasting on-chain transactions:
1. **Devnet Genesis Check:** Validate that `connection.getGenesisHash()` matches Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
2. **Authority & Balance:** Ensure the signer matches `DEVNET_EXPECTED_AUTHORITY` and possesses at least 0.03 SOL (`MIN_BALANCE_LAMPORTS = 30_000_000`) for rent exemption and fees.
3. **Executable Program:** Confirm that `REGISTRO_PROGRAM_ADDRESS` exists and is marked `executable: true`.
4. **Preflight Simulation Errors:** A simulated preflight error (e.g., `ClienteConVentas 0x1773/6003`) does not submit a transaction or consume lamports. Account state must remain unchanged.

### Solana Developer MCP & Ecosystem Skills
For any Solana-specific development, debugging, or contract modification, agents MUST prefer the active `solana-mcp` tools and the local skill `.agents/skills/solana-dev/SKILL.md` over model memory:

1. **Documentation Discovery & Canonical Specs:**
   * Call `list_sections` first for non-trivial architectural or ecosystem questions to discover available source IDs and section taxonomies.
   * Call `get_documentation` (e.g., `section: "anchor-docs"` or `section: "frameworks"`) when canonical specs for libraries, programs, or client frameworks are needed.
2. **Targeted Inquiries & Error Resolution:**
   * Use `Solana_Documentation_Search` or `Solana_Expert__Ask_For_Help` for narrow how-to questions, error codes (e.g., Anchor or RPC error simulation), or API usage.
3. **Mandatory Rust Quality Gate (`program_autofixer`):**
   * Whenever creating or modifying Solana program Rust code (`programa/src/lib.rs`), agents MUST call `program_autofixer` before returning code to the user or compiling.
   * Pass `{ code, filename: "programa/src/lib.rs", framework: "anchor" }`.
   * Apply any required fixes and invoke `program_autofixer` again in a loop until `require_another_tool_call_after_fixing` returns `false`.
4. **Architectural & Tooling Defaults (`.agents/skills/solana-dev`):**
   * Consult `.agents/skills/solana-dev/SKILL.md` for ecosystem standards: Anchor 1.2.x on-chain, `@solana/kit` and Codama generated clients, and prefixing CLI invocations with `NO_DNA=1` to disable interactive TUIs and progress bars.

---

## 4. Browser & UI Verification Patterns

Agents verifying browser functionality must use the patterns established in `docs/PRUEBAS-AUTOMATIZADAS.md`:

### 1. Coordinated Observation (Node CLI + Chrome DevTools MCP)
* Run the backend script with the paused flag:
  ```bash
  DEVNET_EXPECTED_AUTHORITY=<pubkey> fnm exec --using=24 node --import tsx tests/dia5-devnet.ts --pausar
  ```
* At each pause checkpoint (`previo-a-rechazo`, `post-rechazo`), use Chrome DevTools MCP (`navigate_page`, `fill`, `click`, `take_snapshot`) to query public account state and verify UI rendering.
* Do not inject private keys into the browser.

### 2. Interactive Wallet Standard Testing (No Extensions Required)
* Use the Wallet Standard registration event (`wallet-standard:app-ready`) injected via `initScript` in `navigate_page`.
* For signature tests, route signing requests through an ephemeral local Node bridge that holds the external test keypair, validates compiled transaction instructions against expected PDAs and blockhash, and partial-signs outside the page.
* Clean up by navigating test tabs to `about:blank` and terminating only the temporary Vite and Node processes.

---

## 5. Documentation Lifecycle

Documentation files must be created or updated only when an explicit trigger occurs. Never scaffold documentation preemptively.

### Core Files
* **`README.md`:** Human-facing onboarding, Codespaces guide, project purpose, and local setup. Update when user-facing setup, interfaces, or commands change.
* **`AGENTS.md`:** Agent-facing rules, technical constraints, security policies, and verification steps. Single source of truth for AI agents.

### Lifecycle Documents

| Document Type | Purpose | Exact Trigger | Minimum Required Content | Explicit Non-Trigger |
| :--- | :--- | :--- | :--- | :--- |
| **`docs/adr/0001-*.md`** | Record architectural decisions with trade-offs. | A consequential, durable design decision with meaningful alternatives is adopted. | Context, options considered, chosen decision, consequences, review criteria. | Routine implementation details or minor refactorings. |
| **`docs/research/YYYY-MM-DD-*.md`** | Material research findings. | An investigation materially changes or justifies a design, dependency, or security decision. | Problem investigated, dated sources, findings, decision impact, links to ADR. | Scratch notes, command logs, or exploratory research without durable impact. |
| **`CHANGELOG.md`** | Human-curated release notes. | The repository publishes versioned releases or public tags. | `Unreleased` section, semver versions, curated categories (Added, Changed, Fixed, Security). | Unfiltered Git commit dumps. |
| **`docs/architecture.md`** | System architecture & boundary map. | System has multiple interacting tiers or external boundaries not obvious from code alone. | Tier diagram, account PDA models, data flow invariants, external boundaries, links to ADRs. | Codebases where architecture is self-evident in 1-2 files. |
| **`docs/runbooks/<operation>.md`** | Step-by-step operational runbook. | A recurring, risky operational task (deployment, rotation, recovery) must work under time pressure. | Trigger, prerequisites, step-by-step commands, expected outputs, rollback/escalation. | Routine developer commands or non-risky npm scripts. |
| **`SECURITY.md`** | Vulnerability disclosure policy. | Repository is public, distributed as software, or processes sensitive production data. | Supported versions, private reporting channel, expected response timeframe, disclosure policy. | Repositories without a monitored private disclosure channel. |
| **`ROADMAP.md`** | Stable, public direction. | Maintainers want to communicate forward-looking milestone directions to users. | Outcome-oriented goals, milestones, non-commitments. | Daily task lists, private issue tracker mirrors. |

### Documentation Guardrails
* Prefer lowercase `docs/` directories.
* Do not create `HISTORY.md` (use Git history for commits; `CHANGELOG.md` for releases).
* Cross-link related ADRs, architecture docs, and runbooks instead of duplicating text.
* When a trigger is met during an implementation task, commit documentation updates in the same atomic changeset and verify all links.
