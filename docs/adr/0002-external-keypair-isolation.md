# ADR 0002: Strict Keypair Isolation and External Path Enforcement

## Status
Accepted

## Context
Deploying and verifying programs on Solana Devnet requires a funded authority keypair. In educational repositories, students and automated tools frequently risk committing keypair files (e.g., `id.json` or `*-keypair.json`) or embedding base58 private keys directly in scripts, leading to secret leaks and compromised accounts.

## Options Considered

1. **Environment Variable Secret Keys (`PRIVATE_KEY="[1,2,3...]" / base58`):**
   * *Pros:* Common in web services.
   * *Cons:* Easily logged in process tables (`ps aux`), CI shell transcripts, or crash stack traces; prone to accidental exposure in shell history.
2. **Local Keypairs Inside Repository Root (e.g. `./keys/test-keypair.json`):**
   * *Pros:* Easy relative path resolution.
   * *Cons:* High risk of accidental `git add` and permanent inclusion in Git history.
3. **Mandatory External Filesystem Paths with Code Guardrails (`assertExternalPath`):**
   * *Pros:* Scripts programmatically enforce that keypaths resolve outside the repository tree (`realpathSync()`). If a user attempts to pass a path inside the repo, the script aborts immediately. `.gitignore` provides a second defensive layer (`*-keypair.json`).
   * *Cons:* Users must configure or link an external keypair in `~/.config/solana/`.

## Decision
Adopt **Option 3: Mandatory External Filesystem Paths**.
* `tests/dia5-devnet.ts` and `scripts/desplegar-devnet.mjs` implement `assertExternalPath(rawPath, repoRoot)`:
  * Expands `~` to user home.
  * Resolves symlinks and canonical paths.
  * Asserts relative path starts with `..` (strictly external to repo root).
* `.gitignore` explicitly ignores `*-keypair.json`.
* `DEVNET_EXPECTED_AUTHORITY` ensures that in `tests/dia5-devnet.ts`, even with a valid external keypair, the test will not broadcast transactions from an unintended public authority (and `scripts/desplegar-devnet.mjs` checks against existing deployment authority and external `DEVNET_PROGRAM_KEYPAIR`).

## Consequences
* **Positive:**
  * Zero risk of committing private keys to source control.
  * Explicit fail-closed behavior before requesting airdrops or signing transactions.
* **Negative:**
  * Requires setting up `~/.config/solana/registro-devnet-tester-keypair.json` before running Devnet scripts.
* **Review Criteria:**
  * Revisit if Solana introduces a standardized, OS-level secure keychain CLI for headless developer automation.
