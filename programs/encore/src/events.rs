use anchor_lang::prelude::*;

#[event]
pub struct EventCreated {
    pub event_config: Pubkey,
    pub authority: Pubkey,
    pub max_supply: u32,
    pub resale_cap_bps: u32,

    pub event_name: String,
    pub event_location: String,
    pub event_description: String,
    pub max_tickets_per_person: u8,
    pub event_timestamp: i64,
}

#[event]
pub struct EventUpdated {
    pub event_config: Pubkey,
    pub authority: Pubkey,
    pub resale_cap_bps: u32,

}

#[event]
pub struct TicketMinted {
    pub event_config: Pubkey,
    pub purchase_price: u64,
}

#[event]
pub struct TicketTransferred {
    pub event_config: Pubkey,
}

