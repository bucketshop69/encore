use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("2Ky4W1nqfzo82q4KTCR1RJpTjF7ihWU7dcwSVb7Rc6pT");

#[program]
pub mod encore {
    use super::*;

    pub fn create_event(
        ctx: Context<CreateEvent>,
        max_supply: u32,
        resale_cap_bps: u32,
        royalty_bps: u16,
        event_name: String,
        event_timestamp: i64,
    ) -> Result<()> {
        instructions::create_event(ctx, max_supply, resale_cap_bps, royalty_bps, event_name, event_timestamp)
    }

    pub fn update_event(
        ctx: Context<UpdateEvent>,
        resale_cap_bps: Option<u32>,
        royalty_bps: Option<u16>,
    ) -> Result<()> {
        instructions::update_event(ctx, resale_cap_bps, royalty_bps)
    }
}
