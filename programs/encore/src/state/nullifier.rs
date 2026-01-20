//! Nullifier account for preventing double-spending

use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

/// Nullifier marker account
/// 
/// This is an empty compressed account that exists solely to mark
/// a ticket transfer as consumed. If this nullifier already exists,
/// the ticket has been transferred before (double-spend attempt).
#[derive(Debug, Clone, Default, AnchorSerialize, AnchorDeserialize, LightDiscriminator)]
pub struct Nullifier {
    /// Ticket ID that was nullified
    pub ticket_id: u32,
}
