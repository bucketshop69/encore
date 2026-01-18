# Contributing to the Private ZK Ticketing System

Thank you for your interest in contributing to our privacy-preserving ticketing marketplace on Solana!

## Project Overview

We are building a **fair, private ticketing system** for events that:

- Stops scalpers by enforcing price caps (e.g., "You can't resell this for more than 50% profit")
- Keeps ticket ownership and pricing private using Zero-Knowledge proofs
- Holds money safely in a vault until the event actually happens

The system consists of four main components:

1. **Event Manager** - Where organizers set event rules (supply, price caps, royalties)
2. **Ticket** - The private, compressed tickets stored in Merkle trees
3. **Marketplace** - Where tickets are bought/sold with automatic rule enforcement
4. **Vault** - Secure escrow system for holding funds safely

## Development Structure

For organizing the codebase, use this modular structure:

```
programs/encore/
├── src/
│   ├── lib.rs                 # Entry point, exports modules
│   ├── constants.rs           # Program constants, seeds, fees
│   ├── errors.rs             # Custom errors
│   ├── events.rs             # Emitted events
│   ├── instructions/         # Instruction handlers
│   │   ├── mod.rs            # Module declarations
│   │   ├── ticket_mint.rs    # Mint compressed tickets
│   │   ├── ticket_transfer.rs # Transfer tickets
│   │   ├── ticket_sale.rs    # Handle resales
│   │   ├── event_create.rs   # Create events
│   │   └── settlement.rs     # Event settlement
│   ├── state/                # Account structs
│   │   ├── mod.rs            # Module declarations
│   │   ├── event_config.rs   # Event configuration
│   │   ├── ticket.rs         # Ticket state
│   │   └── marketplace.rs    # Marketplace config
│   └── utils/                # Helper functions
│       ├── mod.rs            # Module declarations
│       ├── merkle_tree.rs    # ZK tree utilities
│       ├── proofs.rs         # ZK proof validation
│       └── validation.rs     # State validation
```

## Key Principles

1. **Separate concerns** - Each module handles one domain
2. **State validation** - Keep validation logic separate
3. **Error handling** - Centralized custom errors
4. **Events** - Separate event definitions
5. **Constants** - All program constants in one place

This structure scales well as your ZK logic grows and makes testing easier.

## Development Workflow

### Documentation-Driven Development

We maintain detailed documentation for each component:

- `/docs/issues/` - Specific implementation tasks
- `/docs/milestones/` - Knowledge bases for each component

Before implementing a feature, review the relevant milestone documentation to understand the domain knowledge, validation requirements, and business rules.

### Implementation Phases

1. **Phase 1: The Factory** - Event creation and ticket minting
2. **Phase 2: The Store** - Primary and secondary ticket sales
3. **Phase 3: The Bank** - Secure fund management
4. **Phase 4: The Experience** - Privacy-preserving verification

### Testing Strategy

- Unit tests for individual functions
- Integration tests for cross-component interactions
- Validation tests for business rule enforcement
- Security tests for ZK proof verification
