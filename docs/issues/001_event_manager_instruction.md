# Issue #001: Event Manager Instruction

## Overview

Implementation of the Event Manager functionality that allows organizers to set rules for events including ticket quantity, resale price caps, and royalty fees.

## Description

The Event Manager (Part A) is where the Organizer sets the rules for the event:
- How many tickets exist? (e.g., 5,000)
- What is the maximum resale price? (e.g., cannot exceed 1.5x original price)
- What is the royalty fee? (e.g., Organizer gets 5% of every resale)

## Technical Requirements

- Implement `initialize_event` instruction
- Store event configuration in a PDA
- Define constants for max resale caps and royalty percentages
- Validate inputs (ticket count, price caps, royalty rates)

## State Structure

- EventConfig account containing:
  - Event metadata (name, date, capacity)
  - Resale rules (max price multiplier)
  - Royalty settings (percentage, recipient)
  - Authority (organizer wallet)

## Validation Logic

- Ensure organizer authority
- Validate ticket count limits
- Check royalty percentage bounds
- Verify price cap reasonableness

## Testing Considerations

- Test initialization with various parameters
- Verify authority checks
- Test edge cases for price caps and royalties
- Ensure proper error handling