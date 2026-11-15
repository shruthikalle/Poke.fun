use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

// Replace with the deployed program ID before deploying. This example ID is not a deployed escrow.
declare_id!("Fg6PaFpoGXkYsidMpWxqSWY4ZbWvMaJf1c4SSbM9VTx");

const QUEUE_SECONDS: i64 = 300;
const JOIN_SECONDS: i64 = 120;
const BATTLE_SECONDS: i64 = 900;

#[program]
pub mod pokefun_wager {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, referee: Pubkey) -> Result<()> {
        require!(referee != Pubkey::default(), WagerError::InvalidReferee);
        require!(ctx.accounts.mint.decimals == 6, WagerError::WrongDecimals);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.referee = referee;
        config.mint = ctx.accounts.mint.key();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn open_wager(ctx: Context<OpenWager>, nonce: u64, stake: u64) -> Result<()> {
        require!(stake > 0 && stake <= u64::MAX / 2, WagerError::InvalidStake);
        let now = Clock::get()?.unix_timestamp;
        let wager = &mut ctx.accounts.wager;
        wager.maker = ctx.accounts.maker.key();
        wager.opponent = Pubkey::default();
        wager.winner = Pubkey::default();
        wager.mint = ctx.accounts.mint.key();
        wager.stake = stake;
        wager.nonce = nonce;
        wager.deadline = now.checked_add(QUEUE_SECONDS).ok_or(WagerError::Overflow)?;
        wager.bump = ctx.bumps.wager;
        wager.state = WagerState::Waiting;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.maker_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.maker.to_account_info(),
                },
            ),
            stake,
            ctx.accounts.mint.decimals,
        )?;
        emit!(WagerOpened {
            wager: wager.key(),
            maker: wager.maker,
            stake
        });
        Ok(())
    }

    // The off-chain skill queue chooses a specific wallet; the program enforces that choice.
    pub fn reserve_wager(ctx: Context<ReserveWager>, opponent: Pubkey) -> Result<()> {
        let wager = &mut ctx.accounts.wager;
        require!(wager.state == WagerState::Waiting, WagerError::WrongState);
        require!(
            Clock::get()?.unix_timestamp < wager.deadline,
            WagerError::Expired
        );
        require!(
            opponent != Pubkey::default() && opponent != wager.maker,
            WagerError::SamePlayer
        );
        wager.opponent = opponent;
        wager.state = WagerState::Reserved;
        wager.deadline = Clock::get()?
            .unix_timestamp
            .checked_add(JOIN_SECONDS)
            .ok_or(WagerError::Overflow)?;
        emit!(WagerReserved {
            wager: wager.key(),
            opponent
        });
        Ok(())
    }

    pub fn join_wager(ctx: Context<JoinWager>) -> Result<()> {
        let wager = &mut ctx.accounts.wager;
        require!(wager.state == WagerState::Reserved, WagerError::WrongState);
        require!(
            Clock::get()?.unix_timestamp < wager.deadline,
            WagerError::Expired
        );
        require!(
            ctx.accounts.opponent.key() == wager.opponent,
            WagerError::WrongOpponent
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.opponent_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.opponent.to_account_info(),
                },
            ),
            wager.stake,
            ctx.accounts.mint.decimals,
        )?;
        wager.state = WagerState::Playing;
        wager.deadline = Clock::get()?
            .unix_timestamp
            .checked_add(BATTLE_SECONDS)
            .ok_or(WagerError::Overflow)?;
        emit!(WagerJoined {
            wager: wager.key(),
            opponent: wager.opponent
        });
        Ok(())
    }

    pub fn cancel_wager(ctx: Context<CancelWager>) -> Result<()> {
        require!(
            ctx.accounts.wager.state == WagerState::Waiting
                || ctx.accounts.wager.state == WagerState::Reserved,
            WagerError::WrongState
        );
        let wager = &ctx.accounts.wager;
        let nonce = wager.nonce.to_le_bytes();
        let bump = [wager.bump];
        let seeds: &[&[u8]] = &[b"wager", wager.maker.as_ref(), &nonce, &bump];
        let signer = &[seeds];
        send_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.maker_token,
            &ctx.accounts.wager,
            ctx.accounts.vault.amount,
            signer,
        )?;
        close_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.maker,
            &ctx.accounts.wager,
            signer,
        )?;
        let wager_key = wager.key();
        ctx.accounts.wager.state = WagerState::Cancelled;
        emit!(WagerClosed {
            wager: wager_key,
            outcome: WagerState::Cancelled
        });
        Ok(())
    }

    // The configured referee is a trusted game server. It must report the actual game winner.
    pub fn settle_wager(ctx: Context<SettleWager>, winner: Pubkey) -> Result<()> {
        let wager = &ctx.accounts.wager;
        require!(wager.state == WagerState::Playing, WagerError::WrongState);
        require!(
            Clock::get()?.unix_timestamp < wager.deadline,
            WagerError::Expired
        );
        require!(
            winner == wager.maker || winner == wager.opponent,
            WagerError::InvalidWinner
        );
        require!(
            ctx.accounts.winner_token.owner == winner,
            WagerError::WrongRecipient
        );
        let nonce = wager.nonce.to_le_bytes();
        let bump = [wager.bump];
        let seeds: &[&[u8]] = &[b"wager", wager.maker.as_ref(), &nonce, &bump];
        let signer = &[seeds];
        let payout = wager.stake.checked_mul(2).ok_or(WagerError::Overflow)?;
        require!(
            ctx.accounts.vault.amount >= payout,
            WagerError::VaultUnderfunded
        );
        send_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.winner_token,
            &ctx.accounts.wager,
            ctx.accounts.vault.amount,
            signer,
        )?;
        close_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.maker,
            &ctx.accounts.wager,
            signer,
        )?;
        let wager_key = wager.key();
        ctx.accounts.wager.winner = winner;
        ctx.accounts.wager.state = WagerState::Settled;
        emit!(WagerClosed {
            wager: wager_key,
            outcome: WagerState::Settled
        });
        Ok(())
    }

    // Anyone can recover funds after the queue or game deadline. A timed-out game is a draw.
    pub fn expire_wager(ctx: Context<ExpireWager>) -> Result<()> {
        let wager = &ctx.accounts.wager;
        require!(
            wager.state == WagerState::Waiting
                || wager.state == WagerState::Reserved
                || wager.state == WagerState::Playing,
            WagerError::WrongState
        );
        require!(
            Clock::get()?.unix_timestamp >= wager.deadline,
            WagerError::NotExpired
        );
        let nonce = wager.nonce.to_le_bytes();
        let bump = [wager.bump];
        let seeds: &[&[u8]] = &[b"wager", wager.maker.as_ref(), &nonce, &bump];
        let signer = &[seeds];
        send_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.maker_token,
            &ctx.accounts.wager,
            wager.stake,
            signer,
        )?;
        if wager.state == WagerState::Playing {
            require!(
                ctx.accounts.opponent_token.owner == wager.opponent,
                WagerError::WrongRecipient
            );
            send_from_vault(
                &ctx.accounts.token_program,
                &ctx.accounts.vault,
                &ctx.accounts.mint,
                &ctx.accounts.opponent_token,
                &ctx.accounts.wager,
                wager.stake,
                signer,
            )?;
            // Any extra tokens sent to the vault cannot prevent its closure.
            let extra = ctx
                .accounts
                .vault
                .amount
                .checked_sub(wager.stake.checked_mul(2).ok_or(WagerError::Overflow)?)
                .ok_or(WagerError::VaultUnderfunded)?;
            if extra > 0 {
                send_from_vault(
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault,
                    &ctx.accounts.mint,
                    &ctx.accounts.maker_token,
                    &ctx.accounts.wager,
                    extra,
                    signer,
                )?;
            }
        } else {
            let extra = ctx
                .accounts
                .vault
                .amount
                .checked_sub(wager.stake)
                .ok_or(WagerError::VaultUnderfunded)?;
            if extra > 0 {
                send_from_vault(
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault,
                    &ctx.accounts.mint,
                    &ctx.accounts.maker_token,
                    &ctx.accounts.wager,
                    extra,
                    signer,
                )?;
            }
        }
        close_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.maker,
            &ctx.accounts.wager,
            signer,
        )?;
        let wager_key = wager.key();
        ctx.accounts.wager.state = WagerState::Expired;
        emit!(WagerClosed {
            wager: wager_key,
            outcome: WagerState::Expired
        });
        Ok(())
    }
}

fn send_from_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    recipient: &Account<'info, TokenAccount>,
    wager: &Account<'info, Wager>,
    amount: u64,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: recipient.to_account_info(),
                authority: wager.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}

fn close_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    rent_recipient: &AccountInfo<'info>,
    wager: &Account<'info, Wager>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_recipient.clone(),
            authority: wager.to_account_info(),
        },
        signer,
    ))
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct OpenWager<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.mint == mint.key() @ WagerError::WrongMint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(init, payer = maker, space = Wager::SPACE, seeds = [b"wager", maker.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub wager: Box<Account<'info, Wager>>,
    #[account(init, payer = maker, token::mint = mint, token::authority = wager, seeds = [b"vault", wager.key().as_ref()], bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = maker)]
    pub maker_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinWager<'info> {
    pub opponent: Signer<'info>,
    #[account(mut, seeds = [b"wager", wager.maker.as_ref(), &wager.nonce.to_le_bytes()], bump = wager.bump, has_one = mint)]
    pub wager: Account<'info, Wager>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", wager.key().as_ref()], bump, token::mint = mint, token::authority = wager)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = opponent)]
    pub opponent_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReserveWager<'info> {
    pub referee: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.referee == referee.key() @ WagerError::WrongReferee)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"wager", wager.maker.as_ref(), &wager.nonce.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, Wager>,
}

#[derive(Accounts)]
pub struct CancelWager<'info> {
    #[account(mut, address = wager.maker)]
    pub maker: Signer<'info>,
    #[account(mut, seeds = [b"wager", wager.maker.as_ref(), &wager.nonce.to_le_bytes()], bump = wager.bump, has_one = mint)]
    pub wager: Account<'info, Wager>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", wager.key().as_ref()], bump, token::mint = mint, token::authority = wager)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = maker)]
    pub maker_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleWager<'info> {
    pub referee: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.referee == referee.key() @ WagerError::WrongReferee)]
    pub config: Account<'info, Config>,
    /// CHECK: Validated against wager.maker and only receives vault rent.
    #[account(mut, address = wager.maker)]
    pub maker: AccountInfo<'info>,
    #[account(mut, seeds = [b"wager", wager.maker.as_ref(), &wager.nonce.to_le_bytes()], bump = wager.bump, has_one = mint)]
    pub wager: Account<'info, Wager>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", wager.key().as_ref()], bump, token::mint = mint, token::authority = wager)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub winner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExpireWager<'info> {
    pub caller: Signer<'info>,
    /// CHECK: Validated against wager.maker and only receives vault rent.
    #[account(mut, address = wager.maker)]
    pub maker: AccountInfo<'info>,
    #[account(mut, seeds = [b"wager", wager.maker.as_ref(), &wager.nonce.to_le_bytes()], bump = wager.bump, has_one = mint)]
    pub wager: Account<'info, Wager>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", wager.key().as_ref()], bump, token::mint = mint, token::authority = wager)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = maker)]
    pub maker_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub opponent_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub referee: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 8 + 32 * 3 + 1;
}

#[account]
pub struct Wager {
    pub maker: Pubkey,
    pub opponent: Pubkey,
    pub winner: Pubkey,
    pub mint: Pubkey,
    pub stake: u64,
    pub nonce: u64,
    pub deadline: i64,
    pub bump: u8,
    pub state: WagerState,
}

impl Wager {
    pub const SPACE: usize = 8 + 32 * 4 + 8 * 3 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum WagerState {
    Waiting,
    Reserved,
    Playing,
    Settled,
    Cancelled,
    Expired,
}

#[event]
pub struct WagerOpened {
    pub wager: Pubkey,
    pub maker: Pubkey,
    pub stake: u64,
}

#[event]
pub struct WagerJoined {
    pub wager: Pubkey,
    pub opponent: Pubkey,
}

#[event]
pub struct WagerReserved {
    pub wager: Pubkey,
    pub opponent: Pubkey,
}

#[event]
pub struct WagerClosed {
    pub wager: Pubkey,
    pub outcome: WagerState,
}

#[error_code]
pub enum WagerError {
    #[msg("Stake must be positive and fit in a two-player pot")]
    InvalidStake,
    #[msg("Referee cannot be the default address")]
    InvalidReferee,
    #[msg("Wrong token mint")]
    WrongMint,
    #[msg("Only six-decimal tokens are supported")]
    WrongDecimals,
    #[msg("Escrow vault is missing its expected balance")]
    VaultUnderfunded,
    #[msg("Wager is in the wrong state")]
    WrongState,
    #[msg("Wager deadline has passed")]
    Expired,
    #[msg("Wager deadline has not passed")]
    NotExpired,
    #[msg("Maker cannot join their own wager")]
    SamePlayer,
    #[msg("Only the reserved opponent can join")]
    WrongOpponent,
    #[msg("Winner must be one of the two players")]
    InvalidWinner,
    #[msg("Token account does not belong to the intended recipient")]
    WrongRecipient,
    #[msg("Only the configured referee can settle")]
    WrongReferee,
    #[msg("Arithmetic overflow")]
    Overflow,
}
