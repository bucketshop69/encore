# Issue #009: Commitment + Nullifier Privacy Model

## Overview

Replace ephemeral key model with commitment-based ownership and nullifier-based transfer. This approach uses **CREATE-only** operations, avoiding the devnet indexer issues with mutations and burns.

## Why This Change?

| Problem | Solution |
|---------|----------|
| Burns fail on devnet (writable queue issue) | Use CREATE-only: nullifier + new ticket |
| Mutations fail (indexer can't re-index fast enough) | No mutations - only CREATEs |
| Ephemeral keys still leave visible transfer chain | Commitments hide owner identity |

## Core Concepts

### Commitment (hides owner)

```
commitment = hash(owner_pubkey || secret)
```

- Stored on-chain in ticket
- Only owner can prove knowledge of preimage

### Secret (derived, not stored)

```
secret = hash(wallet_sign("ticket:" || ticket_id || event_config))
```

- User signs message with wallet
- Same message = same signature = same secret
- **User stores nothing** - regenerate anytime

### Nullifier (prevents double-spend)

```
nullifier_address = derive_address(["nullifier", hash(secret)])
```

- CREATE compressed account at this address
- If exists → ticket already spent
- Derived from secret, so unique per ticket

## Data Structures

### PrivateTicket (compressed account)

```rust
pub struct PrivateTicket {
    pub event_config: Pubkey,        // Which event
    pub ticket_id: u32,              // Ticket number
    pub owner_commitment: [u8; 32],  // hash(owner_pubkey || secret)
    pub original_price: u64,         // For resale cap (future)
}
```

### Nullifier (compressed account)

```rust
pub struct Nullifier {
    // Empty - existence is the proof
}
```

## Flows

### MINT Flow

```
CLIENT:
1. secret = hash(sign("ticket:{ticket_id}:{event_config}"))
2. commitment = hash(pubkey || secret)
3. Send commitment to mint instruction

ON-CHAIN:
4. Increment tickets_minted, get ticket_id
5. CREATE PrivateTicket with owner_commitment
```

### TRANSFER Flow

```
BUYER (off-chain):
1. new_secret = hash(sign("ticket:{ticket_id}:{event_config}"))
2. new_commitment = hash(buyer_pubkey || new_secret)
3. Send new_commitment to seller

SELLER (on-chain):
4. Call transfer_ticket(seller_secret, new_commitment)

ON-CHAIN:
5. VERIFY: hash(seller.pubkey || seller_secret) == ticket.owner_commitment
6. CREATE nullifier at hash("nullifier" || seller_secret)
7. CREATE new ticket with new_commitment (same ticket_id)
```

### VERIFY Flow (at event entry)

```
USER:
1. secret = hash(sign("ticket:{ticket_id}:{event_config}"))
2. Provide pubkey + secret to verifier

VERIFIER:
3. Compute hash(pubkey || secret)
4. Check == ticket.owner_commitment
5. Check nullifier DOES NOT exist
6. ✅ Valid entry
```

## Privacy Analysis

| Data | Visibility |
|------|------------|
| Ticket exists | Public |
| ticket_id | Public |
| original_price | Public |
| owner_commitment | Public (but meaningless without secret) |
| Owner identity | **HIDDEN** (commitment only) |
| Seller identity | Visible (signs transaction) |
| Buyer identity | **HIDDEN** (only commitment stored) |

**Trade-off:** Seller visible, buyer hidden. For full seller privacy, need ZK proof (future).

## Implementation Steps

### Step 1: Update Ticket Structure

**Files:** `state/ticket.rs`

Change:

```rust
// FROM:
pub owner: Pubkey,

// TO:
pub owner_commitment: [u8; 32],
```

**Test:** Compile only

---

### Step 2: Mint with Commitment

**Files:** `instructions/ticket_mint.rs`, `lib.rs`

Change:

- Accept `owner_commitment: [u8; 32]` instead of `owner: Pubkey`
- Store commitment in ticket

**Test:** Mint with hardcoded commitment on devnet

---

### Step 3: Client Commitment Generation

**Files:** `tests/encore.ts`

Change:

- Generate secret from wallet signature
- Compute commitment = hash(pubkey || secret)
- Use Poseidon or SHA256 (match what program uses)

**Test:** Mint with real generated commitment

---

### Step 4: Nullifier Structure

**Files:** `state/nullifier.rs`, `state/mod.rs`

Add:

```rust
#[derive(LightDiscriminator, Default)]
pub struct Nullifier {}
```

**Test:** Compile only

---

### Step 5: Transfer - Nullifier Only

**Files:** `instructions/ticket_transfer.rs`, `lib.rs`

Change:

- Accept `seller_secret: [u8; 32]`
- Verify `hash(seller.pubkey || seller_secret) == commitment`
- CREATE nullifier account

**Test:**

- Transfer creates nullifier
- Second transfer with same secret fails (nullifier exists)

---

### Step 6: Full Transfer

**Files:** `instructions/ticket_transfer.rs`

Change:

- After nullifier, CREATE new ticket with `new_commitment`
- Same ticket_id, new owner_commitment

**Test:**

- Full transfer flow
- Old owner can't transfer again
- New owner can verify ownership

---

## Hash Function Choice

| Option | Pros | Cons |
|--------|------|------|
| SHA256 | Simple, available everywhere | Not ZK-friendly |
| Poseidon | ZK-friendly, Light has it | More complex |
| Keccak256 | Common in crypto | Not ZK-friendly |

**Recommendation:** Use SHA256 for hackathon (simpler). Switch to Poseidon if adding ZK proofs later.

## Security Considerations

1. **Secret revealed on-chain during transfer** - Safe because:
   - Seller must also SIGN the transaction
   - Attacker can't use secret without seller's private key

2. **Nullifier collision** - Impossible because:
   - Secret is unique per ticket (derived from ticket_id)
   - Hash collision probability negligible

3. **Replay attack** - Prevented because:
   - Nullifier created on first transfer
   - Second transfer fails (address already exists)

## Testing Checklist

- [x] Step 1: Ticket struct compiles with commitment
- [x] Step 2: Mint creates ticket with commitment on devnet
- [x] Step 3: Client generates valid commitment
- [x] Step 4: Nullifier struct compiles
- [x] Step 5: Transfer creates nullifier, double-spend fails
- [x] Step 6: Full transfer with new commitment works

## Success Criteria

1. ✅ Mint works on devnet (CREATE only)
2. ✅ Transfer works on devnet (CREATE nullifier + CREATE ticket)
3. ✅ No burns or mutations
4. ✅ Double-spend prevented
5. ✅ Buyer identity hidden
6. ✅ User doesn't need to store secrets

## Implementation Status: ✅ COMPLETE (2026-01-30)

All tests passing on devnet with Helius RPC:

- Fresh wallet separation (buyer1, buyer2)
- Mint with commitment works
- Transfer with nullifier + new ticket works
- Seller signs transfer, buyer receives new commitment

## Future Enhancements (Post-Hackathon)

- [ ] ZK proof for seller privacy
- [ ] Resale price commitments
- [ ] Range proofs for resale cap
- [ ] Batch operations

## References

- [Light Protocol Nullifier Example](https://github.com/Lightprotocol/program-examples/tree/main/zk/zk-nullifier)
- [Light Protocol CREATE Example](https://github.com/Lightprotocol/program-examples/tree/main/anchor/create)
- Issue #002: Private Ticket Minting
- Issue #003: Private Ticket Transfer
- Issue #008: Privacy Refactor (superseded by this)
