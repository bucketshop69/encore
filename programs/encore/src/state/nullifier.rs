use anchor_lang::prelude::*;
use light_sdk::LightDiscriminator;

/// Nullifier account - prevents double-spending of tickets.
///
/// This is an empty struct - existence is the proof.
/// When a ticket is transferred:
/// 1. Compute nullifier_seed = hash("nullifier" || seller_secret)
/// 2. CREATE nullifier account at derived address
/// 3. If address already exists → transfer fails (double-spend prevented)
///
/// The nullifier is derived from the seller's secret, which is unique per ticket.
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator)]
pub struct Nullifier {}
