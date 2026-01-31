# Issue #016: Codama Kit Migration

## Status

**Current State:** Hybrid Implementation (90% Complete for Client App)
**Progress:** Near Completion (Client App Functional)

## Objectives

- Replace manual instruction definitions with Codama-generated client.
- Adopt `@solana/kit` (Web3.js v2) types where possible.
- Maintain compatibility with existing Anchor Provider/Wallet for now (Hybrid approach).

## Completed Tasks

- [x] **Dependencies:** Installed `@solana/kit`, `@codama/nodes-from-anchor`, `@codama/renderers`.
- [x] **Client Generation:** Created `scripts/create-codama-client.ts`. Client generates to `app/src/client`.
- [x] **Adapter Layer:** Created `app/src/lib/services/adapter.ts` to bridge V2 types (Address, Instruction) to V1 types (PublicKey, TransactionInstruction).
- [x] **Service Migration (`encore.ts`):**
  - `createEvent` -> Migrated to `getCreateEventInstruction`.
  - `createListing` -> Migrated to `getCreateListingInstruction`.
  - `claimListing` -> Migrated to `getClaimListingInstruction`.
  - `cancelListing` -> Migrated to `getCancelListingInstruction`.
  - `mintTicket` -> Remained on Anchor (complex partial signers/remaining accounts) but fixed Light Protocol writability issues.
- [x] **Account Fetching (Single):**
  - `fetchEvent` -> Migrated to Codama `fetchEventConfig` decoder.
  - `fetchListing` -> Migrated to Codama `fetchListing` decoder.
  - Added standalone `rpc` (`@solana/kit`) to `EncoreClient`.
- [x] **Type Corrections:**
  - Updated `EventConfig` and `Listing` interfaces to use native `bigint` (matching Codama).
  - Mapped Anchor `BN` types to `bigint` in GPA fetchers.
  - Updated UI (`EventDetail.tsx`, `Home.tsx`) to handle `bigint` values correctly.
- [x] **Fixes:**
  - Enabled V2 feature flag in `light.ts` for address tree compatibility.
  - Fixed Light Protocol state tree writability in `mintTicket` (forced `isWritable: true`).

## Remaining / Open Items

- [ ] **Account Fetching (Bulk/GPA):** `fetchAllEvents` and `fetchAllListings` still use Anchor's `program.account...all()`. This is low priority as it works fine.
- [ ] **Transaction Signing:** Currently converting V2 instructions back to V1 (`toV1Instruction`) to use `provider.sendAndConfirm`. Full V2 signing requires waiting for Wallet Adapter ecosystem updates.
- [ ] **Tests:** `tests/encore.ts` still uses full Anchor. This is acceptable for integration tests.

## Technical Notes

- **Hybrid Approach:** We successfully mix Anchor (for complex transaction sending/wallets) and Codama (for type-safe instruction building and account decoding).
- **BigInt Handling:** We fully adopted `bigint` in the `EncoreClient` interface, mapping legacy `BN` types from Anchor where necessary.
