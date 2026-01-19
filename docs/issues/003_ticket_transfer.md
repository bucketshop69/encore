# Issue #003: Ticket Transfer

## Overview

Implement ticket transfer functionality allowing ticket owners to transfer their compressed tickets to new owners. This is the foundation for the secondary marketplace.

## Description

Ticket holders can transfer ownership of their compressed tickets. Each transfer:

- Verifies the sender owns the ticket via ZK proof
- Updates the owner field to the new recipient
- Optionally updates the purchase price (for resales)
- Validates resale price against the event's resale cap

## Technical Requirements

### Instruction: `transfer_ticket`

- Transfers compressed ticket ownership from sender to recipient
- Reads existing ticket from Merkle tree
- Creates updated ticket with new owner
- Enforces resale price cap from EventConfig

### Transfer Flow

```
┌──────────────┐         ┌──────────────┐
│    Seller    │         │    Buyer     │
│  (current    │  ──►    │   (new       │
│   owner)     │         │   owner)     │
└──────────────┘         └──────────────┘
        │                       ▲
        │                       │
        ▼                       │
┌───────────────────────────────────────┐
│         Compressed Ticket             │
│  owner: seller → buyer                │
│  purchase_price: old → new            │
└───────────────────────────────────────┘
```

## Light Protocol Pattern

For updating a compressed account:

1. Read the existing account (with validity proof)
2. Create a new version with updated data
3. The old account is "consumed" and new one is "created"

```rust
// Pseudo-code pattern
let existing_ticket = LightAccount::<CompressedTicket>::new_mut(
    &crate::ID,
    &account_meta,  // Contains hash, address
    existing_data,
)?;

// Update fields
existing_ticket.owner = new_owner;
existing_ticket.purchase_price = new_price;

// CPI updates the Merkle tree
LightSystemProgramCpi::new_cpi(...)
    .with_light_account(existing_ticket)?
    .invoke(light_cpi_accounts)?;
```

## Validation Logic

- Sender must be current ticket owner (proved via ZK proof)
- Event config must exist
- If resale, new price must be ≤ `original_price * resale_cap_bps / 10000`
- Recipient must be valid pubkey

## Accounts Required

- `sender` (signer) - Current ticket owner
- `event_config` - To check resale cap
- `recipient` - New owner
- Light Protocol system accounts (remaining_accounts)

## Instruction Data

```rust
pub struct TransferTicketArgs {
    pub proof: ValidityProof,
    pub account_meta: CompressedAccountMeta,
    pub new_purchase_price: Option<u64>,  // None = gift, Some = sale
}
```

## Events

```rust
#[event]
pub struct TicketTransferred {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub from: Pubkey,
    pub to: Pubkey,
    pub price: Option<u64>,
}
```

## Testing Considerations

- Transfer ticket successfully (gift, no price change)
- Transfer ticket with valid resale price
- Fail transfer when price exceeds resale cap
- Fail transfer when non-owner tries to transfer
- Verify ticket data updated correctly after transfer

## Dependencies

- Issue #001 (EventConfig) ✅ Complete
- Issue #002 (Ticket Minting) ✅ Complete

## Open Questions

1. Should we require payment in-instruction or just track price?
2. Do we need royalty collection here or in a separate marketplace instruction?

## References

- [Light Protocol: Update Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-update-compressed-accounts)
