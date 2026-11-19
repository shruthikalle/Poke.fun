//! Poke.fun card marketplace (devnet prototype).
//!
//! Cards are Metaplex Core assets in an admin-approved collection. Listing or
//! offering a card in a trade never moves it out of the owner's wallet: the
//! owner adds Core's FreezeDelegate (frozen) and TransferDelegate plugins with
//! this program's `authority` PDA as delegate. The card stays visible and
//! battle-eligible, but cannot move until the program sells, trades or
//! releases it. Prices are native SOL (lamports). Offer and trade payments are
//! escrowed in their own program accounts until accepted or refunded.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use mpl_core::{
    accounts::BaseAssetV1,
    fetch_asset_plugin,
    instructions::{
        AddPluginV1CpiBuilder, ApprovePluginAuthorityV1CpiBuilder, RevokePluginAuthorityV1CpiBuilder,
        TransferV1CpiBuilder, UpdatePluginV1CpiBuilder,
    },
    types::{FreezeDelegate, Plugin, PluginAuthority, PluginType, TransferDelegate, UpdateAuthority},
    ID as CORE_ID,
};

// Replace with the deployed program ID before deploying.
declare_id!("7856fZ5pQssepMDSCoSjCQzNuUCTRQLsJPESTz7wfwyz");

pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const MAX_FEE_BPS: u16 = 1_000;
pub const OFFER_SECONDS: i64 = 7 * 24 * 3600;
pub const TRADE_SECONDS: i64 = 7 * 24 * 3600;
pub const MAX_TRADE_CARDS: usize = 3;

#[program]
pub mod pokefun_market {
    use super::*;

    // ---------------------------------------------------------------- admin

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, treasury: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, MarketError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = treasury;
        config.fee_bps = fee_bps;
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.authority_bump = ctx.bumps.authority;
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: u16, treasury: Pubkey, paused: bool) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, MarketError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.fee_bps = fee_bps;
        config.treasury = treasury;
        config.paused = paused;
        Ok(())
    }

    pub fn add_collection(ctx: Context<AddCollection>) -> Result<()> {
        let approved = &mut ctx.accounts.approved;
        approved.collection = ctx.accounts.collection.key();
        approved.enabled = true;
        approved.bump = ctx.bumps.approved;
        Ok(())
    }

    pub fn set_collection_enabled(ctx: Context<SetCollectionEnabled>, enabled: bool) -> Result<()> {
        ctx.accounts.approved.enabled = enabled;
        Ok(())
    }

    // ------------------------------------------------------------- listings

    pub fn list(ctx: Context<List>, price: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        require!(price > 0, MarketError::InvalidPrice);
        let a = &ctx.accounts;
        let seller = a.seller.key();
        require_keys_eq!(asset_owner(&a.asset, &a.collection)?, seller, MarketError::NotOwner);
        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.seller, &a.system_program, &a.collection);
        core.commit(&a.asset.to_account_info(), &a.seller.to_account_info())?;

        let now = Clock::get()?.unix_timestamp;
        let listing = &mut ctx.accounts.listing;
        listing.seller = seller;
        listing.asset = ctx.accounts.asset.key();
        listing.collection = ctx.accounts.collection.key();
        listing.price = price;
        listing.created_at = now;
        listing.bump = ctx.bumps.listing;
        emit!(Listed { asset: listing.asset, seller, price });
        Ok(())
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price: u64) -> Result<()> {
        require!(price > 0, MarketError::InvalidPrice);
        let listing = &mut ctx.accounts.listing;
        listing.price = price;
        emit!(PriceUpdated { asset: listing.asset, seller: listing.seller, price });
        Ok(())
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let a = &ctx.accounts;
        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.seller, &a.system_program, &a.collection);
        core.release(&a.asset.to_account_info())?;
        emit!(ListingClosed { asset: a.listing.asset, seller: a.listing.seller, reason: CloseReason::Cancelled });
        Ok(())
    }

    /// `expected_price` protects the buyer from a price change landing first.
    pub fn buy(ctx: Context<Buy>, expected_price: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        let a = &ctx.accounts;
        let price = a.listing.price;
        require!(price == expected_price, MarketError::PriceChanged);
        require_keys_neq!(a.buyer.key(), a.listing.seller, MarketError::OwnListing);

        let fee = fee_of(price, a.config.fee_bps)?;
        pay_from_signer(&a.system_program, &a.buyer, &a.seller.to_account_info(), price - fee)?;
        pay_from_signer(&a.system_program, &a.buyer, &a.treasury.to_account_info(), fee)?;

        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.buyer, &a.system_program, &a.collection);
        core.transfer_out(&a.asset.to_account_info(), &a.buyer.to_account_info())?;
        emit!(Sale { asset: a.listing.asset, seller: a.listing.seller, buyer: a.buyer.key(), price, fee, kind: SaleKind::Buy });
        Ok(())
    }

    // --------------------------------------------------------------- offers

    /// Escrows `amount` lamports in the offer account. Offers are made on listed cards.
    pub fn make_offer(ctx: Context<MakeOffer>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        require!(amount > 0, MarketError::InvalidPrice);
        require_keys_neq!(ctx.accounts.buyer.key(), ctx.accounts.listing.seller, MarketError::OwnListing);
        pay_from_signer(&ctx.accounts.system_program, &ctx.accounts.buyer, &ctx.accounts.offer.to_account_info(), amount)?;
        let now = Clock::get()?.unix_timestamp;
        let offer = &mut ctx.accounts.offer;
        offer.buyer = ctx.accounts.buyer.key();
        offer.asset = ctx.accounts.listing.asset;
        offer.amount = amount;
        offer.counter = 0;
        offer.created_at = now;
        offer.expires_at = now + OFFER_SECONDS;
        offer.bump = ctx.bumps.offer;
        emit!(OfferMade { asset: offer.asset, buyer: offer.buyer, amount });
        Ok(())
    }

    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let o = &ctx.accounts.offer;
        emit!(OfferClosed { asset: o.asset, buyer: o.buyer, reason: CloseReason::Cancelled });
        Ok(())
    }

    pub fn decline_offer(ctx: Context<DeclineOffer>) -> Result<()> {
        let o = &ctx.accounts.offer;
        emit!(OfferClosed { asset: o.asset, buyer: o.buyer, reason: CloseReason::Declined });
        Ok(())
    }

    /// Anyone may refund an offer once it expires or its listing is gone.
    pub fn expire_offer(ctx: Context<ExpireOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let listing_gone = ctx.accounts.listing.lamports() == 0 || ctx.accounts.listing.owner != &crate::ID;
        require!(listing_gone || now > ctx.accounts.offer.expires_at, MarketError::NotExpired);
        let o = &ctx.accounts.offer;
        emit!(OfferClosed { asset: o.asset, buyer: o.buyer, reason: CloseReason::Expired });
        Ok(())
    }

    pub fn counter_offer(ctx: Context<CounterOffer>, counter: u64) -> Result<()> {
        let offer = &mut ctx.accounts.offer;
        require!(counter > offer.amount, MarketError::CounterTooLow);
        offer.counter = counter;
        emit!(OfferCountered { asset: offer.asset, buyer: offer.buyer, counter });
        Ok(())
    }

    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        let a = &ctx.accounts;
        let amount = a.offer.amount;
        let fee = fee_of(amount, a.config.fee_bps)?;
        // Direct lamport moves must follow every CPI in the instruction.
        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.seller, &a.system_program, &a.collection);
        core.transfer_out(&a.asset.to_account_info(), &a.buyer.to_account_info())?;
        pay_from_program(&a.offer.to_account_info(), &a.seller.to_account_info(), amount - fee)?;
        pay_from_program(&a.offer.to_account_info(), &a.treasury.to_account_info(), fee)?;
        emit!(Sale { asset: a.listing.asset, seller: a.listing.seller, buyer: a.offer.buyer, price: amount, fee, kind: SaleKind::Offer });
        Ok(())
    }

    /// Buyer takes the seller's counter, topping up the difference.
    pub fn accept_counter(ctx: Context<AcceptCounter>, expected_counter: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        let a = &ctx.accounts;
        let counter = a.offer.counter;
        require!(counter > 0, MarketError::NoCounter);
        require!(counter == expected_counter, MarketError::PriceChanged);
        pay_from_signer(&a.system_program, &a.buyer, &a.offer.to_account_info(), counter - a.offer.amount)?;
        let fee = fee_of(counter, a.config.fee_bps)?;
        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.buyer, &a.system_program, &a.collection);
        core.transfer_out(&a.asset.to_account_info(), &a.buyer.to_account_info())?;
        pay_from_program(&a.offer.to_account_info(), &a.seller.to_account_info(), counter - fee)?;
        pay_from_program(&a.offer.to_account_info(), &a.treasury.to_account_info(), fee)?;
        emit!(Sale { asset: a.listing.asset, seller: a.listing.seller, buyer: a.buyer.key(), price: counter, fee, kind: SaleKind::Counter });
        Ok(())
    }

    // --------------------------------------------------------------- trades

    /// Remaining accounts: the `give_count` cards the proposer gives, then the cards they want,
    /// all in `collection`. Give cards are frozen and delegated; `add_lamports` is escrowed.
    pub fn propose_trade<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProposeTrade<'info>>,
        nonce: u64,
        give_count: u8,
        add_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, MarketError::Paused);
        let a = &ctx.accounts;
        let proposer = a.proposer.key();
        let counterparty = a.counterparty.key();
        require_keys_neq!(proposer, counterparty, MarketError::SelfTrade);
        let give_count = give_count as usize;
        let cards = ctx.remaining_accounts;
        require!(give_count <= cards.len(), MarketError::BadTradeCards);
        let (give, want) = cards.split_at(give_count);
        require!(give.len() <= MAX_TRADE_CARDS && !want.is_empty() && want.len() <= MAX_TRADE_CARDS, MarketError::BadTradeCards);
        require!(!give.is_empty() || add_lamports > 0, MarketError::EmptyTrade);
        let mut seen: Vec<Pubkey> = Vec::with_capacity(cards.len());
        for card in cards {
            require!(!seen.contains(card.key), MarketError::BadTradeCards);
            seen.push(card.key());
        }

        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.proposer, &a.system_program, &a.collection);
        for card in give {
            require_keys_eq!(asset_owner(card, &a.collection)?, proposer, MarketError::NotOwner);
            core.commit(card, &a.proposer.to_account_info())?;
        }
        for card in want {
            require_keys_eq!(asset_owner(card, &a.collection)?, counterparty, MarketError::CardMoved);
        }
        if add_lamports > 0 {
            pay_from_signer(&a.system_program, &a.proposer, &a.trade.to_account_info(), add_lamports)?;
        }

        let now = Clock::get()?.unix_timestamp;
        let trade = &mut ctx.accounts.trade;
        trade.proposer = proposer;
        trade.counterparty = counterparty;
        trade.collection = ctx.accounts.collection.key();
        trade.nonce = nonce;
        trade.give = give.iter().map(|c| c.key()).collect();
        trade.want = want.iter().map(|c| c.key()).collect();
        trade.add_lamports = add_lamports;
        trade.created_at = now;
        trade.expires_at = now + TRADE_SECONDS;
        trade.bump = ctx.bumps.trade;
        emit!(TradeProposed {
            trade: trade.key(),
            proposer,
            counterparty,
            give: trade.give.clone(),
            want: trade.want.clone(),
            add_lamports,
        });
        Ok(())
    }

    /// Remaining accounts: the trade's give cards, then its want cards, in stored order.
    /// Want cards must not be listed; clients bundle `cancel_listing` first when they are.
    pub fn accept_trade<'info>(ctx: Context<'_, '_, 'info, 'info, AcceptTrade<'info>>) -> Result<()> {
        let a = &ctx.accounts;
        let trade = &a.trade;
        let cards = ctx.remaining_accounts;
        require!(cards.len() == trade.give.len() + trade.want.len(), MarketError::BadTradeCards);
        let (give, want) = cards.split_at(trade.give.len());
        let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.counterparty, &a.system_program, &a.collection);
        for (card, key) in give.iter().zip(trade.give.iter()) {
            require_keys_eq!(card.key(), *key, MarketError::BadTradeCards);
            core.transfer_out(card, &a.counterparty.to_account_info())?;
        }
        for (card, key) in want.iter().zip(trade.want.iter()) {
            require_keys_eq!(card.key(), *key, MarketError::BadTradeCards);
            require_keys_eq!(asset_owner(card, &a.collection)?, a.counterparty.key(), MarketError::NotOwner);
            core.transfer_by_owner(card, &a.counterparty.to_account_info(), &a.proposer.to_account_info())?;
        }
        if trade.add_lamports > 0 {
            pay_from_program(&a.trade.to_account_info(), &a.counterparty.to_account_info(), trade.add_lamports)?;
        }
        emit!(TradeClosed { trade: trade.key(), proposer: trade.proposer, counterparty: trade.counterparty, reason: CloseReason::Accepted });
        Ok(())
    }

    pub fn decline_trade<'info>(ctx: Context<'_, '_, 'info, 'info, CloseTrade<'info>>) -> Result<()> {
        require_keys_eq!(ctx.accounts.caller.key(), ctx.accounts.trade.counterparty, MarketError::NotCounterparty);
        close_trade(ctx, CloseReason::Declined)
    }

    pub fn cancel_trade<'info>(ctx: Context<'_, '_, 'info, 'info, CloseTrade<'info>>) -> Result<()> {
        require_keys_eq!(ctx.accounts.caller.key(), ctx.accounts.trade.proposer, MarketError::NotProposer);
        close_trade(ctx, CloseReason::Cancelled)
    }

    pub fn expire_trade<'info>(ctx: Context<'_, '_, 'info, 'info, CloseTrade<'info>>) -> Result<()> {
        require!(Clock::get()?.unix_timestamp > ctx.accounts.trade.expires_at, MarketError::NotExpired);
        close_trade(ctx, CloseReason::Expired)
    }
}

/// Releases the proposer's cards. Closing the account refunds rent and escrowed lamports.
fn close_trade<'info>(ctx: Context<'_, '_, 'info, 'info, CloseTrade<'info>>, reason: CloseReason) -> Result<()> {
    let a = &ctx.accounts;
    let trade = &a.trade;
    require!(ctx.remaining_accounts.len() == trade.give.len(), MarketError::BadTradeCards);
    let core = core_ctx(&a.core_program, &a.authority, a.config.authority_bump, &a.caller, &a.system_program, &a.collection);
    for (card, key) in ctx.remaining_accounts.iter().zip(trade.give.iter()) {
        require_keys_eq!(card.key(), *key, MarketError::BadTradeCards);
        core.release(card)?;
    }
    emit!(TradeClosed { trade: trade.key(), proposer: trade.proposer, counterparty: trade.counterparty, reason });
    Ok(())
}

// ------------------------------------------------------------------ helpers

fn fee_of(price: u64, fee_bps: u16) -> Result<u64> {
    let fee = (price as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MarketError::Overflow)?
        / 10_000;
    Ok(fee as u64)
}

fn pay_from_signer<'info>(system: &Program<'info, System>, from: &Signer<'info>, to: &AccountInfo<'info>, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new(system.to_account_info(), system_program::Transfer { from: from.to_account_info(), to: to.clone() }),
        lamports,
    )
}

/// Moves lamports out of an account this program owns. Call only after the
/// instruction's last CPI: the runtime checks balances at every CPI boundary.
fn pay_from_program(from: &AccountInfo, to: &AccountInfo, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    from.sub_lamports(lamports)?;
    to.add_lamports(lamports)?;
    Ok(())
}

/// Reads a Core asset's owner and checks it belongs to `collection`.
fn asset_owner(asset: &AccountInfo, collection: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(*asset.owner, CORE_ID, MarketError::NotCoreAsset);
    let data = asset.try_borrow_data()?;
    let base = BaseAssetV1::from_bytes(&data).map_err(|_| error!(MarketError::NotCoreAsset))?;
    match base.update_authority {
        UpdateAuthority::Collection(key) if key == collection.key() => Ok(base.owner),
        _ => err!(MarketError::WrongCollection),
    }
}

struct CoreCtx<'info> {
    program: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    authority_bump: u8,
    payer: AccountInfo<'info>,
    system: AccountInfo<'info>,
    collection: AccountInfo<'info>,
}

fn core_ctx<'info>(
    program: &UncheckedAccount<'info>,
    authority: &UncheckedAccount<'info>,
    authority_bump: u8,
    payer: &Signer<'info>,
    system: &Program<'info, System>,
    collection: &UncheckedAccount<'info>,
) -> CoreCtx<'info> {
    CoreCtx {
        program: program.to_account_info(),
        authority: authority.to_account_info(),
        authority_bump,
        payer: payer.to_account_info(),
        system: system.to_account_info(),
        collection: collection.to_account_info(),
    }
}

impl<'info> CoreCtx<'info> {
    fn delegate(&self) -> PluginAuthority {
        PluginAuthority::Address { address: self.authority.key() }
    }

    /// Owner signs: delegate transfer + freeze to the program and freeze the card.
    fn commit(&self, asset: &AccountInfo<'info>, owner: &AccountInfo<'info>) -> Result<()> {
        let freeze = fetch_asset_plugin::<FreezeDelegate>(asset, PluginType::FreezeDelegate).ok().map(|(_, f, _)| f);
        require!(!freeze.as_ref().is_some_and(|f| f.frozen), MarketError::AssetFrozen);
        if fetch_asset_plugin::<TransferDelegate>(asset, PluginType::TransferDelegate).is_ok() {
            ApprovePluginAuthorityV1CpiBuilder::new(&self.program)
                .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(owner))
                .system_program(&self.system).plugin_type(PluginType::TransferDelegate).new_authority(self.delegate())
                .invoke()?;
        } else {
            AddPluginV1CpiBuilder::new(&self.program)
                .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(owner))
                .system_program(&self.system).plugin(Plugin::TransferDelegate(TransferDelegate {})).init_authority(self.delegate())
                .invoke()?;
        }
        match freeze {
            Some(_) => {
                ApprovePluginAuthorityV1CpiBuilder::new(&self.program)
                    .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(owner))
                    .system_program(&self.system).plugin_type(PluginType::FreezeDelegate).new_authority(self.delegate())
                    .invoke()?;
                self.set_frozen(asset, true)?;
            }
            None => {
                AddPluginV1CpiBuilder::new(&self.program)
                    .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(owner))
                    .system_program(&self.system).plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
                    .init_authority(self.delegate())
                    .invoke()?;
            }
        }
        Ok(())
    }

    fn set_frozen(&self, asset: &AccountInfo<'info>, frozen: bool) -> Result<()> {
        let bump = [self.authority_bump];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
        UpdatePluginV1CpiBuilder::new(&self.program)
            .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(&self.authority))
            .system_program(&self.system).plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen }))
            .invoke_signed(&[seeds])?;
        Ok(())
    }

    /// Thaws the card and hands both plugin authorities back to its owner.
    fn release(&self, asset: &AccountInfo<'info>) -> Result<()> {
        self.set_frozen(asset, false)?;
        let bump = [self.authority_bump];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
        for plugin_type in [PluginType::FreezeDelegate, PluginType::TransferDelegate] {
            RevokePluginAuthorityV1CpiBuilder::new(&self.program)
                .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(&self.authority))
                .system_program(&self.system).plugin_type(plugin_type)
                .invoke_signed(&[seeds])?;
        }
        Ok(())
    }

    /// Thaws a committed card and moves it with the program's transfer delegation.
    fn transfer_out(&self, asset: &AccountInfo<'info>, new_owner: &AccountInfo<'info>) -> Result<()> {
        self.set_frozen(asset, false)?;
        let bump = [self.authority_bump];
        let seeds: &[&[u8]] = &[AUTHORITY_SEED, &bump];
        TransferV1CpiBuilder::new(&self.program)
            .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(&self.authority))
            .new_owner(new_owner).system_program(Some(&self.system))
            .invoke_signed(&[seeds])?;
        Ok(())
    }

    /// Moves a card its owner signed for in this transaction.
    fn transfer_by_owner(&self, asset: &AccountInfo<'info>, owner: &AccountInfo<'info>, new_owner: &AccountInfo<'info>) -> Result<()> {
        TransferV1CpiBuilder::new(&self.program)
            .asset(asset).collection(Some(&self.collection)).payer(&self.payer).authority(Some(owner))
            .new_owner(new_owner).system_program(Some(&self.system))
            .invoke()?;
        Ok(())
    }
}

// ----------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = MarketConfig::SPACE, seeds = [b"market"], bump)]
    pub config: Account<'info, MarketConfig>,
    /// CHECK: PDA used only as the Core plugin delegate; holds no data.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"market"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MarketConfig>,
}

#[derive(Accounts)]
pub struct AddCollection<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"market"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MarketConfig>,
    /// CHECK: must be a Core collection account.
    #[account(owner = CORE_ID @ MarketError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    #[account(init, payer = admin, space = ApprovedCollection::SPACE, seeds = [b"collection", collection.key().as_ref()], bump)]
    pub approved: Account<'info, ApprovedCollection>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCollectionEnabled<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [b"market"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, MarketConfig>,
    #[account(mut, seeds = [b"collection", approved.collection.as_ref()], bump = approved.bump)]
    pub approved: Account<'info, ApprovedCollection>,
}

#[derive(Accounts)]
pub struct List<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(seeds = [b"collection", collection.key().as_ref()], bump = approved.bump, constraint = approved.enabled @ MarketError::CollectionDisabled)]
    pub approved: Box<Account<'info, ApprovedCollection>>,
    /// CHECK: Core asset; owner and collection are checked in the handler.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: Core collection matching `approved`.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    #[account(init, payer = seller, space = Listing::SPACE, seeds = [b"listing", asset.key().as_ref()], bump)]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"listing", listing.asset.as_ref()], bump = listing.bump, has_one = seller)]
    pub listing: Account<'info, Listing>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = seller, seeds = [b"listing", asset.key().as_ref()], bump = listing.bump, has_one = seller, has_one = asset, has_one = collection)]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: matches listing.asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: matches listing.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: receives the sale price and listing rent.
    #[account(mut, address = listing.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: receives the marketplace fee.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = seller, seeds = [b"listing", asset.key().as_ref()], bump = listing.bump, has_one = asset, has_one = collection)]
    pub listing: Box<Account<'info, Listing>>,
    /// CHECK: matches listing.asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: matches listing.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakeOffer<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(seeds = [b"listing", listing.asset.as_ref()], bump = listing.bump)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(init, payer = buyer, space = Offer::SPACE, seeds = [b"offer", listing.asset.as_ref(), buyer.key().as_ref()], bump)]
    pub offer: Box<Account<'info, Offer>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, close = buyer, seeds = [b"offer", offer.asset.as_ref(), buyer.key().as_ref()], bump = offer.bump, has_one = buyer)]
    pub offer: Account<'info, Offer>,
}

#[derive(Accounts)]
pub struct DeclineOffer<'info> {
    pub seller: Signer<'info>,
    #[account(seeds = [b"listing", offer.asset.as_ref()], bump = listing.bump, has_one = seller)]
    pub listing: Account<'info, Listing>,
    /// CHECK: refunded the escrow.
    #[account(mut, address = offer.buyer)]
    pub buyer: UncheckedAccount<'info>,
    #[account(mut, close = buyer, seeds = [b"offer", offer.asset.as_ref(), offer.buyer.as_ref()], bump = offer.bump)]
    pub offer: Account<'info, Offer>,
}

#[derive(Accounts)]
pub struct ExpireOffer<'info> {
    pub caller: Signer<'info>,
    /// CHECK: refunded the escrow.
    #[account(mut, address = offer.buyer)]
    pub buyer: UncheckedAccount<'info>,
    #[account(mut, close = buyer, seeds = [b"offer", offer.asset.as_ref(), offer.buyer.as_ref()], bump = offer.bump)]
    pub offer: Account<'info, Offer>,
    /// CHECK: the listing PDA for this asset; may be closed.
    #[account(seeds = [b"listing", offer.asset.as_ref()], bump)]
    pub listing: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CounterOffer<'info> {
    pub seller: Signer<'info>,
    #[account(seeds = [b"listing", offer.asset.as_ref()], bump = listing.bump, has_one = seller)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [b"offer", offer.asset.as_ref(), offer.buyer.as_ref()], bump = offer.bump)]
    pub offer: Account<'info, Offer>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: receives the card and the offer account's rent.
    #[account(mut, address = offer.buyer)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: receives the marketplace fee.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = seller, seeds = [b"listing", asset.key().as_ref()], bump = listing.bump, has_one = seller, has_one = asset, has_one = collection)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(mut, close = buyer, seeds = [b"offer", asset.key().as_ref(), offer.buyer.as_ref()], bump = offer.bump)]
    pub offer: Box<Account<'info, Offer>>,
    /// CHECK: matches listing.asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: matches listing.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptCounter<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: receives the price and listing rent.
    #[account(mut, address = listing.seller)]
    pub seller: UncheckedAccount<'info>,
    /// CHECK: receives the marketplace fee.
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = seller, seeds = [b"listing", asset.key().as_ref()], bump = listing.bump, has_one = asset, has_one = collection)]
    pub listing: Box<Account<'info, Listing>>,
    #[account(mut, close = buyer, seeds = [b"offer", asset.key().as_ref(), buyer.key().as_ref()], bump = offer.bump, has_one = buyer)]
    pub offer: Box<Account<'info, Offer>>,
    /// CHECK: matches listing.asset.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: matches listing.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ProposeTrade<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    /// CHECK: the owner of the wanted cards; checked against each card.
    pub counterparty: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(seeds = [b"collection", collection.key().as_ref()], bump = approved.bump, constraint = approved.enabled @ MarketError::CollectionDisabled)]
    pub approved: Box<Account<'info, ApprovedCollection>>,
    /// CHECK: Core collection matching `approved`.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    #[account(init, payer = proposer, space = Trade::SPACE, seeds = [b"trade", proposer.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub trade: Box<Account<'info, Trade>>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptTrade<'info> {
    #[account(mut)]
    pub counterparty: Signer<'info>,
    /// CHECK: receives the wanted cards and the trade rent.
    #[account(mut, address = trade.proposer)]
    pub proposer: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = proposer, seeds = [b"trade", trade.proposer.as_ref(), &trade.nonce.to_le_bytes()], bump = trade.bump, has_one = counterparty, has_one = collection)]
    pub trade: Box<Account<'info, Trade>>,
    /// CHECK: matches trade.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseTrade<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    /// CHECK: refunded the escrow and rent.
    #[account(mut, address = trade.proposer)]
    pub proposer: UncheckedAccount<'info>,
    #[account(seeds = [b"market"], bump = config.bump)]
    pub config: Box<Account<'info, MarketConfig>>,
    #[account(mut, close = proposer, seeds = [b"trade", trade.proposer.as_ref(), &trade.nonce.to_le_bytes()], bump = trade.bump, has_one = collection)]
    pub trade: Box<Account<'info, Trade>>,
    /// CHECK: matches trade.collection.
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: delegate PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core program.
    #[account(address = CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ------------------------------------------------------------------- state

#[account]
pub struct MarketConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
    pub authority_bump: u8,
}

impl MarketConfig {
    pub const SPACE: usize = 8 + 32 * 2 + 2 + 1 + 1 + 1;
}

#[account]
pub struct ApprovedCollection {
    pub collection: Pubkey,
    pub enabled: bool,
    pub bump: u8,
}

impl ApprovedCollection {
    pub const SPACE: usize = 8 + 32 + 1 + 1;
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub asset: Pubkey,
    pub collection: Pubkey,
    pub price: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Listing {
    pub const SPACE: usize = 8 + 32 * 3 + 8 + 8 + 1;
}

#[account]
pub struct Offer {
    pub buyer: Pubkey,
    pub asset: Pubkey,
    /// Lamports escrowed in this account on top of its rent.
    pub amount: u64,
    /// Seller's counter price; 0 when there is none.
    pub counter: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

impl Offer {
    pub const SPACE: usize = 8 + 32 * 2 + 8 * 4 + 1;
}

#[account]
pub struct Trade {
    pub proposer: Pubkey,
    pub counterparty: Pubkey,
    pub collection: Pubkey,
    pub nonce: u64,
    pub give: Vec<Pubkey>,
    pub want: Vec<Pubkey>,
    /// Lamports escrowed in this account on top of its rent.
    pub add_lamports: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub bump: u8,
}

impl Trade {
    pub const SPACE: usize = 8 + 32 * 3 + 8 + (4 + 32 * MAX_TRADE_CARDS) * 2 + 8 * 3 + 1;
}

// ------------------------------------------------------------------ events

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CloseReason {
    Cancelled,
    Declined,
    Expired,
    Accepted,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SaleKind {
    Buy,
    Offer,
    Counter,
}

#[event]
pub struct Listed {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
}

#[event]
pub struct PriceUpdated {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
}

#[event]
pub struct ListingClosed {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub reason: CloseReason,
}

#[event]
pub struct Sale {
    pub asset: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub fee: u64,
    pub kind: SaleKind,
}

#[event]
pub struct OfferMade {
    pub asset: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
}

#[event]
pub struct OfferCountered {
    pub asset: Pubkey,
    pub buyer: Pubkey,
    pub counter: u64,
}

#[event]
pub struct OfferClosed {
    pub asset: Pubkey,
    pub buyer: Pubkey,
    pub reason: CloseReason,
}

#[event]
pub struct TradeProposed {
    pub trade: Pubkey,
    pub proposer: Pubkey,
    pub counterparty: Pubkey,
    pub give: Vec<Pubkey>,
    pub want: Vec<Pubkey>,
    pub add_lamports: u64,
}

#[event]
pub struct TradeClosed {
    pub trade: Pubkey,
    pub proposer: Pubkey,
    pub counterparty: Pubkey,
    pub reason: CloseReason,
}

#[error_code]
pub enum MarketError {
    #[msg("Fee is above the 10% cap")]
    FeeTooHigh,
    #[msg("The marketplace is paused")]
    Paused,
    #[msg("Price must be above zero")]
    InvalidPrice,
    #[msg("Not a Metaplex Core asset")]
    NotCoreAsset,
    #[msg("Card is not in the approved collection")]
    WrongCollection,
    #[msg("Collection is not enabled")]
    CollectionDisabled,
    #[msg("Signer does not own this card")]
    NotOwner,
    #[msg("Card is already frozen or committed elsewhere")]
    AssetFrozen,
    #[msg("Price changed before this transaction landed")]
    PriceChanged,
    #[msg("You cannot buy or offer on your own listing")]
    OwnListing,
    #[msg("A counter must be above the offer")]
    CounterTooLow,
    #[msg("There is no counter to accept")]
    NoCounter,
    #[msg("Not expired yet")]
    NotExpired,
    #[msg("Trade cards are missing, duplicated or out of order")]
    BadTradeCards,
    #[msg("Add at least one card or some SOL")]
    EmptyTrade,
    #[msg("You cannot trade with yourself")]
    SelfTrade,
    #[msg("A wanted card changed hands")]
    CardMoved,
    #[msg("Only the counterparty can do this")]
    NotCounterparty,
    #[msg("Only the proposer can do this")]
    NotProposer,
    #[msg("Arithmetic overflow")]
    Overflow,
}
