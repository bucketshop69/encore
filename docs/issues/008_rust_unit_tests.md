# Issue #008: Rust Unit Tests

## Overview

Implement comprehensive unit tests for `EventConfig` logic to verify math, bounds checking, and business rules in isolation.

## Description

We need to ensure the core business logic in Rust is robust before relying on integration tests. This involves testing the `EventConfig` methods for minting eligibility, royalty calculations, and resale price enforcement.

## Plan

### 1. Supply Logic (`can_mint`)

- `test_can_mint_success`: Verify `true` when `tickets_minted + amount < max_supply`.
- `test_can_mint_exact_limit`: Verify `true` when reaching exactly `max_supply`.
- `test_can_mint_exceeded`: Verify `false` when attempting to mint beyond `max_supply`.
- `test_can_mint_overflow`: Ensure integer overflow is handled safely.

### 2. Royalty Calculations (`calculate_royalty`)

- `test_royalty_basic`: Verify standard calculation (e.g., 5% of 100 SOL).
- `test_royalty_zero`: Verify 0% royalty logic.
- `test_royalty_100_percent`: Verify 100% royalty logic.

### 3. Resale Cap Logic (`calculate_max_resale_price`)

- `test_resale_cap_calculation`: Verify correct max price based on `resale_cap_bps`.
- `test_resale_check_valid`: Verify `is_valid_resale_price` returns `true` for valid amounts.
- `test_resale_check_invalid`: Verify `is_valid_resale_price` returns `false` for amounts exceeding the cap.

## Files to Modify

| File | Change |
|------|--------|
| `programs/encore/src/state/event_config.rs` | Add `#[cfg(test)]` module with unit tests |

## Success Criteria

- All unit tests pass with `cargo test`.
- Edge cases like overflow and exact limits are covered.
