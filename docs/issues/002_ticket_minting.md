# Issue #002: Private Ticket Minting

## Overview

Implement **privacy-preserving** compressed ticket creation using Light Protocol. Ticket ownership and pricing must be hidden from public viewers but verifiable by the protocol.

## Privacy Requirements (from README)

> "Ticket ownership and resale prices are hidden from public viewers but verifiable by the protocol."
> "Users submit ZK Proofs to transition state (e.g., 'I own Ticket #42 and am selling it')."

This means:
- ❌ Cannot store `owner: Pubkey` in plaintext
- ❌ Cannot store `purchase_price: u64` in plaintext  
- ✅ Must use cryptographic commitments
- ✅ Must support ZK proof verification

## What's PUBLIC vs PRIVATE

| Data | Visibility | Reason |
|------|------------|--------|
| Event rules (cap, royalty) | PUBLIC | Organizers want rules visible |
| Ticket exists with ID #N | PUBLIC | Needed for indexing |
| Original mint price | PUBLIC | Needed for resale cap math |
| **Current owner** | **PRIVATE** | Core privacy feature |
| **Resale price** | **PRIVATE** | Core privacy feature |

## Technical Approach

### PrivateTicket Structure

```rust
pub struct PrivateTicket {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub owner_commitment: [u8; 32],    // Poseidon(owner_pubkey, secret, nonce)
    pub price_commitment: [u8; 32],    // Pedersen(price, blinding) or just encrypted
    pub original_price: u64,           // Public for resale cap enforcement
}
```

### Owner Commitment

The `owner_commitment` hides who owns the ticket:

```
owner_commitment = Poseidon(owner_pubkey, secret)
```

- `owner_pubkey`: The actual owner's public key
- `secret`: Random value known only to owner (generated at mint)
- Only the owner can produce a valid ZK proof without revealing their identity

### Privacy During Minting

```
Organizer                           Recipient
    │                                   │
    │   "Give me your commitment"       │
    │ ─────────────────────────────────>│
    │                                   │
    │   commitment = Hash(pubkey, secret)
    │ <─────────────────────────────────│
    │                                   │
    │   mint_ticket(commitment)         │
    │                                   │
```

The organizer never sees the recipient's secret - only the commitment.

### Privacy During Transfer

When transferring, the seller:
1. Proves they own the ticket (ZK proof of commitment preimage)
2. Reveals a **nullifier** to prevent double-spending
3. Provides the buyer's new commitment

```
nullifier = Poseidon(ticket_id, secret)
```

The nullifier is stored as a compressed PDA to prevent reuse.

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `state/ticket.rs` | `PrivateTicket` struct with commitments |
| `instructions/ticket_mint.rs` | Accept commitment, store in Merkle tree |
| `lib.rs` | Export new instruction |
| `errors.rs` | Add commitment-related errors |

## Minting Flow

1. Recipient generates: `secret` (random bytes)
2. Recipient computes: `commitment = Poseidon(pubkey, secret)`
3. Recipient sends `commitment` to organizer
4. Organizer calls `mint_ticket(event_config, commitment, price)`
5. Program creates `PrivateTicket` with commitment (not pubkey)
6. Program emits `TicketMinted` event (with commitment, not owner)

## Why This Matters

This approach ensures:
- **No one** (indexers, observers) can see who owns tickets
- **Only the owner** can prove ownership via ZK proof
- **Resale caps** are still enforceable via range proofs
- **Double-spending** is prevented via nullifiers

## Dependencies

- Issue #001 (EventConfig) ✅
- `light-poseidon` crate for hashing
- `light-sdk` for compressed accounts

## Next Steps

After private minting works:
- Issue #003: Private Transfer (ZK proof + nullifier creation)
- Issue #004: Resale price proofs (range proofs for cap enforcement)

## References

- [Light Protocol ZK-ID](https://github.com/Lightprotocol/program-examples/tree/main/zk/zk-id)
- [Light Protocol Nullifiers](https://github.com/Lightprotocol/program-examples/tree/main/zk/zk-nullifier)
- [Poseidon Hash](https://docs.rs/light-poseidon)
