# Issue #002: Ticket Minting with Light Protocol

## Overview

Implement compressed ticket minting using Light Protocol's ZK Compression. Organizers can mint tickets as compressed PDAs stored in a Merkle tree, enabling 10k+ tickets for <$1.

## Description

This is the first Light Protocol integration. Each ticket is a **compressed account** that:

- Links to its parent EventConfig
- Stores ownership and purchase price
- Exists off-chain in a Merkle tree (only root on-chain)
- Can be transferred via ZK proofs

## Technical Requirements

### Instruction: `mint_ticket`

- Mints a single compressed ticket to a recipient
- Validates against EventConfig's max_supply
- Increments EventConfig's tickets_minted counter
- Stores initial purchase price on the ticket

### Compressed Ticket Structure

```rust
pub struct CompressedTicket {
    pub event_config: Pubkey,    // Parent event
    pub ticket_id: u32,          // Sequential ID (1, 2, 3...)
    pub owner: Pubkey,           // Current owner
    pub purchase_price: u64,     // Last purchase price (lamports)
    pub original_price: u64,     // Initial mint price (for resale cap calc)
}
```

### Light Protocol Integration

- CPI to Light System Program for compressed account creation
- Use `light-sdk` v0.17 features already in Cargo.toml
- Compressed account address derived from [event_config, ticket_id]

## Validation Logic

- Only event authority can mint
- Cannot exceed max_supply
- Recipient must be valid pubkey
- Purchase price must be > 0

## Accounts Required

- `authority` (signer) - Event organizer
- `event_config` (mut) - To increment tickets_minted
- `recipient` - Who receives the ticket
- Light Protocol system accounts (CpiAccounts pattern)

## Events

```rust
#[event]
pub struct TicketMinted {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub owner: Pubkey,
    pub purchase_price: u64,
}
```

## Testing Considerations

- Mint single ticket successfully
- Mint up to max_supply
- Fail when exceeding max_supply
- Fail when non-authority tries to mint
- Verify ticket data stored correctly

## Dependencies

- Issue #001 (EventConfig) ✅ Complete

## Open Questions

1. Should we support batch minting in a single tx? (can add later)
2. Should mint price be configurable per-ticket or fixed per-event?

## References

- [Light Protocol: Create Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-create-compressed-accounts)
- [Light SDK v0.17 docs](https://www.zkcompression.com/resources/sdks/program-development)
