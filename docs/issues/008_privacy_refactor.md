# Issue #008: Privacy Architecture Refactor - Simplified Burn+Create Model

## ⚠️ SUPERSEDED BY ISSUE #009

**This issue has been replaced by [Issue #009: Commitment + Nullifier Privacy Model](./009_commitment_nullifier_model.md)**

The burn+create approach failed on devnet due to Light Protocol indexer limitations with burns/mutations. Issue #009 implements a CREATE-only model using commitments and nullifiers which works reliably on devnet.

---

## Implementation Status (Archived)

### ✅ Completed (before superseded)

- [x] Random UTXO Model for tickets (using random `address_seed`)
- [x] Buyer/Event Owner separation (any user can purchase tickets)
- [x] Deterministic address derivation for tickets
- [x] Compute budget optimization (1M units for ZK operations)

### ❌ Not Implemented (superseded)

- [ ] ~~Simplified mint (CREATE only, no identity counter)~~ → See #009
- [ ] ~~Transfer instruction (BURN + CREATE pattern)~~ → See #009 (nullifier pattern)
- [ ] ~~Resale price cap enforcement~~ → Future

### 📋 Pending (moved to #009)

- [ ] ~~Double-spend prevention testing~~ → Completed in #009
- [ ] ~~Check-in protocol design~~ → Future
- [ ] ~~Client-side seed management strategy~~ → Completed in #009

## Overview

Refactor the ticketing architecture to use a **"Burn+Create Model"** that avoids compressed account mutations entirely. This sidesteps the Light Protocol devnet indexer limitation where mutations fail due to stale Merkle proofs.

## The Problem

### Original Problem

Ticket addresses derived from Ticket ID (`address = derive(event, ticket_id)`) are **public and static**, leaking transaction history.

### New Problem (Indexer Limitation)

Light Protocol's devnet indexer cannot re-index updated state fast enough:

- First mint (new account creation) ✅ works
- Mutations ❌ fail - indexer returns stale Merkle tree snapshots
- Even 45+ second waits don't help
- Confirmed by Light Protocol team as a known devnet limitation

## The Solution

### Design Principle: No Mutations

**All compressed account operations are either CREATE or BURN - never UPDATE.**

This works because:

| Operation | Proof Needed | Depends On |
|-----------|--------------|------------|
| CREATE | "Address doesn't exist" | Address tree (pre-tx) |
| BURN | "Account exists at hash H" | State tree (pre-tx) |

Both proofs are generated **before** the transaction executes. Neither depends on the other, so no indexer race conditions.

### 1. The "Random UTXO" (The Ticket)

The Ticket lives at a **Random Address** known only to the owner.

- **Minting**: User generates a random `address_seed`. Program CREATEs `PrivateTicket` at `derive(address_seed)`.
- **Transfer**: BURN ticket at `OldAddress`, CREATE new ticket at `NewAddress` (same transaction).
- **Privacy**: Ephemeral keys hide owner identity. Transfer chain is visible but owner identities are not.

### 2. No Identity Counter (Simplified)

**Decision:** Remove spam prevention (`max_tickets_per_person`) for hackathon simplicity.

**Rationale:**

- Identity counters require mutations (increment on subsequent mints)
- Mutations don't work on devnet
- Spam prevention can be added later via regular Solana PDAs if needed

**Trade-off:** Anyone can mint unlimited tickets. Acceptable for hackathon demo.

## Client-Side Strategy (Seed Management)

To avoid forcing users to backup random seeds for every ticket, the client should use **Deterministic Derivation**:

- **Master Seed**: `Signature(User_Wallet, "Encore Ticket Master Seed")`
- **Ticket Seed (Minting)**: `Hash(Master_Seed, Event_ID, Counter_Index)`
- **Recovery**: Client can re-scan the tree at these deterministic addresses to find owned tickets.
- **Transfer Seed**: When transferring, the recipient provides a new random seed (or their own deterministic one).

## Privacy Guarantees

**What is Private:**

- Ticket owner identity (ephemeral keys, not linked to main wallet on-chain)
- Which specific ticket ID a user owns

**What is NOT Private (Acceptable for Hackathon):**

- Transfer chain is visible: `addr_A → addr_B → addr_C` (same-tx burn+create links addresses)
- That *a* transfer occurred (event logs show generic transfer)
- Timing correlation between burn and create

**Future Phase 2 (Full Privacy):**

- ZK nullifier-based transfers to break address linkability
- Requires Circom circuit development

## Open Questions / Future Work

1. **Full Unlinkability**: Implement ZK nullifier circuit to break transfer chain visibility (Phase 2).
2. **Spam Prevention**: Add regular Solana PDA-based counters if needed post-hackathon.
3. **Check-In Protocol**: How does venue verify ticket ownership without revealing identity? (Likely ZK Proof of Membership).

## Implementation Plan

### `instructions/ticket_mint.rs` - SIMPLIFIED

**Goal:** CREATE compressed ticket only. No identity counter.

```rust
pub fn mint_ticket(
    ctx: Context<MintTicket>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    owner: Pubkey,                    // Buyer's ephemeral pubkey
    purchase_price: u64,
    ticket_address_seed: [u8; 32],    // Random seed from client
) -> Result<()> {
    // 1. Derive ticket address from random seed
    // 2. CREATE compressed PrivateTicket
    // 3. Increment EventConfig.tickets_minted
    // 4. Emit TicketMinted event
}
```

**Key Changes from Previous:**

- ❌ Remove identity counter logic entirely
- ❌ Remove `identity_address_tree_info` parameter
- ❌ Remove `identity_account_meta` parameter
- ❌ Remove `current_tickets_minted` parameter
- ✅ Single compressed account creation (ticket only)

### `instructions/ticket_transfer.rs` - BURN + CREATE

**Goal:** BURN old ticket, CREATE new ticket in same transaction.

```rust
pub fn transfer_ticket(
    ctx: Context<TransferTicket>,
    proof: ValidityProof,
    // For BURN (existing ticket)
    burn_account_meta: CompressedAccountMeta,
    current_ticket_id: u32,
    current_original_price: u64,
    // For CREATE (new ticket)
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    new_owner: Pubkey,                // Buyer's ephemeral pubkey
    new_address_seed: [u8; 32],       // Random seed for new address
    resale_price: Option<u64>,        // For cap enforcement
) -> Result<()> {
    // 1. Verify seller owns ticket (ephemeral key signature)
    // 2. Check resale price cap if applicable
    // 3. BURN old ticket (LightAccount::new_burn)
    // 4. CREATE new ticket at new random address (LightAccount::new_init)
    // 5. Emit TicketTransferred event
}
```

**Key Points:**

- Uses `new_burn()` for old ticket (no output state)
- Uses `new_init()` for new ticket (fresh address)
- Both in same CPI call - atomic
- No mutations = no indexer issues

### `state/identity_counter.rs` - REMOVED

**Decision:** Remove `IdentityCounter` struct entirely. Not needed in simplified model.

### `errors.rs` - SIMPLIFIED

Keep only relevant errors:

- ✅ `InvalidTicket` - Ticket validation failed
- ✅ `ExceedsResaleCap` - Resale price too high
- ✅ `InvalidAddressTree` - Wrong address tree used
- ❌ Remove `MaxTicketsPerPersonReached` - No longer enforced

## Testing Strategy

### Test Cases

1. **✅ Mint Ticket**
   - Generate random `address_seed`
   - CREATE compressed ticket at derived address
   - Verify ticket exists with correct data
   - Verify `EventConfig.tickets_minted` incremented

2. **📋 Transfer Ticket (BURN + CREATE)**
   - Mint ticket at `addr_A` with `owner = ephemeral_key_1`
   - Transfer: seller signs with `ephemeral_key_1`
   - BURN ticket at `addr_A`
   - CREATE ticket at `addr_B` with `owner = ephemeral_key_2`
   - Verify `addr_A` no longer exists (burned)
   - Verify `addr_B` exists with same `ticket_id`, new `owner`

3. **📋 Double-Spend Prevention**
   - Mint ticket at `addr_A`
   - Transfer to `addr_B` (Success)
   - Try to transfer `addr_A` again → **Fail** (account burned/nullified)

4. **📋 Resale Cap Enforcement**
   - Mint ticket with `original_price = 100`
   - Event has `resale_cap_bps = 15000` (150%)
   - Transfer with `resale_price = 150` → Success
   - Transfer with `resale_price = 151` → Fail (`ExceedsResaleCap`)

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        MINT FLOW                            │
├─────────────────────────────────────────────────────────────┤
│  Buyer generates: ephemeral_keypair + random_seed           │
│                          ↓                                  │
│  CREATE PrivateTicket at derive(random_seed)                │
│    - owner: ephemeral_pubkey                                │
│    - ticket_id: incremented                                 │
│    - original_price: purchase_price                         │
│                          ↓                                  │
│  Increment EventConfig.tickets_minted                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      TRANSFER FLOW                          │
├─────────────────────────────────────────────────────────────┤
│  Seller signs with ephemeral_key (proves ownership)         │
│  Buyer provides: new_ephemeral_pubkey + new_random_seed     │
│                          ↓                                  │
│  BURN old ticket at addr_A                                  │
│                          ↓                                  │
│  CREATE new ticket at derive(new_random_seed)               │
│    - owner: buyer's ephemeral_pubkey                        │
│    - ticket_id: SAME (preserved)                            │
│    - original_price: SAME (for resale cap)                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    WHY THIS WORKS                           │
├─────────────────────────────────────────────────────────────┤
│  ✅ No mutations → No indexer timing issues                 │
│  ✅ CREATE proofs: "address doesn't exist" (pre-tx state)   │
│  ✅ BURN proofs: "account exists at hash" (pre-tx state)    │
│  ✅ Both independent → Can be in same transaction           │
│  ✅ Works on devnet!                                        │
└─────────────────────────────────────────────────────────────┘
```

## Privacy Model

| Aspect | Status | Notes |
|--------|--------|-------|
| Owner Identity | ✅ Hidden | Ephemeral keys, not linked to main wallet |
| Ticket Location | ✅ Random | Derived from random seed |
| Transfer Chain | ⚠️ Visible | Same-tx burn+create links addresses |
| Mint Activity | ✅ Hidden | No identity counter to reveal participation |

**Phase 2 Enhancement:** ZK nullifier circuit to break transfer chain linkability.
