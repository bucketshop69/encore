# Issue #008: Privacy Architecture Refactor - Random UTXO & Identity Counters

## Overview

Refactor the ticketing architecture to move from a "Linked Account Model" (where Ticket #5 is always at one address) to a **"Random UTXO Model"**. This is required to satisfy the core requirement: "Observers cannot track which specific ticket was traded, only that a trade occurred."

## The Problem

Currently, the ticket address is derived from the Ticket ID:
`address = derive(event, ticket_id)`

This makes the ticket location **public and static**. When a transfer occurs, observers see the account at this specific address change owner. This leaks the transaction history of the asset.

## The Solution

### 1. The "Random UTXO" (The Ticket)

The Ticket itself must live at a **Random Address** known only to the owner.

* **Minting**: User generates a random `address_seed`. Program mints `PrivateTicket` at `derive(address_seed)`.
* **Transfer**: User "spends" the ticket at `OldAddress` and creates a new one at `NewAddress`.
* **Privacy**: Observers see one account burn and another created. There is no mathematical link between them.

### 2. The "Identity Counter" (The Limit Enforcer)

To enforce "Max N Tickets Per Person" without leaking the Ticket's location, we use a separate "Identity Counter" account.

* **Behavior**: Tracks "Tickets Minted Ever". Does not decrement on transfer.
* **Address**: Derived deterministically from `Hash(Event_ID, User_ID)`.
* **Data**: Stores `tickets_minted` count.
* **Mint Logic**:
    1. Check if `IdentityAccount` exists.
    2. If No: Create it with count = 1.
    3. If Yes: Load it. If `count < limit`, increment it. Else, fail.
* **Privacy Trade-off**: Minting reveals *that* a user participated (acceptable for spam prevention), but does NOT reveal *which* ticket they got (because the Ticket is at a random address).

## Client-Side Strategy (Seed Management)

To avoid forcing users to backup random seeds for every ticket, the client should use **Deterministic Derivation**:

* **Master Seed**: `Signature(User_Wallet, "Encore Ticket Master Seed")`
* **Ticket Seed (Minting)**: `Hash(Master_Seed, Event_ID, Counter_Index)`
* **Recovery**: Client can re-scan the tree at these deterministic addresses to find owned tickets.
* **Transfer Seed**: When transferring, the recipient provides a new random seed (or their own deterministic one).
* **Edge Case - Received Tickets**:
  * When a user RECEIVES a transferred ticket, the seed is chosen by the sender (or negotiated).
  * Client must store this externally-provided seed locally.
  * Recovery for these tickets involves checking stored seeds or potentially implementing an encrypted on-chain inbox (future work).

## Privacy Guarantees

**What is Private:**

* Which specific ticket ID a user owns.
* Transfer history of individual tickets (Assets move from random `Addr_A` to `Addr_B`).
* Double-spend protection (via Nullifiers).

**What is NOT Private:**

* That a user (Wallet X) minted tickets for Event Y (via visible IdentityCounter).
* How many tickets a user *originally* minted.

* That *a* transfer occurred (event logs show generic transfer).
* Resale prices (if emitted in events).
* Timing correlation: If Ticket A disappears and Ticket B appears simultaneously, observers may infer (but cannot prove) they are the same ticket transferring. Same for rapid sequential transfers.

## Open Questions / Future Work

1. **Counter Reset**: Should event organizers be able to reset user counters? (Currently "Minted Ever" anti-scalping logic).
2. **Encrypted Indexing**: Can we build an encrypted index so users don't need to scan the tree?
3. **Check-In Protocol**: How does venue verify ticket ownership without revealing identity? (Likely ZK Proof of Membership).

## Implementation Plan

### `instructions/ticket_mint.rs`

1. **Input**: Add `ticket_address_seed` (random 32 bytes) as instruction argument.
2. **Logic**:
    * Derive/Update `IdentityCounter` (at deterministic address).
    * Create `PrivateTicket` (at random address derived from `ticket_address_seed`).
    * Store `owner` (Ephemeral Key) inside the encrypted `PrivateTicket` data.

### `instructions/ticket_transfer.rs`

1. **Input**: Add `new_address_seed` (random 32 bytes) for the new owner.
2. **Logic**:
    * Verify ownership (Signature of Ephemeral Key matches `PrivateTicket.owner`).
    * **Burn** (Consume) the current `PrivateTicket` account.
    * **Create** a NEW `PrivateTicket` account at `derive(new_address_seed)`.
    * Update `owner` field to new owner's Ephemeral Key.
3. **Events**:
    * Remove `ticket_id` from `TicketMinted`/`TicketTransferred` events (privacy leak).
    * Remove `owner` from events (privacy leak).
    * Keep generic metadata: `event_config`, `timestamp`.

### `errors.rs`

* Add new error variants:
  * `MaxTicketsPerPersonReached` - When user counter hits limit.
  * `TicketAlreadySpent` - When trying to use a nullified/spent ticket.

### `state.rs`

* Define `IdentityCounter` struct (Compressed Account).

    ```rust
    #[derive(LightDiscriminator)]
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct IdentityCounter {
        pub event: Pubkey,       // Validation
        pub authority: Pubkey,   // Validation (User)
        pub tickets_minted: u8,  // Count
    }
    ```

* Update `PrivateTicket` (ensure it supports the decoupling).

## Testing Strategy

This architecture MUST be verified with Rust integration tests (`tests/integration.rs`).

**Test Cases:**

1. **Minting**:
    * Mint Ticket A with `Seed_A`. Verify it exists.
    * Mint Ticket B with `Seed_B`. Verify it exists.
    * Verify `IdentityCounter` for user is now 2.
2. **Limit Enforcement**:
    * Set max limit to 1.
    * Mint Ticket A -> Success.
    * Mint Ticket B -> Fail (`EncoreError::MaxTicketsExceeded`).
3. **Private Transfer (Resale)**:
    * Mint Ticket at `Addr_A`.
    * Transfer to `Addr_B`.
    * **Assert**: Nullifier for `Addr_A` exists (marked spent).
    * **Assert**: Account at `Addr_B` exists with correct data (Ticket ID preserved, Owner updated).
    * **Assert**: Resale Price Cap is enforced:
        * User provides `current_original_price` as instruction input.
        * Proof verifies this matches the encrypted `original_price` in the account.
        * If `resale_price > (original_price * resale_cap_bps / 10000)`, fail with `ExceedsResaleCap`.
4. **Double-Spend Prevention**:
    * Mint Ticket at `Addr_A`.
    * Transfer to `Addr_B` (Success).
    * Try to Transfer `Addr_A` again -> **Fail** (Nullifier conflict - Account spent).
