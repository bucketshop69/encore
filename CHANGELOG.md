# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-01-19

### Added

- **Private Ticket Minting with Light Protocol** (Issue #002)

  - `mint_ticket` instruction for minting privacy-preserving tickets
  - `PrivateTicket` struct with `owner_commitment` instead of plain pubkey
  - Ownership hidden via commitment: `SHA256(owner_pubkey || secret)`
  - Only ticket owner knows their secret - no one else can identify them
  - ZK-compressed accounts for 200x cost reduction
  - Address derivation using `["ticket", event_config, ticket_id]`
  - Max supply enforcement with `MaxSupplyReached` error
  - `TicketMinted` event emits commitment (not owner pubkey)

- **Privacy Model**
  - Ticket ownership hidden from on-chain observers
  - Organizer only receives commitment, never sees recipient identity
  - Foundation for ZK proof-based ownership verification

- **Rust Integration Tests**
  - `test_create_event` - EventConfig PDA creation
  - `test_mint_private_ticket` - Private ticket minting with commitment
  - `test_mint_ticket_fails_max_supply` - Supply limit enforcement

- **Light Protocol Infrastructure**
  - Light CLI installed for test infrastructure
  - `light-program-test` integration for Rust tests


## [0.1.0] - 2026-01-18

### Added

- **Event Manager Instruction** (Issue #001)

  - `create_event` instruction for organizers to initialize events
  - `update_event` instruction for modifying resale caps and royalties
  - `EventConfig` PDA with seeds `["event", authority.key()]`
  - Validation for ticket supply, resale caps (1.0x-10.0x), royalties (max 50%)
  - Future timestamp validation for event dates
  - `EventCreated` and `EventUpdated` anchor events

- **Project Structure**

  - Modular codebase following CONTRIBUTING.md guidelines
  - `constants.rs` - program seeds and limits
  - `errors.rs` - custom error definitions
  - `events.rs` - anchor event definitions
  - `state/event_config.rs` - EventConfig account with helper methods
  - `instructions/event_create.rs` - create event handler
  - `instructions/event_update.rs` - update event handler

- **Tests**
  - 7 passing tests for create_event and update_event
  - Validation error tests for edge cases
  - Authorization tests

### Fixed

- Package name corrected from "create" to "encore" in Cargo.toml
