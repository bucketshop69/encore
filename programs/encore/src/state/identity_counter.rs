use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct IdentityCounter {
    /// The event this counter belongs to
    pub event: Pubkey,

    /// The user this counter tracks (for limit enforcement)
    pub authority: Pubkey,

    /// Total tickets minted by this user for this event
    pub tickets_minted: u8,
}
