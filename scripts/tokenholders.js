#!/usr/bin/env node
const fetch = require("node-fetch");
const program = require('commander')
const fs = require('fs')

const host = "https://node.hypha.earth"

const { eos, getTableRows } = require("./helper")

const getBalance = async (user) => {
  // const balance = await eos.getCurrencyBalance("token.seeds", user, 'SEEDS')

  const params = {
    "json": "true",
    "code": 'token.seeds',
    "scope": user,
    "table": 'accounts',
    'lower_bound': 'SEEDS',
    'upper_bound': 'SEEDS',
    "limit": 10,
}

  const url = host + "/v1/chain/get_table_rows"
  const rawResponse = await fetch(url, {
      method: 'POST',
      headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
  });
  const res = await rawResponse.json();
  //console.log("res: "+JSON.stringify(res, null, 2))
  // res: {"rows":[{"balance":"22465.0000 SEEDS"}],"more":false,"next_key":""}
  if (res.rows != null && res.rows.length > 0 && res.rows[0].balance != null) {
    const balance = res.rows[0].balance
    return balance
  } else {
    console.log("account "+user+" is invalid "+JSON.stringify(res, null, 2))
    return null
  }

  //console.log("balance: "+JSON.stringify(balance))
}

const getPlanteBalances = async (lower_bound) => {


  console.log("getting planted "+lower_bound)

  const params = {
    "json": "true",
    "code": 'harvst.seeds',
    "scope": 'harvst.seeds',
    "table": 'planted',
    'lower_bound': lower_bound,
    "limit": 1000,
    
}

  const url = host + "/v1/chain/get_table_rows"
  const rawResponse = await fetch(url, {
      method: 'POST',
      headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
  });
  const res = await rawResponse.json();

  //console.log("res: "+JSON.stringify(res, null, 2))

  return res
}

function timeStampString() {
  var date = new Date()
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var month = date.getMonth()+1;
  minutes = minutes < 10 ? '0'+minutes : minutes;
  month = month < 10 ? '0'+month : month;
  var strTime = hours + '_' + minutes;
  return date.getFullYear() + "-" + month + "-" + date.getDate() + "_" + strTime;
}

const allPlanted = async () => {
  var more = true
  var lower_bound = 0

  var planteds = []

console.log(timeStampString() )

  while (more) {
    const res = await getPlanteBalances(lower_bound)
    
    console.log("result: "+JSON.stringify(res, null, 2))

    res.rows.forEach(item => { 
      planteds.push(item)
    });

    lower_bound = parseInt(res.next_key) 
    
    more = res.more != "false" && res.more != ""

    console.log("planteds: "+planteds.length  + " next "+lower_bound)

  }

  fs.writeFileSync('planted_balances_'+ timeStampString() +'.json', JSON.stringify(planteds, null, 2))

}

    /** Raw call to `/v1/chain/get_table_by_scope` */
 const get_table_by_scope = async ({
      code,
      table,
      lower_bound = '',
      upper_bound = '',
      limit = 10,
  }) => {

    const url = host + '/v1/chain/get_table_by_scope'

    const params = {
      code,
      table,
      lower_bound,
      upper_bound,
      limit,
  }

    const rawResponse = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    });
    const res = await rawResponse.json();
    return res

  }


const getBalanceObjectFor = async (account) => {
  const balance = await getBalance(account)
  if (balance != null) {
    return{
      account: account,
      balance: balance,
      date: new Date().toISOString()
    }
  } else {
    return null
  }
}

const addBalances = async (balances, accounts) => {
  var futures = []
  accounts.forEach((acct) => futures.push(getBalanceObjectFor(acct)))
  var results = await Promise.all(futures)

  results.forEach(res => {
    if (res != null) {
      console.log("adding balance "+JSON.stringify(res, null, 2))
      balances.push(res)
    }
  });
  
}


const getTokenHolders = async () => {
  var more = true
  var lower_bound = ''

  var accounts = []

  while (more) {
    const res = await get_table_by_scope({
      code: "token.seeds",
      table: "accounts",
      lower_bound: lower_bound,
      limit: 2000
    })
    
    //console.log("result: "+JSON.stringify(res, null, 2))
    
    if (res.rows && res.rows.length > 0) {
      var accts = res.rows.map((item) => item.scope)
      accts.forEach(item => { // JS concat driving me mad..
        accounts.push(item)
      });
    }
    lower_bound = res.more
    
    more = res.more != "false" && res.more != ""
    //more = false // debug

    console.log("accounts: "+accounts.length)

  }

  var balances = []
  var fileText = ""
  var errorAccounts = []

  var batchAccounts = []
  const batchSize = 100

  // var old = accounts
  // accounts = []
  // for(var i=0; i<200; i++) {
  //   accounts[i] = old[i]
  // }

  console.log("accts: "+accounts.length)

  for(var i = 0; i<accounts.length; i++) {
    const account = accounts[i]

    batchAccounts.push(account)

    if (i == accounts.length - 1 || batchAccounts.length == batchSize) {
      console.log("adding "+i+ " length "+batchAccounts.length)
      await addBalances(balances, batchAccounts)
      batchAccounts = []
    }
  }

  balances.forEach((b) => {
    fileText = fileText + b.account + "," +b.balance+ "," +b.date+ "\n" 
  })
      


  //console.log("balances: "+JSON.stringify(balances, null, 2))
  console.log("found "+accounts.length + " accounts" )

  fs.writeFileSync(`seeds_errors_${timeStampString()}.json`, JSON.stringify(errorAccounts, null, 2))
  fs.writeFileSync(`seeds_accounts_balances_${timeStampString()}.json`, JSON.stringify(balances, null, 2))
  fs.writeFileSync(`seeds_accounts_balances_${timeStampString()}.csv`, fileText)
  
  //console.log("balances found: "+JSON.stringify(balances, null, 2))
  console.log("balances saved: "+balances.length)

  
  
}

program
  .command('balances')
  .description('Get SEEDS balances for all accounts')
  .action(async function () {
    console.log("getting balances");
    await getTokenHolders()
  })

program
  .command('planted')
  .description('Get Planted balances for all accounts')
  .action(async function () {
    console.log("getting planted");
    await allPlanted()
  })

program.parse(process.argv)

var NO_COMMAND_SPECIFIED = program.args.length === 0;
if (NO_COMMAND_SPECIFIED) {
  program.help();
}
 
