#include <seeds.accounts.hpp>
#include <eosio/system.hpp>
#include <eosio/symbol.hpp>
#include <eosio/transaction.hpp>
#include <harvest_table.hpp>
#include <math.h>

void accounts::reset() {
  require_auth(_self);

  auto uitr = users.begin();
  while (uitr != users.end()) {
    utils::delete_table<vouch_tables>(contracts::accounts, uitr->account.value);

    utils::delete_table<flag_points_tables>(contracts::accounts, uitr->account.value);

    uitr = users.erase(uitr);
  }

  utils::delete_table<flag_points_tables>(contracts::accounts, flag_total_scope.value);
  utils::delete_table<flag_points_tables>(contracts::accounts, flag_remove_scope.value);

  utils::delete_table<vouches_tables>(contracts::accounts, contracts::accounts.value);

  utils::delete_table<vouches_totals_tables>(contracts::accounts, contracts::accounts.value);

  utils::delete_table<ref_tables>(contracts::accounts, contracts::accounts.value);

  utils::delete_table<cbs_tables>(contracts::accounts, contracts::accounts.value);
  utils::delete_table<cbs_tables>(contracts::accounts, organization_scope.value);

  utils::delete_table<rep_tables>(contracts::accounts, contracts::accounts.value);
  utils::delete_table<rep_tables>(contracts::accounts, organization_scope.value);

  utils::delete_table<size_tables>(contracts::accounts, contracts::accounts.value);

  utils::delete_table<ban_tables>(contracts::accounts, contracts::accounts.value);

  utils::delete_table<delegators_tables>(contracts::accounts, contracts::accounts.value);
  
  utils::delete_table<flags_tables>(contracts::accounts, contracts::accounts.value);
}

void accounts::history_add_resident(name account) {
  action(
    permission_level{contracts::history, "active"_n},
    contracts::history, "addresident"_n,
    std::make_tuple(account)
  ).send();
}

void accounts::history_add_citizen(name account) {
  action(
    permission_level{contracts::history, "active"_n},
    contracts::history, "addcitizen"_n,
    std::make_tuple(account)
  ).send();
}

void accounts::adduser(name account, string nickname, name type)
{
  require_auth(get_self());
  check(is_account(account), "no account");

  check(type == individual|| type == organization, "Invalid type: "+type.to_string()+" type must be either 'individual' or 'organisation'");
  check(nickname.size() <= 64, "nickname must be less than 65 characters long");

  auto uitr = users.find(account.value);
  check(uitr == users.end(), "existing user");

  users.emplace(_self, [&](auto& user) {
      user.account = account;
      user.status = visitor;
      user.reputation = 0;
      user.type = type;
      user.nickname = nickname;
      user.timestamp = eosio::current_time_point().sec_since_epoch();
  });

  size_change("users.sz"_n, 1);

}

void accounts::vouch(name sponsor, name account) {
  require_auth(sponsor);
  check_user(sponsor);
  check_user(account);

  check_is_banned(sponsor);
  check_is_banned(account);

  auto vouches_by_sponsor_account = vouches.get_index<"byspnsoracct"_n>();
  uint128_t sponsor_account_id = (uint128_t(sponsor.value) << 64) + account.value;
  
  auto vitr = vouches_by_sponsor_account.find(sponsor_account_id);
  check(vitr == vouches_by_sponsor_account.end(), "already vouched");

  auto uitrs = users.find(sponsor.value);
  auto uitra = users.find(account.value);

  name sponsor_status = uitrs->status;
  name account_status = uitra->status;

  check(sponsor_status == citizen || sponsor_status == resident, "sponsor must be a citizen or resident to vouch.");
  _vouch(sponsor, account);
}

/*
* Internal vouch function
*/
void accounts::_vouch(name sponsor, name account) {
  auto uitrs = users.find(sponsor.value);
  if (uitrs == users.end()) { return; }

  if (uitrs->type != individual) {
    return; // only individuals can vouch
  }

  check_user(account);

  auto vouches_by_sponsor_account = vouches.get_index<"byspnsoracct"_n>();
  uint128_t id = (uint128_t(sponsor.value) << 64) + account.value;
  auto vitr = vouches_by_sponsor_account.find(id);
  
  if (vitr == vouches_by_sponsor_account.end()) {
    name sponsor_status = uitrs->status;

    auto resident_basepoints = config_get(resident_vouch_points);
    auto citizen_basepoints = config_get(citizen_vouch_points);

    uint64_t vouch_points = 0;

    if (sponsor_status == resident) vouch_points = resident_basepoints;
    if (sponsor_status == citizen) vouch_points = citizen_basepoints;

    vouch_points *= utils::get_rep_multiplier(sponsor); // REPLACE with local function

    if (vouch_points > 0) {
      vouches.emplace(_self, [&](auto& item) {
        item.id = vouches.available_primary_key();
        item.sponsor = sponsor;
        item.account = account;
        item.vouch_points = vouch_points;
      });
    }
  }

  calc_vouch_rep(account); 
}

void accounts::pnishvouched (name sponsor, uint64_t start_account) {
  require_auth(get_self());

  uint64_t batch_size = config_get("batchsize"_n);
  uint128_t id = (uint128_t(sponsor.value) << 64) + start_account;

  auto vouches_by_account = vouches.get_index<"byaccount"_n>();
  auto vouches_by_sponsor_account = vouches.get_index<"byspnsoracct"_n>();
  uint64_t count = 0;
  uint64_t max_vouch = config_get(max_vouch_points);

  auto vitr = vouches_by_sponsor_account.lower_bound(id);

  while (vitr != vouches_by_sponsor_account.end() && vitr->sponsor == sponsor && count < batch_size) {

    vouches_by_sponsor_account.modify(vitr, _self, [&](auto & item){
      item.vouch_points = 0;
    });

    calc_vouch_rep(vitr->account);

    vitr++;
    count++;

  }

  if (vitr != vouches_by_sponsor_account.end() && vitr->sponsor == sponsor) {
    action next_execution(
      permission_level{get_self(), "active"_n},
      get_self(),
      "pnishvouched"_n,
      std::make_tuple(sponsor, (vitr->account).value)
    );

    transaction tx;
    tx.actions.emplace_back(next_execution);
    tx.delay_sec = 1;
    tx.send(sponsor.value, _self);
  }
}

void accounts::calc_vouch_rep (name account) {
  auto vouches_by_account = vouches.get_index<"byaccount"_n>();
  auto vitr = vouches_by_account.find(account.value);

  uint64_t max_vouch = config_get(max_vouch_points);
  uint64_t total_vouch = 0;
  uint64_t total_rep = 0;

  while (vitr != vouches_by_account.end() && vitr->account == account) {
    total_vouch += vitr -> vouch_points;
    vitr++;
  }

  auto vtitr = vouchtotals.find(account.value);
  if (vtitr != vouchtotals.end()) { total_rep = vtitr->total_rep_points; }

  uint64_t total_vouch_capped = std::min(total_vouch, max_vouch);
  uint64_t delta = 0;

  if (total_rep < total_vouch_capped) {
    
    delta = total_vouch_capped - total_rep;
    send_addrep(account, delta);
    total_rep += delta;

  } else if (total_rep > total_vouch_capped) {

    delta = total_rep - total_vouch_capped;
    send_subrep(account, delta);
    total_rep -= delta;

  }

  if (vtitr == vouchtotals.end()) {
    vouchtotals.emplace(_self, [&](auto & item){
      item.account = account;
      item.total_vouch_points = total_vouch;
      item.total_rep_points = total_rep;
    });
  } else {
    vouchtotals.modify(vtitr, _self, [&](auto & item){
      item.total_vouch_points = total_vouch;
      item.total_rep_points = total_rep;
    });
  }
}


void accounts::send_addrep(name user, uint64_t amount) {
    action(
      permission_level{_self, "active"_n},
      contracts::accounts, "addrep"_n,
      std::make_tuple(user, amount)
  ).send();
}

void accounts::send_subrep(name user, uint64_t amount) {
    action(
      permission_level{_self, "active"_n},
      contracts::accounts, "subrep"_n,
      std::make_tuple(user, amount)
  ).send();
}

void accounts::rewards(name account, name new_status) {
  vouchreward(account, new_status);
  refreward(account, new_status);
}

void accounts::vouchreward(name account, name new_status) {
  check_user(account);

  auto vouches_by_account = vouches.get_index<"byaccount"_n>();
  
  auto vitr = vouches_by_account.find(account.value);

  uint64_t points = 0;

  if (new_status == resident) {
    points = config_get("vouchrep.1"_n);
  } else if (new_status == citizen) {
    points = config_get("vouchrep.2"_n);
  }

  if (points == 0) { 
    return; 
  }

  while (vitr != vouches_by_account.end() && vitr -> account == account) {
    auto sponsor = vitr->sponsor;
    send_addrep(sponsor, points);     
    vitr++;
  }
}

void accounts::requestvouch(name account, name sponsor) {
  require_auth(account);
  check_user(sponsor);
  check_user(account);
  
  // Not implemented

}

name accounts::find_referrer(name account) {
  auto ritr = refs.find(account.value);
  if (ritr != refs.end()) return ritr->referrer;
      
  return not_found;
}

uint64_t calc_decaying_rewards(int num, int min, int max, int decay) {
  auto res = round(min + (max-min) * exp(-1*(num+1)/double(decay)));
  // check(false, ("DEBUG: calc rewards res="+std::to_string(res)+ ", num="+std::to_string(num)+
  //  ", min="+std::to_string(min)+", max= "+std::to_string(max)+", decay= "+std::to_string(decay)));

  return uint64_t(res);
}

void accounts::refreward(name account, name new_status) {
  check_user(account);

  bool is_citizen = new_status.value == citizen.value;
    
  name referrer = find_referrer(account);
  if (referrer == not_found) {
    return;
  }

  // see if referrer is org or individual (or nobody)
  auto uitr = users.find(referrer.value);
  if (uitr != users.end()) {
    uint64_t community_building_points = 0;
    auto user_type = uitr->type;

    // gets number of residents or citizens from the History size table
    auto size_id = is_citizen ? "citizens.sz"_n : "residents.sz"_n;
    auto sitr = history_sizes.find(size_id.value);
    auto num_users = (sitr == sizes.end()) ? 0 : sitr->size;

    if (user_type == "organisation"_n) 
    {
      community_building_points = is_citizen ? config_get("refcbp2.org"_n) : config_get("refcbp1.org"_n);
      name org_reward_param = is_citizen ? org_seeds_reward_citizen : org_seeds_reward_resident;
      name min_org_reward_param = is_citizen ? min_org_seeds_reward_citizen : min_org_seeds_reward_resident;
      name dec_org_reward_param = is_citizen ? dec_org_seeds_reward_citizen : dec_org_seeds_reward_resident;
      auto max_org = config_get(org_reward_param);
      auto min_org = config_get(min_org_reward_param);
      auto dec_org = config_get(dec_org_reward_param);

      auto org_seeds_reward = calc_decaying_rewards(num_users, min_org, max_org, dec_org);
      asset org_quantity(org_seeds_reward, seeds_symbol);

      // send reward to org
      send_reward(referrer, org_quantity);

      name amb_reward_param = is_citizen ? ambassador_seeds_reward_citizen : ambassador_seeds_reward_resident;
      name min_amb_reward_param = is_citizen ? min_ambassador_seeds_reward_citizen : min_ambassador_seeds_reward_resident;
      name dec_amb_reward_param = is_citizen ? dec_ambassador_seeds_reward_citizen : dec_ambassador_seeds_reward_resident;
      auto max_amb = config_get(amb_reward_param);
      auto min_amb = config_get(min_amb_reward_param);
      auto dec_amb = config_get(dec_amb_reward_param);

      auto amb_seeds_reward = calc_decaying_rewards(num_users, min_amb, max_amb, dec_amb);
      asset amb_quantity(amb_seeds_reward, seeds_symbol);

      // send reward to ambassador if we have one
      name org_owner = find_referrer(referrer);
      if (org_owner != not_found) {
        name ambassador = find_referrer(org_owner);
        if (ambassador != not_found) {
          send_reward(ambassador, amb_quantity);
        }
      }
    } 
    else 
    {
      community_building_points = is_citizen ? config_get("ref.cbp2.ind"_n) : config_get("ref.cbp1.ind"_n);

      // Add reputation point +1
      name reputation_reward_param = is_citizen ? reputation_reward_citizen : reputation_reward_resident;
      auto rep_points = config_get(reputation_reward_param);

      name seed_reward_param = is_citizen ? individual_seeds_reward_citizen : individual_seeds_reward_resident;
      name min_seed_reward_param = is_citizen ? min_individual_seeds_reward_citizen : min_individual_seeds_reward_resident;
      name dec_seed_reward_param = is_citizen ? dec_individual_seeds_reward_citizen : dec_individual_seeds_reward_resident;
      auto max = config_get(seed_reward_param);
      auto min = config_get(min_seed_reward_param);
      auto dec = config_get(dec_seed_reward_param);

      auto seeds_reward = calc_decaying_rewards(num_users, min, max, dec);
      asset quantity(seeds_reward, seeds_symbol);

      send_addrep(referrer, rep_points);

      send_reward(referrer, quantity);
    }

    add_cbs(referrer, community_building_points); 

  }


  // if referrer is org, find ambassador and add referral there

}

void accounts::add_cbs(name account, int points) {

  auto uitr = users.find(account.value);

  name scope = get_scope(uitr->type);

  cbs_tables cbs_t(get_self(), scope.value);

  auto citr = cbs_t.find(account.value);
  if (citr != cbs_t.end()) {
    cbs_t.modify(citr, _self, [&](auto& item) {
      item.community_building_score += points;
    });
  } else {
    cbs_t.emplace(_self, [&](auto& item) {
      item.account = account;
      item.community_building_score = points;
      item.rank = 0;
    });
    if (scope == individual_scope) {
      size_change("cbs.sz"_n, 1);
    } else if (scope == organization_scope) {
      size_change("cbs.org.sz"_n, 1);
    }
  }
}

ACTION accounts::addcbs (name account, int points) {
  require_auth(get_self());
  add_cbs(account, points);
}

void accounts::addref(name referrer, name invited)
{
  require_auth(get_self());

  check(is_account(referrer), "wrong referral");
  check(is_account(invited), "wrong invited");

  refs.emplace(_self, [&](auto& ref) {
    ref.referrer = referrer;
    ref.invited = invited;
  });

}

// internal vouch function
void accounts::invitevouch(name referrer, name invited) 
{
  require_auth(get_self());

  _vouch(referrer, invited);
}

void accounts::addrep(name user, uint64_t amount)
{
  require_auth(get_self());

  check(is_account(user), "non existing user");
  check(amount > 0, "amount must be > 0");

  auto uitr = users.find(user.value);

  users.modify(uitr, _self, [&](auto& user) {
    user.reputation += amount;
  });

  name scope = get_scope(uitr->type);

  rep_tables rep_t(get_self(), scope.value);

  auto ritr = rep_t.find(user.value);
  if (ritr == rep_t.end()) {
    add_rep_item(user, amount, scope);
  } else {
    rep_t.modify(ritr, _self, [&](auto& item) {
      item.rep += amount;
    });
  }

}

void accounts::subrep(name user, uint64_t amount)
{
  require_auth(get_self());

  check(is_account(user), "non existing user");
  check(amount > 0, "amount must be > 0");

  // modify user reputation - deprecated
  auto uitr = users.find(user.value);

  users.modify(uitr, _self, [&](auto& user) {
    if (user.reputation < amount) {
      user.reputation = 0;
    } else {
      user.reputation -= amount;
    }
  });

  name scope = get_scope(uitr->type);

  rep_tables rep_t(get_self(), scope.value);

  auto ritr = rep_t.find(user.value);
  if (ritr != rep_t.end()) {
    if (ritr->rep > amount) {
      rep_t.modify(ritr, _self, [&](auto& item) {
        item.rep -= amount;
      });
    } else {
      rep_t.erase(ritr);
      if (scope == individual_scope) {
        size_change("rep.sz"_n, -1);
      } else if (scope == organization_scope) {
        size_change("rep.org.sz"_n, -1);
      }
    }
  }

}

name accounts::get_scope (name type) {
  if (type == "individual"_n) {
    return individual_scope;
  } else if (type == "organisation"_n) {
    return organization_scope;
  }
  return not_found;
}

void accounts::update(name user, name type, string nickname, string image, string story, string roles, string skills, string interests)
{
    require_auth(user);

    check(type == individual || type == organization, "invalid type");

    auto uitr = users.find(user.value);

    check(uitr->type == type, "Can't change type - create an org in the org contract.");
    check(nickname.size() <= 64, "nickname must be less or equal to 64 characters long");
    check(image.size() <= 512, "image url must be less or equal to 512 characters long");
    check(story.size() <= 7000, "story length must be less or equal to 7000 characters long");
    check(roles.size() <= 512, "roles length must be less or equal to 512 characters long");
    check(skills.size() <= 512, "skills must be less or equal to 512 characters long");
    check(interests.size() <= 512, "interests must be less or equal to 512 characters long");

    users.modify(uitr, _self, [&](auto& user) {
      user.type = type;
      user.nickname = nickname;
      user.image = image;
      user.story = story;
      user.roles = roles;
      user.skills = skills;
      user.interests = interests;
    });
}

void accounts::send_reward(name beneficiary, asset quantity)
{
  // Check balance - if the balance runs out, the rewards run out too.
  token_accts accts(contracts::token, bankaccts::referrals.value);
  const auto& acc = accts.get(symbol("SEEDS", 4).code().raw());
  auto rem_balance = acc.balance;
  if (quantity > rem_balance) {
    // Should not fail in case not enough balance
    // check(false, ("DEBUG: not enough balance on "+bankaccts::referrals.to_string()+" = "+rem_balance.to_string()+", required= "+quantity.to_string()).c_str());
    return;
  }

  send_to_escrow(bankaccts::referrals, beneficiary, quantity, "referral reward");
}

void accounts::send_to_escrow(name fromfund, name recipient, asset quantity, string memo)
{

  action(
      permission_level{fromfund, "active"_n},
      contracts::token, "transfer"_n,
      std::make_tuple(fromfund, contracts::escrow, quantity, memo))
      .send();

  action(
      permission_level{fromfund, "active"_n},
      contracts::escrow, "lock"_n,
      std::make_tuple("event"_n,
                      fromfund,
                      recipient,
                      quantity,
                      "golive"_n,
                      "dao.hypha"_n,
                      time_point(current_time_point().time_since_epoch() +
                                 current_time_point().time_since_epoch()), // long time from now
                      memo))
      .send();
}

void accounts::testreward() {
  require_auth(get_self());

  asset quantity(1, seeds_symbol);

  send_reward("accts.seeds"_n, quantity);

}

void accounts::canresident(name user) {
    check_can_make_resident(user);
}

void accounts::makeresident(name user)
{
    check_can_make_resident(user);

    auto new_status = resident;

    updatestatus(user, new_status);

    rewards(user, new_status);
    
    history_add_resident(user);
}

bool accounts::check_can_make_resident(name user) {
    auto uitr = users.find(user.value);
    check(uitr != users.end(), "no user");
    check(uitr->status == visitor, "user is not a visitor");

    auto bitr = balances.find(user.value);

    uint64_t invited_users_number = countrefs(user, 0);
    uint64_t min_planted = config_get("res.plant"_n);
    uint64_t min_tx = config_get("res.tx"_n);
    uint64_t min_invited = config_get("res.referred"_n);
    uint64_t min_rep = config_get("res.rep.pt"_n);

    uint64_t total_transactions = num_transactions(user, min_tx);

    uint64_t reputation_points = rep.get(user.value,  "user has less than required reputation. Actual: 0").rep;

    check(bitr->planted.amount >= min_planted, "user has less than required seeds planted");
    check(total_transactions >= min_tx, "resident: user has less than required transactions number has: "+
      std::to_string(total_transactions) + " needed: "+
      std::to_string(min_tx));
    check(invited_users_number >= min_invited, "user has less than required referrals. Required: " + std::to_string(min_invited) + " Actual: " + std::to_string(invited_users_number));
    check(reputation_points >= min_rep, "user has less than required reputation. Required: " + std::to_string(min_rep) + " Actual: " + std::to_string(reputation_points));

    return true;
}

void accounts::updatestatus(name user, name status)
{
  auto uitr = users.find(user.value);

  check(uitr != users.end(), "updatestatus: user not found - " + user.to_string());
  check(uitr->type == individual, "updatestatus: Only individuals can become residents or citizens");

  users.modify(uitr, _self, [&](auto& user) {
    user.status = status;
  });

  bool trust = status == citizen;

  action(
    permission_level{contracts::proposals, "active"_n},
    contracts::proposals, "changetrust"_n,
    std::make_tuple(user, trust)
  ).send();

}

uint64_t accounts::config_get(name key) {
  auto citr = config.find(key.value);
  if (citr == config.end()) { 
    // only create the error message string in error case for efficiency
    check(false, ("settings: the "+key.to_string()+" parameter has not been initialized").c_str());
  }
  return citr->value;
}

double accounts::config_float_get (name key) {
  auto fitr = configfloat.find(key.value);
  if (fitr == configfloat.end()) { 
    // only create the error message string in error case for efficiency
    check(false, ("settings: the "+key.to_string()+" parameter has not been initialized").c_str());
  }
  return fitr->value;
}

void accounts::cancitizen(name user) {
  check_can_make_citizen(user);
}

void accounts::makecitizen(name user)
{
    check_can_make_citizen(user);
    
    auto new_status = citizen;

    updatestatus(user, new_status);

    auto aitr = actives.find(user.value);
    if (aitr == actives.end()) {
      rewards(user, new_status);
      history_add_citizen(user);
    }

    add_active(user);
}

bool accounts::check_can_make_citizen(name user) {
    auto uitr = users.find(user.value);
    check(uitr != users.end(), "no user");
    check(uitr->status == resident, "user is not a resident");

    auto bitr = balances.find(user.value);

    uint64_t min_planted = config_get("cit.plant"_n);
    uint64_t min_tx = config_get("cit.tx"_n);
    uint64_t min_invited = config_get("cit.referred"_n);
    uint64_t min_residents_invited = config_get("cit.ref.res"_n);
    uint64_t min_rep_score = config_get("cit.rep.sc"_n);
    uint64_t min_account_age = config_get("cit.age"_n);

    uint64_t invited_users_number = countrefs(user, min_residents_invited);
    uint64_t _rep_score = rep_score(user);

    uint64_t total_transactions = num_transactions(user, min_tx);

    check(bitr->planted.amount >= min_planted, "user has less than required seeds planted");
    check(total_transactions >= min_tx, "user has less than required transactions number has: "+
      std::to_string(total_transactions) + " needed: "+
      std::to_string(min_tx));
    check(invited_users_number >= min_invited, "user has less than required referrals. Required: " + std::to_string(min_invited) + " Actual: " + std::to_string(invited_users_number));
    check(_rep_score >= min_rep_score, "user has less than required reputation. Required: " + std::to_string(min_rep_score) + " Actual: " + std::to_string(_rep_score));
    check(uitr->timestamp <= eosio::current_time_point().sec_since_epoch() - min_account_age, "User account must be older than 2 cycles");

    return true;
}

void accounts::add_active (name user) {
  action(
    permission_level(contracts::proposals, "active"_n),
    contracts::proposals,
    "addactive"_n,
    std::make_tuple(user)
  ).send();
}

void accounts::testresident(name user)
{
  require_auth(_self);

  auto new_status = resident;
  updatestatus(user, new_status);

  rewards(user, new_status);
  
  history_add_resident(user);
}

void accounts::testvisitor(name user)
{
  require_auth(_self);

  auto new_status = visitor;
  updatestatus(user, new_status);
  
}

void accounts::testcitizen(name user)
{
  require_auth(_self);

  auto new_status = citizen;

  updatestatus(user, new_status);

  rewards(user, new_status);
  
  history_add_citizen(user);

  add_active(user);
}

// return number of transactions outgoing, until a limit
uint32_t accounts::num_transactions(name account, uint32_t limit) {
  auto titr = totals.find(account.value);
  
  if (titr == totals.end()) {
    return 0;
  }

  return titr -> total_number_of_transactions;
}

void accounts::rankreps() {
  rankrep(0, 0, 200, individual_scope);
}

void accounts::rankorgreps() {
  rankrep(0, 0, 200, organization_scope);
}

void accounts::rankrep(uint64_t start_val, uint64_t chunk, uint64_t chunksize, name scope) {
  require_auth(_self);

  uint64_t total = 0;
  if (scope == individual_scope) {
    total = get_size("rep.sz"_n);
  } else if (scope == organization_scope) {
    total = get_size("rep.org.sz"_n);
  }
  if (total == 0) return;

  rep_tables rep_t(get_self(), scope.value);

  uint64_t current = chunk * chunksize;
  auto rep_by_rep = rep_t.get_index<"byrep"_n>();
  auto ritr = start_val == 0 ? rep_by_rep.begin() : rep_by_rep.lower_bound(start_val);
  uint64_t count = 0;

  while (ritr != rep_by_rep.end() && count < chunksize) {

    uint64_t rank = utils::spline_rank(current, total);

    rep_by_rep.modify(ritr, _self, [&](auto& item) {
      item.rank = rank;
    });

    current++;
    count++;
    ritr++;
  }

  if (ritr == rep_by_rep.end()) {
    // Done.
  } else {
    // recursive call
    uint64_t next_value = ritr->by_rep();
    action next_execution(
        permission_level{get_self(), "active"_n},
        get_self(),
        "rankrep"_n,
        std::make_tuple(next_value, chunk + 1, chunksize, scope)
    );

    transaction tx;
    tx.actions.emplace_back(next_execution);
    tx.delay_sec = 1;
    tx.send(next_value + 1, _self);
    
  }

}

void accounts::rankcbss() {
  rankcbs(0, 0, 200, individual_scope);
}

void accounts::rankorgcbss() {
  rankcbs(0, 0, 200, organization_scope);
}

void accounts::rankcbs(uint64_t start_val, uint64_t chunk, uint64_t chunksize, name scope) {
  require_auth(_self);

  uint64_t total = 0;

  if (scope == individual_scope) {
    total = get_size("cbs.sz"_n);
  } else {
    total = get_size("cbs.org.sz"_n);
  }
  if (total == 0) return;

  cbs_tables cbs_t(get_self(), scope.value);

  uint64_t current = chunk * chunksize;
  auto cbs_by_cbs = cbs_t.get_index<"bycbs"_n>();
  auto citr = start_val == 0 ? cbs_by_cbs.begin() : cbs_by_cbs.lower_bound(start_val);
  uint64_t count = 0;

  while (citr != cbs_by_cbs.end() && count < chunksize) {

    uint64_t rank = utils::spline_rank(current, total);

    cbs_by_cbs.modify(citr, _self, [&](auto& item) {
      item.rank = rank;
    });

    current++;
    count++;
    citr++;
  }

  if (citr == cbs_by_cbs.end()) {
    // Done.
  } else {
    // recursive call
    uint64_t next_value = citr->by_cbs();
    action next_execution(
        permission_level{get_self(), "active"_n},
        get_self(),
        "rankcbs"_n,
        std::make_tuple(next_value, chunk + 1, chunksize, scope)
    );

    transaction tx;
    tx.actions.emplace_back(next_execution);
    tx.delay_sec = 1;
    tx.send(next_value + 1, _self);
    
  }

}

void accounts::add_rep_item(name account, uint64_t reputation, name scope) {
  check(reputation > 0, "reputation must be > 0");

  rep_tables rep_t(get_self(), scope.value);

  rep_t.emplace(_self, [&](auto& item) {
    item.account = account;
    item.rep = reputation;
  });

  if (scope == individual_scope) {
    size_change("rep.sz"_n, 1);
  } else if (scope == organization_scope) {
    size_change("rep.org.sz"_n, 1);
  }
}

void accounts::changesize(name id, int64_t delta) {
  require_auth(get_self());
  size_change(id, delta);
}

void accounts::size_change(name id, int delta) {
  auto sitr = sizes.find(id.value);
  if (sitr == sizes.end()) {
    sizes.emplace(_self, [&](auto& item) {
      item.id = id;
      item.size = delta;
    });
  } else {
    uint64_t newsize = sitr->size + delta; 
    if (delta < 0) {
      if (sitr->size < -delta) {
        newsize = 0;
      }
    }
    sizes.modify(sitr, _self, [&](auto& item) {
      item.size = newsize;
    });
  }
}

void accounts::size_set(name id, uint64_t newsize) {
  auto sitr = sizes.find(id.value);
  if (sitr == sizes.end()) {
    sizes.emplace(_self, [&](auto& item) {
      item.id = id;
      item.size = newsize;
    });
  } else {
    sizes.modify(sitr, _self, [&](auto& item) {
      item.size = newsize;
    });
  }
}

uint64_t accounts::get_size(name id) {
  auto sitr = sizes.find(id.value);
  if (sitr == sizes.end()) {
    return 0;
  } else {
    return sitr->size;
  }
}

void accounts::testremove(name user)
{
  require_auth(_self);

  auto uitr = users.find(user.value);

  check(uitr != users.end(), "testremove: user not found - " + user.to_string());

  vouch_tables vouch(get_self(), user.value);
  auto vitr = vouch.begin();
  while (vitr != vouch.end()) {
    if (vitr->account == user) {
      vitr = vouch.erase(vitr);
    } else {
      vitr++;
    }
  }

  action(
    permission_level{contracts::proposals, "active"_n},
    contracts::proposals, "changetrust"_n,
    std::make_tuple(user, false)
  ).send();

  users.erase(uitr);
  size_change("users.sz"_n, -1);
  
}

void accounts::testsetrep(name user, uint64_t amount) {
  require_auth(get_self());

  check(is_account(user), "non existing user");

  auto uitr = users.find(user.value);
  users.modify(uitr, _self, [&](auto& user) {
    user.reputation = amount;
  });

  name scope = get_scope(uitr->type);

  rep_tables rep_t(get_self(), scope.value);

  auto ritr = rep_t.find(user.value);
  if (ritr == rep_t.end()) {
    add_rep_item(user, amount, scope);
  } else {
    rep_t.modify(ritr, _self, [&](auto& item) {
      item.rep = amount;
    });
  }
}

void accounts::testsetrs(name user, uint64_t amount) {
  require_auth(get_self());

  check(is_account(user), "non existing user");

  auto uitr = users.find(user.value);
  if (uitr == users.end()) { return; }

  name scope = get_scope(uitr->type);

  rep_tables rep_t(get_self(), scope.value);

  auto ritr = rep_t.find(user.value);
  if (ritr == rep_t.end()) {
    rep_t.emplace(_self, [&](auto& item) {
      item.account = user;
      item.rank = amount;
    });
    if (scope == individual_scope) {
      size_change("rep.sz"_n, 1);
    } else if (scope == organization_scope) {
      size_change("rep.org.sz"_n, 1);
    }
  } else {
    rep_t.modify(ritr, _self, [&](auto& item) {
      item.rank = amount;
    });
  }
}

void accounts::send_add_cbs_org (name user, uint64_t amount) {
  action(
    permission_level(contracts::organization, "active"_n),
    contracts::organization,
    "addcbpoints"_n,
    std::make_tuple(user, amount)
  ).send();
}


void accounts::testsetcbs(name user, uint64_t amount) {
  require_auth(get_self());

  check(is_account(user), "non existing user");

  auto usritr = users.find(user.value);
  
  name scope = get_scope(usritr->type);

  cbs_tables cbs_t(get_self(), scope.value);

  auto citr = cbs_t.find(user.value);
  if (citr == cbs_t.end()) {
    cbs_t.emplace(_self, [&](auto& item) {
      item.account = user;
      item.community_building_score = amount;
      item.rank = 0;
    });
    if (scope == individual_scope) {
      size_change("cbs.sz"_n, 1);
    } else {
      size_change("cbs.org.sz"_n, 1);
    }
  } else {
    cbs_t.modify(citr, _self, [&](auto& item) {
      item.community_building_score = amount;
    });
  }
}

void accounts::check_user(name account)
{
  auto uitr = users.find(account.value);
  check(uitr != users.end(), "no user");
}

uint64_t accounts::countrefs(name user, int check_num_residents) 
{
    auto refs_by_referrer = refs.get_index<"byreferrer"_n>();
    if (check_num_residents == 0) {
      return std::distance(refs_by_referrer.lower_bound(user.value), refs_by_referrer.upper_bound(user.value));
    } else {
      uint64_t count = 0;
      int residents = 0;
      auto ritr = refs_by_referrer.lower_bound(user.value);
      while (ritr != refs_by_referrer.end() && ritr->referrer == user) {
        auto uitr = users.find(ritr->invited.value);
        if (uitr != users.end()) {
          if (uitr->status == "resident"_n || uitr->status == "citizen"_n) {
            residents++;
          }
        }
        ritr++;
        count++;
      }
      check(residents >= check_num_residents, "user has not referred enough residents or citizens: "+std::to_string(residents));
      return count;
    }


}

void accounts::send_bantree(name account) {
  action send_ban(
    permission_level(get_self(), "active"_n),
    get_self(),
    "bantree"_n,
    std::make_tuple(account, true)
  );

  transaction tx;
  tx.actions.emplace_back(send_ban);
  tx.delay_sec = 1;
  tx.send(account.value, _self);

}

ACTION accounts::bantree(name account, bool recurse) 
{
    require_auth(get_self());

    ban_tables ban(contracts::accounts, contracts::accounts.value);

    auto bitr = ban.find(account.value);
    if (bitr == ban.end()) {
      ban.emplace(_self, [&](auto & item){
        item.account = account;
      });
    } 

    auto refs_by_referrer = refs.get_index<"byreferrer"_n>();

    auto ritr = refs_by_referrer.lower_bound(account.value);
    
    while (ritr != refs_by_referrer.end() && ritr->referrer == account) {
      name invited = ritr->invited;
      if (recurse) {
        send_bantree(invited);
      } else {
        print(" invited: "+invited.to_string());
      }
      ritr++;
    }
}

ACTION accounts::refinfo(name account) 
{
    require_auth(get_self());

    print("ref "+account.to_string());

    auto ritr = refs.find(account.value);

    check(ritr != refs.end(), "is root account: "+account.to_string());
    
    while (ritr != refs.end()) {
      name referrer = ritr->referrer;
      print(" <- "+referrer.to_string());
      ritr = refs.find(referrer.value);
    }
}

ACTION accounts::unban(name account) 
{
    require_auth(get_self());

    ban_tables ban(contracts::accounts, contracts::accounts.value);

    auto bitr = ban.find(account.value);
    check(bitr != ban.end(), "account not in ban table");
    ban.erase(bitr);  
}

uint64_t accounts::rep_score(name user) 
{

    auto ritr = rep.find(user.value);

    if (ritr == rep.end()) {
      return 0;
    }

    return ritr->rank;
}

void accounts::send_punish (name account, uint64_t points) {
  action(
    permission_level(get_self(), "active"_n),
    get_self(),
    "punish"_n,
    std::make_tuple(account, points)
  ).send();
}

void accounts::punish (name account, uint64_t points) {
  require_auth(get_self());
  check_user(account);
  send_subrep(account, points);
  pnishvouched(account, uint64_t(0));
}

void accounts::send_punish_vouchers (name account, uint64_t points) {
  action(
    permission_level(get_self(), "active"_n),
    get_self(),
    "pnshvouchers"_n,
    std::make_tuple(account, points, uint64_t(0))
  ).send();
}

void accounts::pnshvouchers (name account, uint64_t points, uint64_t start) {
  require_auth(get_self());

  auto vouches_by_account_sponsor = vouches.get_index<"byacctspnsor"_n>();
  uint128_t id = (uint128_t(account.value) << 64) + start;

  auto vitr = vouches_by_account_sponsor.lower_bound(id);
  uint64_t count = 0;
  uint64_t batch_size = config_get("batchsize"_n);
  uint64_t lost_points = points * config_float_get("flag.vouch.p"_n);

  while (vitr != vouches_by_account_sponsor.end() && vitr->account == account && count < batch_size) {
    send_subrep(vitr -> sponsor, lost_points);
    vitr++;
    count++;
  }

  if (vitr != vouches_by_account_sponsor.end() && vitr->account == account) {
    uint64_t next_value = (vitr -> sponsor).value;
    
    action next_execution(
        permission_level{get_self(), "active"_n},
        get_self(),
        "pnshvouchers"_n,
        std::make_tuple(account, points, next_value)
    );

    transaction tx;
    tx.actions.emplace_back(next_execution);
    // tx.delay_sec = 1;
    tx.send(next_value, _self);
  }
}

void accounts::flag (name from, name to) {
  require_auth(has_auth(from) ? from : get_self());

  check_is_banned(from);

  if (from == to) { return; }

  flag_points_tables flag_points(get_self(), to.value);
  flag_points_tables total_flags(get_self(), flag_total_scope.value);
  flag_points_tables removed_flags(get_self(), flag_remove_scope.value);

  auto fitr = flag_points.find(from.value);
  check(fitr == flag_points.end(), "a user can only flag another user once");

  auto flags_by_from_to = flags.get_index<"byfromto"_n>();
  auto flags_from_to_itr = flags_by_from_to.find((uint128_t(from.value) << 64) + to.value);
  check(flags_from_to_itr == flags_by_from_to.end(), "can only flag once");

  uint64_t points = 0;
  uint64_t base_points = 0;
  auto uitr = users.get(from.value, "user not found");

  if (uitr.status == citizen) {
    base_points = config_get("flag.base.c"_n);
  } else if (uitr.status == resident) {
    base_points = config_get("flag.base.r"_n);
  } else {
    check(false, "user must be a resident or a citizen");
  }

  auto ritr = rep.get(from.value, (from.to_string() + " needs reputation to flag others").c_str());
  
  points = base_points * utils::rep_multiplier_for_score(ritr.rank);

  flag_points.emplace(_self, [&](auto & item){
    item.account = from;
    item.flag_points = points;
  });

  flags.emplace(_self, [&](auto & item){
    item.id = flags.available_primary_key();
    item.from = from;
    item.to = to;
    item.flag_points = points;
  });

  uint64_t total_flag_points = 0;
  uint64_t removed_flag_points = 0;

  auto total_flag_p_itr = total_flags.find(to.value);
  if (total_flag_p_itr != total_flags.end()) { total_flag_points = total_flag_p_itr -> flag_points; }
  total_flag_points += points;

  auto removed_flag_p_itr = removed_flags.find(to.value);
  if (removed_flag_p_itr != removed_flags.end()) { removed_flag_points = removed_flag_p_itr -> flag_points; }

  uint64_t flag_threshold = config_get("flag.thresh"_n);

  if (total_flag_points >= flag_threshold && removed_flag_points < total_flag_points) {

    auto to_rep_itr = rep.find(to.value);
    if (to_rep_itr != rep.end()) {
      uint64_t punishment_points = total_flag_points - removed_flag_points;

      send_punish(to, punishment_points);
      send_eval_demote(to);
      send_punish_vouchers(to, punishment_points);
      
      if (removed_flag_p_itr == removed_flags.end()) {
        removed_flags.emplace(_self, [&](auto & item){
          item.account = to;
          item.flag_points = total_flag_points;
        });
      } else {
        removed_flags.modify(removed_flag_p_itr, _self, [&](auto & item){
          item.flag_points = total_flag_points;
        });
      }
    }

  }

  if (total_flag_p_itr == total_flags.end()) {
    total_flags.emplace(_self, [&](auto & item){
      item.account = to;
      item.flag_points = total_flag_points;
    });
  } else {
    total_flags.modify(total_flag_p_itr, _self, [&](auto & item){
      item.flag_points = total_flag_points;
    });
  }

  utils::send_deferred_transaction(
    get_self(),
    permission_level(get_self(), "active"_n),
    get_self(),
    "mimicflag"_n,
    std::make_tuple(from, to, "flag"_n, config_get(name("batchsize")))
  );

}

void accounts::removeflag (name from, name to) {
  require_auth(has_auth(from) ? from : get_self());

  flag_points_tables flag_points(get_self(), to.value);
  flag_points_tables total_flags(get_self(), flag_total_scope.value);
  auto flags_by_from_to = flags.get_index<"byfromto"_n>();

  auto flag_itr = flag_points.find(from.value);
  check(flag_itr != flag_points.end(), "flag points not found");

  auto flags_from_to_itr = flags_by_from_to.find((uint128_t(from.value) << 64) + to.value);
  check(flags_from_to_itr != flags_by_from_to.end(), "flag not found");

  auto total_flag_p_itr = total_flags.find(to.value);
  check(total_flag_p_itr != flag_points.end(), to.to_string() + ", has not total flags entry");

  total_flags.modify(total_flag_p_itr, _self, [&](auto & item){
    item.flag_points -= flag_itr -> flag_points;
  });

  flag_points.erase(flag_itr);
  flags_by_from_to.erase(flags_from_to_itr);

  utils::send_deferred_transaction(
    get_self(),
    permission_level(get_self(), "active"_n),
    get_self(),
    "mimicflag"_n,
    std::make_tuple(from, to, "removeflag"_n, config_get(name("batchsize")))
  );
}

void accounts::check_is_banned(name account)
{
  ban_tables ban(contracts::accounts, contracts::accounts.value);

  auto bitr = ban.find(account.value);
  check(bitr == ban.end(), "banned user.");
}

void accounts::send_eval_demote (name to) {
  
  uint64_t batch_size = config_get(name("batchsize"));

  action next_execution(
    permission_level(get_self(), "active"_n),
    get_self(),
    "evaldemote"_n,
    std::make_tuple(to, uint64_t(0), uint64_t(0), batch_size)
  );

  transaction tx;
  tx.actions.emplace_back(next_execution);
  tx.delay_sec = 1;
  tx.send(to.value + 1, _self);

}

void accounts::evaldemote (name to, uint64_t start_val, uint64_t chunk, uint64_t chunksize) {
  require_auth(get_self());

  auto uritr = rep.find(to.value);
  if (uritr == rep.end()) {
    updatestatus(to, visitor);
    return;
  }

  uint64_t total = get_size("rep.sz"_n);
  if (total == 0) return;

  uint64_t current = chunk * chunksize;
  auto rep_by_rep = rep.get_index<"byrep"_n>();
  auto ritr = start_val == 0 ? rep_by_rep.begin() : rep_by_rep.lower_bound(start_val);
  uint64_t count = 0;
  bool evaluated = false;

  while (ritr != rep_by_rep.end() && count < chunksize) {

    if (ritr->account == to) {
      uint64_t rank = utils::spline_rank(current, total);

      rep_by_rep.modify(ritr, _self, [&](auto& item) {
        item.rank = rank;
      });

      auto uitr = users.find(ritr->account.value);

      uint64_t min_rep_score_citizen = config_get("cit.rep.sc"_n);
      uint64_t min_rep_score_resident = config_get("res.rep.pt"_n);

      name current_rank = uitr->status;

      if (rank < min_rep_score_resident) {
        current_rank = visitor;
      } else if (rank < min_rep_score_citizen) {
        current_rank = resident;
      } else {
        current_rank = citizen;
      }

      if (uitr->status == citizen && current_rank != citizen) {
        updatestatus(uitr->account, current_rank);
      }
      else if (uitr->status == resident && current_rank == visitor) {
        updatestatus(uitr->account, visitor);
      }

      evaluated = true;
      break;
    }

    current++;
    count++;
    ritr++;
  }

  if (!evaluated && ritr != rep_by_rep.end()) {
    uint64_t next_value = ritr->by_rep();
    action next_execution(
      permission_level{get_self(), "active"_n},
      get_self(),
      "evaldemote"_n,
      std::make_tuple(to, next_value, chunk + 1, chunksize)
    );

    transaction tx;
    tx.actions.emplace_back(next_execution);
    tx.delay_sec = 1;
    tx.send(next_value + 1, _self);
  }

}


void accounts::testmvouch (name sponsor, name account, uint64_t reps) {
  require_auth(get_self());
  vouch_tables vouch(get_self(), account.value);
  auto vitr = vouch.find(sponsor.value);
  if(vitr != vouch.end()) {
    vouch.modify(vitr, _self, [&](auto & item){
      item.reps = reps;
    });
  } else {
    vouch.emplace(_self, [&](auto & item){
      item.sponsor = sponsor;
      item.account = account;
      item.reps = reps;
    });
  }
}


void accounts::delegateflag (name delegator, name delegatee) {
  require_auth(delegator);

  check(delegator != delegatee, "delegator can not be their delegatee");

  delegators_tables delegator_t(get_self(), get_self().value);

  uint64_t max_depth = config_get("dlegate.dpth"_n);
  uint64_t count = 0;
  name aux_delegatee = delegatee;

  for (; count < max_depth; count++) {
    auto curr_delegator_itr = delegator_t.find(aux_delegatee.value);

    if (curr_delegator_itr != delegator_t.end()) {
      check(curr_delegator_itr->delegatee != delegator, "cycles are not allowed");
      aux_delegatee = curr_delegator_itr->delegatee;
    } else {
      break;
    }
  }

  check(count < max_depth, "max depth of delegation reached, count=" + std::to_string(count) + ", max_depth=" + std::to_string(max_depth));

  auto ditr = delegator_t.find(delegator.value);

  if (ditr == delegator_t.end()) {
    delegator_t.emplace(_self, [&](auto & item){
      item.delegator = delegator;
      item.delegatee = delegatee;
    });
  } else {
    delegator_t.modify(ditr, _self, [&](auto & item){
      item.delegatee = delegatee;
    });
  }
}


void accounts::undlgateflag (name delegator) {

  delegators_tables delegator_t(get_self(), get_self().value);

  auto ditr = delegator_t.require_find(delegator.value, "delegator not found");

  require_auth(has_auth(ditr->delegator) ? ditr->delegator : ditr->delegatee);

  delegator_t.erase(ditr);

}

void accounts::mimicflag (name delegatee, name to, name action, uint64_t chunksize) {

  require_auth(get_self());

  delegators_tables delegator_t(get_self(), get_self().value);
  auto delegators_by_delegatee = delegator_t.get_index<"bydelegatee"_n>();
  auto ditr = delegators_by_delegatee.lower_bound(uint128_t(delegatee.value) << 64);
  uint64_t count = 0;

  while (ditr != delegators_by_delegatee.end() && ditr->delegatee == delegatee && count < chunksize) {
    eosio::action(
      permission_level(get_self(), "active"_n),
      get_self(),
      action,
      std::make_tuple(ditr->delegator, to)
    ).send();

    ditr++;
    count++;
  }

  if (ditr != delegators_by_delegatee.end() && ditr->delegatee == delegatee) {
    utils::send_deferred_transaction(
      get_self(),
      permission_level(get_self(), "active"_n),
      get_self(),
      "mimicflag"_n,
      std::make_tuple(delegatee, to, action, chunksize)
    );
  }

}

ACTION accounts::migflags1() {
    utils::delete_table<flags_tables>(contracts::accounts, contracts::accounts.value);
}

ACTION accounts::migflags(name to) {

  require_auth(get_self());

  flag_points_tables flag_points(get_self(), to.value);
  auto flags_by_from_to = flags.get_index<"byfromto"_n>();

  auto flag_itr = flag_points.begin();

  check(flag_itr != flag_points.end(), "flag points not found");

  while(flag_itr != flag_points.end()) {
      name from = flag_itr->account;
      auto flags_from_to_itr = flags_by_from_to.find((uint128_t(from.value) << 64) + to.value);
      if (flags_from_to_itr == flags_by_from_to.end()) {
        flags.emplace(_self, [&](auto & item){
          item.id = flags.available_primary_key();
          item.from = from;
          item.to = to;
          item.flag_points = flag_itr->flag_points;
        });
      }
      flag_itr++;
  }
}


