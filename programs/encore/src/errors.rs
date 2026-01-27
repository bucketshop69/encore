use anchor_lang::prelude::*;

#[error_code]
pub enum EncoreError {
    #[msg("Ticket supply must be greater than zero")]
    InvalidTicketSupply,

    #[msg("Ticket supply exceeds maximum allowed")]
    TicketSupplyTooLarge,

    #[msg("Resale cap must be at least 1.0x (10000 basis points)")]
    ResaleCapTooLow,

    #[msg("Resale cap exceeds maximum allowed (10.0x)")]
    ResaleCapTooHigh,

    #[msg("Event name exceeds maximum length")]
    EventNameTooLong,

    #[msg("Event location exceeds maximum length")]
    EventLocationTooLong,

    #[msg("Event description exceeds maximum length")]
    EventDescriptionTooLong,

    #[msg("Event name cannot be empty")]
    EventNameEmpty,

    #[msg("Unauthorized: signer is not the event authority")]
    Unauthorized,

    #[msg("Event timestamp must be in the future")]
    EventTimestampInPast,

    #[msg("Maximum ticket supply reached")]
    MaxSupplyReached,

    #[msg("Purchase price must be greater than zero")]
    InvalidPurchasePrice,

    #[msg("Invalid address tree")]
    InvalidAddressTree,

    #[msg("Invalid ticket account")]
    InvalidTicket,

    #[msg("Seller does not own this ticket")]
    NotTicketOwner,

    #[msg("Resale price exceeds allowed cap")]
    ExceedsResaleCap,

    #[msg("Ticket already transferred (nullifier exists)")]
    TicketAlreadyTransferred,
}

