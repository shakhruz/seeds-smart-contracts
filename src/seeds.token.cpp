/**
 *  @file
 *  @copyright defined in eos/LICENSE.txt
 */

#include <../include/seeds.token.hpp>

namespace eosio {

void token::create( const name&   issuer,
                    const asset&  initial_supply )
{
    require_auth( get_self() );

    auto sym = initial_supply.symbol;
    check( sym.is_valid(), "seeds: invalid symbol name" );
    check( initial_supply.is_valid(), "seeds: invalid supply");
    check( initial_supply.amount > 0, "seeds: max-supply must be positive");

    stats statstable( get_self(), sym.code().raw() );
    auto existing = statstable.find( sym.code().raw() );
    check( existing == statstable.end(), "seeds: token with symbol already exists" );

    statstable.emplace( get_self(), [&]( auto& s ) {
       s.supply.symbol = initial_supply.symbol;
       s.initial_supply  = initial_supply;
       s.issuer        = issuer;
    });
}


void token::issue( const name& to, const asset& quantity, const string& memo )
{
    auto sym = quantity.symbol;
    check( sym.is_valid(), "seeds: invalid symbol name" );
    check( memo.size() <= 256, "seeds: memo has more than 256 bytes" );

    stats statstable( get_self(), sym.code().raw() );
    auto existing = statstable.find( sym.code().raw() );
    check( existing != statstable.end(), "seeds: token with symbol does not exist, create token before issue" );
    const auto& st = *existing;
    check( to == st.issuer, "seeds: tokens can only be issued to issuer account" );

    require_auth( st.issuer );
    check( quantity.is_valid(), "seeds: invalid quantity" );
    check( quantity.amount > 0, "seeds: must issue positive quantity" );

    check( quantity.symbol == st.supply.symbol, "seeds: symbol precision mismatch" );

    statstable.modify( st, same_payer, [&]( auto& s ) {
       s.supply += quantity;
    });

    add_balance( st.issuer, quantity, st.issuer );
}

void token::retire( const asset& quantity, const string& memo )
{
    auto sym = quantity.symbol;
    check( sym.is_valid(), "seeds: invalid symbol name" );
    check( memo.size() <= 256, "seeds: memo has more than 256 bytes" );

    stats statstable( get_self(), sym.code().raw() );
    auto existing = statstable.find( sym.code().raw() );
    check( existing != statstable.end(), "seeds: token with symbol does not exist" );
    const auto& st = *existing;

    require_auth( st.issuer );
    check( quantity.is_valid(), "seeds: invalid quantity" );
    check( quantity.amount > 0, "seeds: must retire positive quantity" );

    check( quantity.symbol == st.supply.symbol, "seeds: symbol precision mismatch" );

    statstable.modify( st, same_payer, [&]( auto& s ) {
       s.supply -= quantity;
    });

    sub_balance( st.issuer, quantity );
}

void token::burn( const name& from, const asset& quantity )
{
  require_auth(from);

  auto sym = quantity.symbol;
  check(sym.is_valid(), "seeds: invalid symbol name");

  stats statstable(get_self(), sym.code().raw());
  auto sitr = statstable.find(sym.code().raw());

  sub_balance(from, quantity);

  statstable.modify(sitr, from, [&](auto& stats) {
    stats.supply -= quantity;
  });
}

void token::migrateall()
{
  require_auth(get_self());
 
  name old_token_account = name("seedstokennx"); 
  name gift_account = name("gift.seeds");

  user_tables users(contracts::accounts, contracts::accounts.value);

  asset total_distributed(0, seeds_symbol);

  auto uitr = users.begin();
  
  while (uitr != users.end()) {
    name user_account = uitr->account;
    
    accounts user_old_balances(old_token_account, user_account.value);
    
    accounts user_new_balances(get_self(), user_account.value);
    
    auto oitr = user_old_balances.find(seeds_symbol.code().raw());
    
    if (oitr != user_old_balances.end()) {
      asset user_balance = oitr->balance;
      
      auto nitr = user_new_balances.find(seeds_symbol.code().raw());
      
      if (nitr == user_new_balances.end()) {
        user_new_balances.emplace(get_self(), [&](auto& user) {
          user.balance = user_balance;
        });
        
        total_distributed += user_balance;
      }
    }

    uitr++;
  }
  
  accounts gift_balances(get_self(), gift_account.value);

  auto gitr = gift_balances.find(seeds_symbol.code().raw());
  
  gift_balances.modify(gitr, get_self(), [&](auto& gift) {
    gift.balance -= total_distributed;
  });  
}

void token::transfer( const name&    from,
                      const name&    to,
                      const asset&   quantity,
                      const string&  memo )
{
    check( from != to, "seeds: cannot transfer to self" );
    require_auth( from );
    check( is_account( to ), "seeds: to account does not exist");
    auto sym = quantity.symbol.code();
    stats statstable( get_self(), sym.raw() );
    const auto& st = statstable.get( sym.raw() );

    require_recipient( from );
    require_recipient( to );

    // check_limit(from);

    check( quantity.is_valid(), "seeds: invalid quantity" );
    check( quantity.amount > 0, "seeds: must transfer positive quantity" );
    check( quantity.symbol == st.supply.symbol, "seeds: symbol precision mismatch" );
    check( memo.size() <= 256, "seeds: memo has more than 256 bytes" );

    auto payer = has_auth( to ) ? to : from;

    sub_balance( from, quantity );
    add_balance( to, quantity, payer );
    
    // save_transaction(from, to, quantity, memo);

    update_stats( from, to, quantity );
}

void token::sub_balance( const name& owner, const asset& value ) {
   accounts from_acnts( get_self(), owner.value );

   const auto& from = from_acnts.find( value.symbol.code().raw());
   check( from != from_acnts.end(), "seeds: no balance object found for " + owner.to_string() );
   check( from->balance.amount >= value.amount, "seeds: overdrawn balance" );

   from_acnts.modify( from, owner, [&]( auto& a ) {
         a.balance -= value;
      });
}

void token::add_balance( const name& owner, const asset& value, const name& ram_payer )
{
   accounts to_acnts( get_self(), owner.value );
   auto to = to_acnts.find( value.symbol.code().raw() );
   if( to == to_acnts.end() ) {
      to_acnts.emplace( ram_payer, [&]( auto& a ){
        a.balance = value;
      });
   } else {
      to_acnts.modify( to, same_payer, [&]( auto& a ) {
        a.balance += value;
      });
   }
}

void token::save_transaction(name from, name to, asset quantity, string memo) {
  if (!is_account(contracts::accounts) || !is_account(contracts::history)) {
    // Before our accounts are created, don't record anything
    return;
  }
  
  action(
    permission_level{contracts::history, "active"_n},
    contracts::history, 
    "trxentry"_n,
    std::make_tuple(from, to, quantity, memo)
  ).send();

}

// FLAG - check tx limit is unclear - planted / 7 / day
void token::check_limit(const name& from) {

  // This needs to change - we need to store outgoing transactions number and timestamp separately in a 
  // separate table or maybe a scoped singleton

  // user_tables users(contracts::accounts, contracts::accounts.value);
  // auto uitr = users.find(from.value);

  // if (uitr == users.end()) {
  //   return;
  // }

  // name status = uitr->status;

  // uint64_t limit = 10;
  // if (status == "resident"_n) {
  //   limit = 50;
  // } else if (status == "citizen"_n) {
  //   limit = 100;
  // }

  // auto titr = transactions.find(from.value);
  // uint64_t current = titr->outgoing_transactions;

  // check(current < limit, "too many outgoing transactions");
}

void token::resetstats() {
  require_auth(get_self());
  
  user_tables users(contracts::accounts, contracts::accounts.value);


  auto uitr = users.begin();
  while (uitr != users.end()) {
    transaction_tables transactions(get_self(), uitr->account.value);

    auto titr = transactions.begin();
    while (titr != transactions.end()) {
      titr = transactions.erase(titr);
    }

    uitr++;
  }

}

void token::update_stats( const name& from, const name& to, const asset& quantity ) {

    user_tables users(contracts::accounts, contracts::accounts.value);
    
    auto fromuser = users.find(from.value);
    auto touser = users.find(to.value);
    
    if (fromuser == users.end() || touser == users.end()) {
      return;
    }

    transaction_tables transactions(get_self(), from.value);

    transactions.emplace(get_self(), [&](auto& tx) {
      tx.id = transactions.available_primary_key();
      tx.to = to;
      tx.quantity = quantity;
      tx.timestamp = eosio::current_time_point().sec_since_epoch();
    });

}

void token::open( const name& owner, const symbol& symbol, const name& ram_payer )
{
   require_auth( ram_payer );

   auto sym_code_raw = symbol.code().raw();

   stats statstable( get_self(), sym_code_raw );
   const auto& st = statstable.get( sym_code_raw, "symbol does not exist" );
   check( st.supply.symbol == symbol, "symbol precision mismatch" );

   accounts acnts( get_self(), owner.value );
   auto it = acnts.find( sym_code_raw );
   if( it == acnts.end() ) {
      acnts.emplace( ram_payer, [&]( auto& a ){
        a.balance = asset{0, symbol};
      });
   }
}

void token::close( const name& owner, const symbol& symbol )
{
   require_auth( owner );
   accounts acnts( get_self(), owner.value );
   auto it = acnts.find( symbol.code().raw() );
   check( it != acnts.end(), "Balance row already deleted or never existed. Action won't have any effect." );
   check( it->balance.amount == 0, "Cannot close because the balance is not zero." );
   acnts.erase( it );
}

} /// namespace eosio

EOSIO_DISPATCH( eosio::token, (create)(issue)(transfer)(open)(close)(retire)(burn)(resetstats)(migrateall) )
