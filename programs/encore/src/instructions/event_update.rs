use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EncoreError;
use crate::events::EventUpdated;
use crate::state::EventConfig;

#[derive(Accounts)]
pub struct UpdateEvent<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [EVENT_SEED, authority.key().as_ref()],
        bump = event_config.bump,
        has_one = authority @ EncoreError::Unauthorized
    )]
    pub event_config: Account<'info, EventConfig>,
}

pub fn update_event(
    ctx: Context<UpdateEvent>,
    resale_cap_bps: Option<u32>,

) -> Result<()> {
    let event_config = &mut ctx.accounts.event_config;
    let clock = Clock::get()?;

    if let Some(cap) = resale_cap_bps {
        require!(cap >= MIN_RESALE_CAP_BPS, EncoreError::ResaleCapTooLow);
        require!(cap <= MAX_RESALE_CAP_BPS, EncoreError::ResaleCapTooHigh);
        event_config.resale_cap_bps = cap;
    }



    event_config.updated_at = clock.unix_timestamp;

    emit!(EventUpdated {
        event_config: event_config.key(),
        authority: event_config.authority,
        resale_cap_bps: event_config.resale_cap_bps,

    });

    Ok(())
}
