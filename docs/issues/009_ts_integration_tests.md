# Issue #009: TS Integration Tests

## Overview

Implement end-to-end integration tests in TypeScript to verify on-chain workflows, account permissions, and program errors.

## Description

After verifying the core logic with Rust unit tests, we need to verify the full lifecycle of the application using the TypeScript client. This ensures that the program behaves as expected when interacting with the Solana network and the Light Protocol compression system.

## Plan

### 1. Event Management

- `Manage Event`: Verify `update_event` correctly updates resale caps and royalty BPS.
- `Access Control`: Verify that a non-authority signer **fails** to update the event.

### 2. Minting Constraints

- `Supply Enforcement`: Create an event with `Supply: 1`, mint 1 ticket, then attempt to mint a 2nd ticket (should **fail**).

### 3. Transfer & Trading Rules

- `Resale Cap Enforcement`: Attempt to transfer a ticket with a `resalePrice` higher than allowed (should **fail**).
- `Ownership Security`: Attempt to transfer a ticket signed by the wrong keypair (should **fail** proof verification).
- *(Optional)* `Royalty Payouts`: Verify that the event authority's SOL balance increases by the royalty amount after a transfer.

## Files to Modify

| File | Change |
|------|--------|
| `tests/encore.ts` | Add new `it` blocks for the scenarios above |

## Success Criteria

- All integration tests pass with `anchor test`.
- Tests accurately reflect successful and failed scenarios (verifying error codes).
- Integration with the `surfpool` and compression trees works correctly.
