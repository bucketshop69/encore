use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

/// Private ticket stored as compressed account.
///
/// Privacy: `owner_commitment` hides who owns the ticket.
/// Only the owner (who knows their secret) can prove ownership.
///
/// Commitment = hash(owner_pubkey || secret)
/// - owner_pubkey: The actual owner's public key
/// - secret: Derived from wallet signature, unique per ticket
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct PrivateTicket {
    /// Link to parent event
    pub event_config: Pubkey,

    /// Unique ticket identifier within the event
    pub ticket_id: u32,

    /// Owner commitment: hash(owner_pubkey || secret)
    /// Only the owner who knows their secret can prove ownership.
    /// Secret is derived from: hash(wallet_sign("ticket:{ticket_id}:{event_config}"))
    pub owner_commitment: [u8; 32],

    /// Original mint price (public for resale cap calculation)
    pub original_price: u64,
}
