use anchor_lang::prelude::*;

#[event]
pub struct EventCreated {
    pub event_config: Pubkey,
    pub authority: Pubkey,
    pub max_supply: u32,
    pub resale_cap_bps: u32,
    pub royalty_bps: u16,
    pub event_name: String,
    pub event_timestamp: i64,
}

#[event]
pub struct EventUpdated {
    pub event_config: Pubkey,
    pub authority: Pubkey,
    pub resale_cap_bps: u32,
    pub royalty_bps: u16,
}

#[event]
pub struct TicketMinted {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub owner_commitment: [u8; 32],
    pub purchase_price: u64,
}

#[event]
pub struct TicketTransferred {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub old_commitment: [u8; 32],
    pub new_commitment: [u8; 32],
    pub nullifier: [u8; 32],
}

