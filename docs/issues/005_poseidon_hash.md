# Issue #005: Poseidon Hash Migration (ZK-Friendly)

## Overview

Replace SHA256 with Poseidon hash for ZK-friendly commitments and nullifiers.

## Description

**Current**: Using SHA256 for owner commitments
**Problem**: SHA256 is expensive in ZK circuits (~20,000 constraints)
**Solution**: Use Poseidon hash (~150 constraints) - **133x more efficient**

## Why This Matters

- Poseidon is **native to zero-knowledge proofs**
- Shows deep understanding of ZK cryptography
- Future-proof for Groth16 proof integration
- **Judge impact**: "They used Poseidon! They understand real ZK!"

## Technical Approach

### Current Implementation

```rust
use anchor_lang::solana_program::hash::hash;

let commitment = hash(&[owner_pubkey, secret]).to_bytes(); // SHA256
```

### New Implementation

```rust
use light_hasher::Poseidon;

let commitment = Poseidon::hashv(&[
    owner_pubkey.as_ref(),
    &secret,
])?;
```

## Files to Modify

| File | Change |
|------|--------|
| `instructions/ticket_mint.rs` | Update commitment calculation |
| `instructions/ticket_transfer.rs` | Update commitment verification |
| `tests/integration.rs` | Update test helper `compute_owner_commitment()` |

## Migration Steps

1. Update `compute_owner_commitment()` in tests to use Poseidon
2. Update `ticket_mint.rs` (comments only - clients compute commitment)
3. Update `ticket_transfer.rs` to verify with Poseidon
4. Run all tests to ensure compatibility
5. Update documentation/comments

## Dependencies

Already available: `light-hasher = { version = "5.0.0", features = ["solana"] }`

## Breaking Changes

⚠️ **Yes** - Commitments computed with SHA256 will not work with Poseidon.
Since this is hackathon/devnet, acceptable to change.

## Success Criteria

- All tests pass with Poseidon hash
- Commitment verification works correctly
- Documentation updated

## Priority

**HIGH** - Significant judge impact for minimal effort

## Estimated Time

30-45 minutes
