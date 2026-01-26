use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

/// Private ticket stored as compressed account.
/// 
/// Privacy: `owner_commitment` hides who owns the ticket.
/// Only the owner (who knows their secret) can prove ownership.
/// 
/// Commitment = Poseidon(owner_pubkey, secret)
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct PrivateTicket {
    /// Link to parent event
    pub event_config: Pubkey,
    
    /// Unique ticket identifier within the event
    pub ticket_id: u32,
    
    /// Owner (Ephemeral Public Key)
    /// Privacy is achieved by using a fresh keypair for each ticket (Stealth Address).
    pub owner: Pubkey,
    
    /// Original mint price (public for resale cap calculation)
    pub original_price: u64,
}
