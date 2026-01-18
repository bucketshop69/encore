# Milestone: Event Manager Knowledge Base

## Purpose

Documentation for the Event Manager component that outlines the knowledge domain, validation requirements, and business logic for event configuration.

## Domain Knowledge

### Event Configuration Parameters

- **Ticket Supply**: Maximum number of tickets available (e.g., 5,000)
- **Resale Cap**: Maximum price multiplier (e.g., 1.5x original price)
- **Royalty Rate**: Percentage fee for organizer on secondary sales (e.g., 5%)

### Business Rules

- Organizers control all event parameters at initialization
- Resale caps prevent scalping by limiting profit margins
- Royalties ensure organizers benefit from secondary market activity
- Authority remains with the original organizer for modifications

## Validation Requirements

### Input Validation

- Ticket count must be greater than 0 and within reasonable limits
- Resale cap must be between 1.0 and 10.0 (0% to 900% markup)
- Royalty rate must be between 0.0 and 0.5 (0% to 50%)
- Authority must sign initialization transaction

### State Validation

- Prevent duplicate event configurations
- Ensure authority has sufficient permissions
- Validate PDA derivation correctness
- Check for potential overflow in calculations

## Technical Specifications

### EventConfig PDA Structure

- Authority (organizer wallet)
- Max supply
- Resale cap multiplier
- Royalty basis points
- Event metadata (name, date, etc.)

### Security Considerations

- Only organizer can modify event parameters
- Immutable parameters after initialization
- Proper access controls for sensitive data
