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
