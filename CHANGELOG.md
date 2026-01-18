# Changelog

All notable changes to this project will be documented in this file.

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
