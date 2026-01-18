use anchor_lang::prelude::*;

declare_id!("2Ky4W1nqfzo82q4KTCR1RJpTjF7ihWU7dcwSVb7Rc6pT");

#[program]
pub mod encore {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
