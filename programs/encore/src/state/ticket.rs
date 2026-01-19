use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct CompressedTicket {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub owner: Pubkey,
    pub purchase_price: u64,
    pub original_price: u64,
}
