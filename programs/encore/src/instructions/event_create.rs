use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EncoreError;
use crate::events::EventCreated;
use crate::state::EventConfig;

#[derive(Accounts)]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + EventConfig::INIT_SPACE,
        seeds = [EVENT_SEED, authority.key().as_ref()],
        bump
    )]
    pub event_config: Account<'info, EventConfig>,

    pub system_program: Program<'info, System>,
}

pub fn create_event(
    ctx: Context<CreateEvent>,
    max_supply: u32,
    resale_cap_bps: u32,

    event_name: String,
    event_location: String,
    event_description: String,
    max_tickets_per_person: u8,
    event_timestamp: i64,
) -> Result<()> {
    require!(max_supply > 0, EncoreError::InvalidTicketSupply);
    require!(max_supply <= MAX_TICKET_SUPPLY, EncoreError::TicketSupplyTooLarge);
    require!(resale_cap_bps >= MIN_RESALE_CAP_BPS, EncoreError::ResaleCapTooLow);
    require!(resale_cap_bps <= MAX_RESALE_CAP_BPS, EncoreError::ResaleCapTooHigh);
    require!(!event_name.is_empty(), EncoreError::EventNameEmpty);
    require!(event_name.len() <= MAX_EVENT_NAME_LEN, EncoreError::EventNameTooLong);
    require!(event_location.len() <= MAX_EVENT_LOCATION_LEN, EncoreError::EventLocationTooLong);
    require!(event_description.len() <= MAX_EVENT_DESCRIPTION_LEN, EncoreError::EventDescriptionTooLong);

    let clock = Clock::get()?;
    require!(event_timestamp > clock.unix_timestamp, EncoreError::EventTimestampInPast);

    let event_config = &mut ctx.accounts.event_config;
    event_config.authority = ctx.accounts.authority.key();
    event_config.max_supply = max_supply;
    event_config.tickets_minted = 0;
    event_config.resale_cap_bps = resale_cap_bps;
    event_config.event_name = event_name.clone();
    event_config.event_location = event_location.clone();
    event_config.event_description = event_description.clone();
    event_config.max_tickets_per_person = max_tickets_per_person;
    event_config.event_timestamp = event_timestamp;
    event_config.created_at = clock.unix_timestamp;
    event_config.updated_at = 0;
    event_config.bump = ctx.bumps.event_config;

    emit!(EventCreated {
        event_config: event_config.key(),
        authority: event_config.authority,
        max_supply,
        resale_cap_bps,
        event_name,
        event_location,
        event_description,
        max_tickets_per_person,
        event_timestamp,
    });

    Ok(())
}
