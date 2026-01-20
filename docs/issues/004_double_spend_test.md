# Issue #004: Double-Spend Prevention Test

## Overview

Add explicit integration test demonstrating nullifier prevents double-spending attacks.

## Description

While nullifier protection is implemented and working, we need a test that explicitly shows the security guarantee: **attempting to transfer the same ticket twice should fail**.

## Current State

✅ Nullifier created on first transfer
❌ No test showing second transfer attempt fails

## Test Scenario

```rust
#[tokio::test]
async fn test_double_spend_prevention() {
    // 1. Mint ticket to Alice
    // 2. Transfer: Alice → Bob ✅ SUCCESS
    // 3. Try again: Alice → Carol ❌ SHOULD FAIL
    //    Error: Nullifier already exists
}
```

## Expected Behavior

- First transfer creates nullifier and succeeds
- Second transfer with same seller secret fails
- Error: Custom error indicating nullifier already exists

## Technical Details

The test should:

1. Use the same `seller_pubkey` and `seller_secret` twice
2. Expect the second call to fail
3. Verify the error is related to nullifier existence

## Files to Modify

- `programs/encore/tests/integration.rs` - Add new test

## Success Criteria

- Test passes showing double-spend is prevented
- Demonstrates security guarantee to judges
- Error message is clear about nullifier

## Priority

**HIGH** - Critical for hackathon demo (shows security works)

## Estimated Time

10-15 minutes
