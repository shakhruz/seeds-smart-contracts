#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/transaction.hpp>
#include <eosio/singleton.hpp>
#include <seeds.token.hpp>
#include <contracts.hpp>
#include <utils.hpp>
#include <tables/cspoints_table.hpp>
#include <tables/user_table.hpp>
#include <tables/config_table.hpp>
#include <vector>
#include <cmath>

using namespace eosio;
using namespace utils;
using std::string;

CONTRACT proposals : public contract {
  public:
      using contract::contract;
      proposals(name receiver, name code, datastream<const char*> ds)
        : contract(receiver, code, ds),
          props(receiver, receiver.value),
          voice(receiver, receiver.value),
          lastprops(receiver, receiver.value),
          cycle(receiver, receiver.value),
          participants(receiver, receiver.value),
          minstake(receiver, receiver.value),
          actives(receiver, receiver.value),
          users(contracts::accounts, contracts::accounts.value)
          {}

      ACTION reset();

      ACTION create(name creator, name recipient, asset quantity, string title, string summary, string description, string image, string url, name fund);
      
      ACTION createx(name creator, name recipient, asset quantity, string title, string summary, string description, string image, string url, name fund, std::vector<uint64_t> pay_percentages);

      ACTION cancel(uint64_t id);

      ACTION update(uint64_t id, string title, string summary, string description, string image, string url);
      
      ACTION updatex(uint64_t id, string title, string summary, string description, string image, string url, std::vector<uint64_t> pay_percentages);

      ACTION stake(name from, name to, asset quantity, string memo);

      ACTION addvoice(name user, uint64_t amount);

      ACTION changetrust(name user, bool trust);

      ACTION favour(name user, uint64_t id, uint64_t amount);

      ACTION against(name user, uint64_t id, uint64_t amount);

      ACTION neutral(name user, uint64_t id);

      ACTION erasepartpts(uint64_t active_proposals);

      ACTION onperiod();

      ACTION updatevoices();

      ACTION updatevoice(uint64_t start);

      ACTION checkstake(uint64_t prop_id);

      ACTION addactive(name account);

      ACTION removeactive(name account);

      ACTION updateactivs();

      ACTION updateactive(uint64_t start);
      
      ACTION decayvoices();

      ACTION decayvoice(uint64_t start, uint64_t chunksize);

      ACTION testquorum(uint64_t total_proposals);

      ACTION testvdecay(uint64_t timestamp);

      ACTION migratevoice(uint64_t start);

      ACTION testsetvoice(name user, uint64_t amount);
      ACTION initsz();

      ACTION initactives();

      ACTION initnumprop();

  private:
      symbol seeds_symbol = symbol("SEEDS", 4);
      name trust = "trust"_n;
      name distrust = "distrust"_n;
      name abstain = "abstain"_n;
      name prop_active_size = "prop.act.sz"_n;
      name user_active_size = "user.act.sz"_n; 
      name cycle_vote_power_size = "votepow.sz"_n; 
      name linear_payout = "linear"_n;
      name stepped_payout = "step"_n;

      name status_open = name("open");        // 1 - open: can be cancelled, edited
      name status_evaluate = name("evaluate");
      name status_passed = name("passed");
      name status_rejected = name("rejected");

      // stages
      name stage_staged = name("staged"); // 1 staged: can be cancelled, edited
      name stage_active = name("active"); // 2 active: can be voted on, can't be edited; open or evaluate status
      name stage_done = name("done");     // 3 done: can't be edited or voted on

      std::vector<uint64_t> default_step_distribution = {
        25,  // initial payout
        25,  // cycle 1
        25,  // cycle 2
        25  // cycle 3
      };

      name alliance_type = "alliance"_n;
      name campaign_type = "campaign"_n;

      void update_cycle();
      void update_voicedecay();
      uint64_t get_cycle_period_sec();
      uint64_t get_voice_decay_period_sec();
      bool is_enough_stake(asset staked, asset quantity, name fund);
      uint64_t min_stake(asset quantity, name fund);
      uint64_t cap_stake(name fund);
      void update_min_stake(uint64_t prop_id);

      void check_user(name account);
      void check_citizen(name account);
      void deposit(asset quantity);
      void withdraw(name account, asset quantity, name sender, string memo);
      void refund_staked(name beneficiary, asset quantity);
      void send_to_escrow(name fromfund, name recipient, asset quantity, string memo);
      void burn(asset quantity);
      void update_voice_table();
      void vote_aux(name voter, uint64_t id, uint64_t amount, name option, bool is_new);
      bool revert_vote (name voter, uint64_t id);
      void change_rep(name beneficiary, bool passed);
      uint64_t get_size(name id);
      void size_change(name id, int64_t delta);

      uint64_t get_quorum(uint64_t total_proposals);
      void recover_voice(name account);
      void demote_citizen(name account);
      uint64_t calculate_decay(uint64_t voice);
      name get_type (name fund);
      void voice_change (name user, uint64_t amount, bool reduce, name scope);
      void set_voice (name user, uint64_t amount, name scope);
      void erase_voice (name user);
      void check_percentages(std::vector<uint64_t> pay_percentages);
      asset get_payout_amount(std::vector<uint64_t> pay_percentages, uint64_t age, asset total_amount, asset current_payout);

      uint64_t config_get(name key) {
        DEFINE_CONFIG_TABLE
        DEFINE_CONFIG_TABLE_MULTI_INDEX
        config_tables config(contracts::settings, contracts::settings.value);
        
        auto citr = config.find(key.value);
          if (citr == config.end()) { 
          // only create the error message string in error case for efficiency
          eosio::check(false, ("settings: the "+key.to_string()+" parameter has not been initialized").c_str());
        }
        return citr->value;
      }

      TABLE proposal_table {
          uint64_t id;
          name creator;
          name recipient;
          asset quantity;
          asset staked;
          bool executed;
          uint64_t total;
          uint64_t favour;
          uint64_t against;
          string title;
          string summary;
          string description;
          string image;
          string url;
          name status;
          name stage;
          name fund;
          uint64_t creation_date;
          std::vector<uint64_t> pay_percentages;
          uint64_t passed_cycle;
          uint32_t age;
          asset current_payout;

          uint64_t primary_key()const { return id; }
          uint64_t by_status()const { return status.value; }
      };

      TABLE min_stake_table {
          uint64_t prop_id;
          uint64_t min_stake;
          uint64_t primary_key()const { return prop_id; }
      };

      DEFINE_USER_TABLE

      TABLE vote_table {
          uint64_t proposal_id;
          name account;
          uint64_t amount;
          bool favour;
          uint64_t primary_key()const { return account.value; }
      };

      TABLE participant_table {
        name account;
        bool nonneutral;
        uint64_t count;
        // bool complete;
        uint64_t primary_key()const { return account.value; }
      };

      TABLE voice_table {
        name account;
        uint64_t balance;
        uint64_t primary_key()const { return account.value; }
      };

      TABLE last_proposal_table {
        name account;
        uint64_t proposal_id;
        uint64_t primary_key()const { return account.value; }
      };

      TABLE cycle_table {
        uint64_t propcycle; 
        uint64_t t_onperiod; // last time onperiod ran
        uint64_t t_voicedecay; // last time voice was decayed
      };

      TABLE active_table {
        name account;
        uint64_t timestamp;
        bool active;

        uint64_t primary_key()const { return account.value; }
      };
    

    typedef eosio::multi_index<"props"_n, proposal_table,
      indexed_by<"bystatus"_n,
      const_mem_fun<proposal_table, uint64_t, &proposal_table::by_status>>
    > proposal_tables;
    typedef eosio::multi_index<"votes"_n, vote_table> votes_tables;
    typedef eosio::multi_index<"participants"_n, participant_table> participant_tables;
    typedef eosio::multi_index<"users"_n, user_table> user_tables;
    typedef eosio::multi_index<"voice"_n, voice_table> voice_tables;
    typedef eosio::multi_index<"lastprops"_n, last_proposal_table> last_proposal_tables;
    typedef singleton<"cycle"_n, cycle_table> cycle_tables;
    typedef eosio::multi_index<"cycle"_n, cycle_table> dump_for_cycle;
    typedef eosio::multi_index<"minstake"_n, min_stake_table> min_stake_tables;
    typedef eosio::multi_index<"actives"_n, active_table> active_tables;

    DEFINE_SIZE_TABLE
    DEFINE_SIZE_TABLE_MULTI_INDEX

    proposal_tables props;
    participant_tables participants;
    user_tables users;
    voice_tables voice;
    last_proposal_tables lastprops;
    cycle_tables cycle;
    min_stake_tables minstake;
    active_tables actives;

};

extern "C" void apply(uint64_t receiver, uint64_t code, uint64_t action) {
  if (action == name("transfer").value && code == contracts::token.value) {
      execute_action<proposals>(name(receiver), name(code), &proposals::stake);
  } else if (code == receiver) {
      switch (action) {
        EOSIO_DISPATCH_HELPER(proposals, (reset)(create)(createx)(update)(updatex)(addvoice)(changetrust)(favour)(against)
        (neutral)(erasepartpts)(checkstake)(onperiod)(decayvoice)(cancel)(updatevoices)(updatevoice)(decayvoices)
        (addactive)(removeactive)(updateactivs)(updateactive)(testvdecay)(initsz)(initactives)(testquorum)(initnumprop)
        (migratevoice)(testsetvoice))
      }
  }
}
