use anchor_lang::prelude::*;

/// Marketplace listing for private ticket trading.
///
/// Privacy: Seller and buyer identities are public, but ticket ownership
/// is hidden via commitment model. Only the seller knows their secret.
#[account]
pub struct Listing {
    /// Seller who receives payment
    pub seller: Pubkey,

    /// The ticket being sold (commitment proves ownership)
    pub ticket_commitment: [u8; 32],

    /// Encrypted secret: secret XOR hash(listing_pda)
    /// Allows seller to prove ownership without revealing secret
    pub encrypted_secret: [u8; 32],

    /// Sale price in lamports
    pub price_lamports: u64,

    /// Which event this ticket belongs to
    pub event_config: Pubkey,

    /// Which ticket ID within the event
    pub ticket_id: u32,

    /// Claim data
    pub buyer: Option<Pubkey>, // Who claimed the listing
    pub buyer_commitment: Option<[u8; 32]>, // Buyer's new commitment
    pub claimed_at: Option<i64>,            // Timestamp for timeout

    /// Current status of the listing
    pub status: ListingStatus,

    /// When the listing was created
    pub created_at: i64,

    /// PDA bump for listing address derivation
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ListingStatus {
    Active,    // For sale
    Claimed,   // Buyer locked, awaiting payment
    Completed, // Sold
    Cancelled, // Seller cancelled
}

impl Default for ListingStatus {
    fn default() -> Self {
        ListingStatus::Active
    }
}
