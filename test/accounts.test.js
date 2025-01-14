const { describe } = require('riteway')
const { eos, names, isLocal, initContracts, activePublicKey, getBalance, getBalanceFloat,
  ramdom64ByteHexString, sha256, fromHexString, getTableRows } = require('../scripts/helper')
const { equals } = require('ramda')

const publicKey = 'EOS7iYzR2MmQnGga7iD2rPzvm5mEFXx6L1pjFTQYKRtdfDcG9NTTU'

const { accounts, proposals, harvest, token, settings, history, organization, onboarding, escrow, firstuser, seconduser, thirduser, fourthuser, fifthuser, orguser } = names

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// helper function
const get_reps = async () => {
  const users = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    json: true,
  })

  const result = users.rows.map( ({ rep }) => rep )

  return result
}

const can_vote = async (user) => {
  const voice = await eos.getTableRows({
    code: proposals,
    scope: proposals,
    table: 'voice',
    lower_bound: user,
    upper_bound: user,
    json: true,
  })

  return voice.rows.length == 1
}
const setting_in_seeds = async (key) => {
  const value = await eos.getTableRows({
    code: settings,
    scope: settings,
    table: 'config',
    lower_bound: key,
    upper_bound: key,
    json: true,
  })
  console.log(key + " setting is ", value.rows[0].value)
  return Math.round(value.rows[0].value / 10000) // not entirely correct but works for now
}

const get_settings = async (key) => {
  const value = await eos.getTableRows({
    code: settings,
    scope: settings,
    table: 'config',
    lower_bound: key,
    upper_bound: key,
    json: true,
  })
  return value.rows[0].value
}

describe('General accounts', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contract = await eos.contract(accounts)
  const proposalsContract = await eos.contract(proposals)
  const thetoken = await eos.contract(token)
  const settingscontract = await eos.contract(settings)
  const escrowContract = await eos.contract(escrow)
 
  console.log('reset proposals')
  await proposalsContract.reset({ authorization: `${proposals}@active` })

  console.log('reset accounts')
  await contract.reset({ authorization: `${accounts}@active` })

  console.log('reset token stats')
  await thetoken.resetweekly({ authorization: `${token}@active` })

  console.log('reset settings')
  await settingscontract.reset({ authorization: `${settings}@active` })

  console.log('reset escrow')
  await escrowContract.reset({ authorization: `${escrow}@active` })


  console.log('add users')
  await contract.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(thirduser, 'Third user', "individual", { authorization: `${accounts}@active` })

  console.log('update')

  //void accounts::update(name user, name type, string nickname, string image, string story, string roles, string skills, string interests)
  
  const nickname = "A NEw NAME FOR FIRST USER"
  const image = "https://somthignsomething"
  const story = "my story ... "
  const roles = "some roles... "
  const skills = "some skills... "
  const interests = "some interests... "

  await contract.update(firstuser, "individual", nickname, image, story, roles, skills, interests, { authorization: `${firstuser}@active` })

  const userOne = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    table: 'users',
    lower_bound: firstuser,
    upper_bound: firstuser,
    json: true,
  })

  //console.log("user one: "+JSON.stringify(userOne, null, 2))

  var canChangeType = false
  try {
    await contract.update(firstuser, "organisation", nickname, image, story, roles, skills, interests,{ authorization: `${firstuser}@active` })
    canChangeType = true
  } catch (err) {
    console.log("expected error "+err)
  }

  var longstory = "0123456789"
  for (var i=0; i<699; i++) {
    longstory = longstory + "0123456789"
  }
  console.log("longstory length: "+longstory.length)

  await contract.update(firstuser, "individual", nickname, image, longstory, roles, skills, interests, { authorization: `${firstuser}@active` })

  longstory = longstory + "0123456789" + "Whoops!"
  var canStoreLongStory = false
  try {
    await contract.update(firstuser, "organisation", nickname, image, longstory, roles, skills, interests,{ authorization: `${firstuser}@active` })
    canStoreLongStory = true
  } catch (err) {
    console.log("expected error "+err)
  }


  assert({
    given: 'trying to change user type',
    should: 'cant',
    actual: canChangeType,
    expected: false
  })
  
  delete userOne.rows[0].timestamp

  assert({
    given: 'update called',
    should: 'fields are updates',
    actual: userOne.rows[0],
    expected: 
      {
        "account": "seedsuseraaa",
        "status": "visitor",
        "type": "individual",
        "nickname": "A NEw NAME FOR FIRST USER",
        "image": image,
        "story": story,
        "roles": roles,
        "skills": skills,
        "interests":interests,
        "reputation": 0,
      }
  })

  assert({
    given: 'trying to change user type',
    should: 'cant',
    actual: canStoreLongStory,
    expected: false
  })


  console.log("filling account with Seedds for bonuses [Change this]")
  await thetoken.transfer(firstuser, accounts, '100.0000 SEEDS', '', { authorization: `${firstuser}@active` })

  console.log('plant 50 seeds')
  await thetoken.transfer(firstuser, harvest, '50.0000 SEEDS', '', { authorization: `${firstuser}@active` })

  console.log("plant 100 seeds")
  await thetoken.transfer(firstuser, harvest, '100.0000 SEEDS', '', { authorization: `${firstuser}@active` })

  console.log('add referral firstuser is referrer for seconduser')
  await contract.addref(firstuser, seconduser, { authorization: `${accounts}@api` })

  console.log('update reputation')
  await contract.addrep(firstuser, 100, { authorization: `${accounts}@api` })
  await contract.subrep(seconduser, 1, { authorization: `${accounts}@api` })

  console.log('update user data')
  await contract.update(
    firstuser, 
    "individual", 
    "Ricky G",
    "https://m.media-amazon.com/images/M/MV5BMjQzOTEzMTk1M15BMl5BanBnXkFtZTgwODI1Mzc0MDI@._V1_.jpg",
    "I'm from the UK",
    "Roless... hmmm... ",
    "Skills: Making jokes. Some acting. Offending people.",
    "Animals",
    { authorization: `${firstuser}@active` })


  try {
    console.log('make resident')

    await contract.makeresident(firstuser, { authorization: `${firstuser}@active` })

    console.log('make citizen')
    
    await contract.makecitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    console.log('user not ready to become citizen' + err)
  }

  console.log('test citizen')

  assert({
    given: 'not citizen',
    should: 'cant vote',
    actual: await can_vote(firstuser),
    expected: false
  })

  await contract.testcitizen(firstuser, { authorization: `${accounts}@active` })

  assert({
    given: 'citizen',
    should: 'can vote',
    actual: await can_vote(firstuser),
    expected: true
  })
  
  console.log('test resident')

  await contract.testresident(seconduser, { authorization: `${accounts}@active` })

  assert({
    given: 'resident',
    should: 'cant vote',
    actual: await can_vote(seconduser),
    expected: false
  })

  console.log('test citizen again')

  let balanceBeforeResident = await getBalance(firstuser)
  //console.log('balanceBeforeResident '+balanceBeforeResident)

  console.log('test resident')

  const users = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    table: 'users',
    json: true,
  })

  const refs = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    table: 'refs',
    json: true
  })

  console.log('test citizen second user')
  await contract.testcitizen(seconduser, { authorization: `${accounts}@active` })

  console.log('test testremove')
  await contract.testremove(seconduser, { authorization: `${accounts}@active` })

  const usersAfterRemove = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    table: 'users',
    json: true,
  })

  const now = new Date() / 1000

  const firstTimestamp = users.rows[0].timestamp

  let factor = 100


  const checkEscrow = async (text, id, user, settingname) => {

    const amount = await setting_in_seeds(settingname)

    const escrows = await getTableRows({
      code: escrow,
      scope: escrow,
      table: 'locks',
      lower_bound: id,
      upper_bound: id,
      json: true
    })

    let n = escrows.rows.length
    let item = escrows.rows[n-1]

    delete item.id
    delete item.vesting_date
    delete item.notes
    delete item.created_date
    delete item.updated_date

    assert({
      given: text,
      should: 'reveive Seeds in escrow',
      actual: item,
      expected: 
        {
          "lock_type": "event",
          "sponsor": "refer.seeds",
          "beneficiary": user,
          "quantity": amount + ".0000 SEEDS",
          "trigger_event": "golive",
          "trigger_source": "dao.hypha",
        },
    })
  }

  await checkEscrow("referred became resident", 0, firstuser, "refrwd1.ind")
  await checkEscrow("referred became citizen", 1, firstuser, "refrwd2.ind")

  assert({
    given: 'changed reputation',
    should: 'have correct values',
    actual: users.rows.map(({ reputation }) => reputation),
    expected: [101, 0, 0]
  })

  assert({
    given: 'created user',
    should: 'have correct timestamp',
    actual: Math.abs(firstTimestamp - now) < 500,
    expected: true
  })

  assert({
    given: 'invited user',
    should: 'have row in table',
    actual: refs.rows[0],
    expected: {
      referrer: firstuser,
      invited: seconduser
    }
  })

  assert({
    given: 'users table',
    should: 'show joined users',
    actual: users.rows.map(({ account, status, nickname, reputation }) => ({ account, status, nickname, reputation })),
    expected: [{
      account: firstuser,
      status: 'citizen',
      nickname: 'Ricky G',
      reputation: 101,
    }, {
      account: seconduser,
      status: 'resident',
      nickname: 'Second user',
      reputation: 0
    },
     { "account":"seedsuserccc","status":"visitor","nickname":"Third user","reputation":0 }
    ]
  })

  assert({
    given: 'test-removed user',
    should: 'have 1 fewer users than before',
    actual: usersAfterRemove.rows.length,
    expected: users.rows.length - 1
  })

})


const citizen_base_vouch_points = 8
const resident_base_vouch_points = 4

describe('vouching', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const checkReps = async (expectedReps, given, should) => {
  
    assert({
      given: given,
      should: should,
      actual: await get_reps(),
      expected: expectedReps
    })
  
  }
  
  const checkVouch = async (expectedTam, given, should) => {
    const vouchTables = await getTableRows({
      code: accounts,
      scope: accounts,
      table: 'vouches',
      json: true
    })
    //console.log(vouchTables)
    assert({
      given,
      should,
      actual: vouchTables.rows.length,
      expected: expectedTam
    })
  }

  const contract = await eos.contract(accounts)
  const thetoken = await eos.contract(token)
  const harvestContract = await eos.contract(harvest)
  const settingscontract = await eos.contract(settings)

  console.log('reset accounts')
  await contract.reset({ authorization: `${accounts}@active` })

  console.log('reset harvest')
  await harvestContract.reset({ authorization: `${harvest}@active` })

  console.log('reset token stats')
  await thetoken.resetweekly({ authorization: `${token}@active` })

  console.log('reset settings')
  await settingscontract.reset({ authorization: `${settings}@active` })

  console.log('add users')
  await contract.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(thirduser, 'Third user', "individual", { authorization: `${accounts}@active` })

  await contract.testsetrs(firstuser, 50, { authorization: `${accounts}@active` })
  await contract.testsetrs(seconduser, 50, { authorization: `${accounts}@active` })
  await contract.testsetrs(thirduser, 50, { authorization: `${accounts}@active` })
  // not yet active
  //console.log('unrequested vouch for user')
  //await contract.vouch(seconduser, thirduser, { authorization: `${seconduser}@active` })

  console.log('test citizen')
  await contract.testcitizen(firstuser, { authorization: `${accounts}@active` })

  console.log('request vouch from user')
  await contract.requestvouch(thirduser, firstuser,{ authorization: `${thirduser}@active` })
  await contract.requestvouch(seconduser, firstuser,{ authorization: `${seconduser}@active` })

  await checkReps([0, 0, 0], "init", "be empty XX")

  console.log('vouch for user')
  await contract.vouch(firstuser, seconduser, { authorization: `${firstuser}@active` })
  await contract.vouch(firstuser, thirduser, { authorization: `${firstuser}@active` })

  await checkReps([0, 8, 8], "after vouching", "get rep bonus for being vouched")
  await checkVouch(2, `${firstuser} vouched`, 'store the vouch')

  await sleep(500)

  var cantVouchTwice = true
  try {
    await contract.vouch(firstuser, seconduser, { authorization: `${firstuser}@active` })
    cantVouchTwice = false
  } catch (err) {}

  console.log('vouch for user but not resident or citizen')
  var visitorCannotVouch = true
  try {
    await contract.vouch(seconduser, thirduser,{ authorization: `${seconduser}@active` })
    visitorCannotVouch = false
  } catch (err) {}

  console.log('test resident')
  await contract.testresident(seconduser, { authorization: `${accounts}@active` })
  await checkReps([1, citizen_base_vouch_points, citizen_base_vouch_points], "after user is resident", "sponsor gets rep bonus for sponsoring resident")

  await contract.vouch(seconduser, thirduser,{ authorization: `${seconduser}@active` })
  await checkReps([1, citizen_base_vouch_points, citizen_base_vouch_points + resident_base_vouch_points], "resident vouch", "rep bonus")
  await checkVouch(3, `${seconduser} vouched`, 'store the vouch')

  await contract.testresident(thirduser, { authorization: `${accounts}@active` })
  await checkReps([2, citizen_base_vouch_points + 1, citizen_base_vouch_points + resident_base_vouch_points], "after user is resident", "all sponsors gets rep bonus")

  await contract.testcitizen(thirduser, { authorization: `${accounts}@active` })

  var user_1_rep = citizen_base_vouch_points + 2
  var user_2_rep = citizen_base_vouch_points + resident_base_vouch_points
  await checkReps([3, user_1_rep, user_2_rep], "after user is citizen", "all sponsors gets rep bonus")

  console.log("set max vouch to 3")
  await settingscontract.configure("maxvouch", 3, { authorization: `${settings}@active` })
  await contract.adduser(fourthuser, 'Fourth user', "individual", { authorization: `${accounts}@active` })
  await contract.vouch(firstuser, fourthuser,{ authorization: `${firstuser}@active` })
  await checkReps([3, user_1_rep, user_2_rep, 3], "max vouch reached", "can still vouch")
  await checkVouch(4, `${firstuser} vouched for ${fourthuser}`, 'store the vouch')

  console.log('max vouch exceeded')
  await contract.vouch(thirduser, fourthuser,{ authorization: `${thirduser}@active` })
  await checkReps([3, user_1_rep, user_2_rep, 3], "max vouch reached", "not gain reputation")
  await checkVouch(5, `${thirduser} vouched for ${fourthuser}`, 'store the vouch')

  assert({
    given: 'vouch sponsor is not resident or citizen',
    should: 'not be able to vouch',
    actual: visitorCannotVouch,
    expected: true
  })

  assert({
    given: 'vouch a second time',
    should: 'not be able to vouch',
    actual: cantVouchTwice,
    expected: true
  })

  console.log('punish firstuser '+await get_reps())
  await contract.punish(firstuser, 10, { authorization: `${accounts}@active` })

  await checkReps([2, 3, 3], "user punished", "have the correct rep")
  await checkVouch(5, `${firstuser} punished`, 'store the vouch')

  await settingscontract.configure("maxvouch", 5, { authorization: `${settings}@active` })
  await contract.vouch(seconduser, fourthuser,{ authorization: `${seconduser}@active` })
  await checkReps([2, 3, 5], `${seconduser} vouched`, "have the correct rep")
  await checkVouch(6, `${seconduser} vouched`, 'store the vouch')

})

describe('vouching with reputation', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const checkReps = async (expectedReps, given, should) => {
    
    assert({
      given: given,
      should: should,
      actual: await get_reps(),
      expected: expectedReps
    })
  
  }
  
  const contract = await eos.contract(accounts)
  const harvestContract = await eos.contract(harvest)
  const settingscontract = await eos.contract(settings)

  console.log('reset accounts')
  await contract.reset({ authorization: `${accounts}@active` })

  console.log('reset harvest')
  await harvestContract.reset({ authorization: `${harvest}@active` })

  console.log('reset settings')
  await settingscontract.reset({ authorization: `${settings}@active` })

  console.log('add users')
  await contract.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(thirduser, 'Third user', "individual", { authorization: `${accounts}@active` })
  await contract.adduser(fourthuser, '4th user', "individual", { authorization: `${accounts}@active` })

  console.log('test citizen')
  await contract.testcitizen(firstuser, { authorization: `${accounts}@active` })

  await checkReps([], "init", "be empty")

  console.log('vouch for user')
  await contract.testsetrs(firstuser, 25, { authorization: `${accounts}@active` })
  await contract.vouch(firstuser, seconduser, { authorization: `${firstuser}@active` })

  await contract.testsetrs(firstuser, 75, { authorization: `${accounts}@active` })
  await contract.vouch(firstuser, thirduser, { authorization: `${firstuser}@active` })

  await contract.testsetrs(firstuser, 99, { authorization: `${accounts}@active` })
  await contract.vouch(firstuser, fourthuser, { authorization: `${firstuser}@active` })

  await checkReps([0, citizen_base_vouch_points / 2, citizen_base_vouch_points * 1.5, citizen_base_vouch_points * 2], "after vouching", "get rep bonus for being vouched")

})

const randomAccountName = () => Math.random().toString(36).substring(2).replace(/\d/g, '').toString()

describe('Ambassador and Org rewards', async assert => {

  console.log('Ambassador and Org rewards =====')

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ settings, accounts, organization, token, onboarding, escrow })

  console.log('reset contracts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })
  await contracts.settings.reset({ authorization: `${settings}@active` })
  await contracts.organization.reset({ authorization: `${organization}@active` })
  await contracts.escrow.reset({ authorization: `${escrow}@active` })
  await contracts.token.resetweekly({ authorization: `${token}@active` })

  console.log('add user')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })

  let ambassador = firstuser
  let orgowner = randomAccountName()
  let orgaccount = randomAccountName()

  console.log('ambassador invites a user named testorgowner')
  let secret = await invite(ambassador, 800, false)

  console.log('user accepts the invite and becomes a Seeds user')
  await accept(orgowner, secret, activePublicKey, contracts)

  console.log("user sends funds to orgs.seeds contract")
  await contracts.token.transfer(orgowner, organization, "200.0000 SEEDS", "memo", { authorization: `${orgowner}@active` })

  console.log("user creates org")
  await contracts.organization.create(orgowner, orgaccount, "Org Number 1", activePublicKey, { authorization: `${orgowner}@active` })

  console.log("user sends funds to newly created org")
  await contracts.token.transfer(firstuser, orgaccount, "900.0000 SEEDS", "memo", { authorization: `${firstuser}@active` })

  console.log("org signs up people")
  let orguser1 = randomAccountName()
  let orguser2 = randomAccountName()

  console.log('org invites 2 users')
  let secret1 = await invite(orgaccount, 50, false)
  let secret2 = await invite(orgaccount, 100, false)

  await accept(orguser1, secret1, activePublicKey, contracts)
  await accept(orguser2, secret2, activePublicKey, contracts)

  const checkBalances = async (beneficiary, text, ambassadorSettingName, orgSettingName) => {

    const ambassadorReward = await setting_in_seeds(ambassadorSettingName)
    const orgReward = await setting_in_seeds(orgSettingName)

    const escrows = await getTableRows({
      code: escrow,
      scope: escrow,
      table: 'locks',
      json: true
    })
    //console.log("escrow: "+JSON.stringify(escrows, null, 2))

    let n = escrows.rows.length
    let lastTwoEscrows = [ escrows.rows[n-2], escrows.rows[n-1] ]

    lastTwoEscrows.forEach( (item) => {
      delete item.id
      delete item.vesting_date
      delete item.notes
      delete item.created_date
      delete item.updated_date
    })

    assert({
      given: text,
      should: 'reveive Seeds in escrow',
      actual: lastTwoEscrows,
      expected: [
        {
          "lock_type": "event",
          "sponsor": "refer.seeds",
          "beneficiary": beneficiary,
          "quantity": orgReward + ".0000 SEEDS",
          "trigger_event": "golive",
          "trigger_source": "dao.hypha",
        },
        {
          "lock_type": "event",
          "sponsor": "refer.seeds",
          "beneficiary": "seedsuseraaa",
          "quantity": ambassadorReward+".0000 SEEDS",
          "trigger_event": "golive",
          "trigger_source": "dao.hypha",
        }

      ]
        
      
    })
  }

  console.log("user 1 becomes resident")
  await contracts.accounts.testresident(orguser1, { authorization: `${accounts}@active` })

  await checkBalances(orgaccount, "after resident", "refrwd1.amb", "refrwd1.org")

  console.log("user 2 becomes citizen")
  await contracts.accounts.testcitizen(orguser2, { authorization: `${accounts}@active` })

  await checkBalances(orgaccount, "after citizen 1", "refrwd2.amb", "refrwd2.org")

  console.log("user 1 becomes citizen")
  await contracts.accounts.testcitizen(orguser1, { authorization: `${accounts}@active` })

  await checkBalances(orgaccount, "after citizen 2", "refrwd2.amb", "refrwd2.org")


})


describe('Proportional rewards', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ settings, accounts, organization, token, onboarding, escrow, history })

  console.log('reset contracts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })
  await contracts.settings.reset({ authorization: `${settings}@active` })
  await contracts.organization.reset({ authorization: `${organization}@active` })
  await contracts.escrow.reset({ authorization: `${escrow}@active` })
  await contracts.history.reset(firstuser, { authorization: `${history}@active` })


  console.log('add user')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })

  let individual = firstuser
  let invited = randomAccountName()

  console.log('individual invites a user named invited')
  let secret = await invite(individual, 800, false)

  console.log('user accepts the invite and becomes a Seeds user')
  await accept(invited, secret, activePublicKey, contracts)

  const checkBalances = async (text, amount) => {

    const escrows = await getTableRows({
      code: escrow,
      scope: escrow,
      table: 'locks',
      json: true
    })
    //console.log("escrow: "+JSON.stringify(escrows, null, 2))

    let n = escrows.rows.length
    let item = escrows.rows[n-1]

    delete item.id
    delete item.vesting_date
    delete item.notes
    delete item.created_date
    delete item.updated_date

    assert({
      given: text,
      should: 'receive Seeds in escrow',
      actual: escrows.rows[n-1],
      expected:
        {
          "lock_type": "event",
          "sponsor": "refer.seeds",
          "beneficiary": "seedsuseraaa",
          "quantity": amount+" SEEDS",
          "trigger_event": "golive",
          "trigger_source": "dao.hypha",
        }
    })
  }

  console.log("change settings")
  await contracts.settings.configure("refrwd1.ind", 3000*10000, { authorization: `${settings}@active` })
  await contracts.settings.configure("minrwd1.ind", 20*10000, { authorization: `${settings}@active` })
  await contracts.settings.configure("decrwd1.ind", 1, { authorization: `${settings}@active` })

  await contracts.settings.configure("refrwd2.ind", 3000*10000, { authorization: `${settings}@active` })
  await contracts.settings.configure("minrwd2.ind", 20*10000, { authorization: `${settings}@active` })
  await contracts.settings.configure("decrwd2.ind", 1, { authorization: `${settings}@active` })

  console.log("user becomes resident")
  await contracts.accounts.testresident(invited, { authorization: `${accounts}@active` })
  const expected_reward1 = 1116.2807 // calculated using the decay formula

  await checkBalances("after resident", expected_reward1.toFixed(4))

  console.log("user becomes citizen")
  await contracts.accounts.testcitizen(invited, { authorization: `${accounts}@active` })
  const expected_reward2 = 1116.2807 // calculated using the decay formula

  await checkBalances("after citizen", expected_reward2.toFixed(4))

})

const userStatus = async (name) => {
  const users = await eos.getTableRows({
    code: accounts,
    scope: accounts,
    lower_bound: name,
    upper_bound: name,
    table: 'users',
    json: true,
  })

  return users.rows[0].status

}

describe('make resident', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ accounts, token, history })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset history')
  await contracts.history.reset(firstuser, { authorization: `${history}@active` })

  console.log('reset token stats')
  await contracts.token.resetweekly({ authorization: `${token}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })

  console.log('make resident - fail')
  try {
    await contracts.accounts.makeresident(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    //console.log('expected error' + err)
  }

  console.log('can resident - fail')
  let canresident = true
  try {
    await contracts.accounts.canresident(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    canresident = false
    //console.log('expected error' + err)
  }

  // 1 CHECK STATUS - fail
  assert({
    given: 'does not fulfill criteria for resident',
    should: 'be visitor',
    actual: await userStatus(firstuser),
    expected: 'visitor'
  })

  assert({
    given: 'does not fulfill criteria for resident - canresident is false',
    should: 'be visitor',
    actual: canresident,
    expected: false
  })

  // 2 DO SHIT
  console.log('plant 50 seeds')
  await contracts.token.transfer(firstuser, harvest, '50.0000 SEEDS', '', { authorization: `${firstuser}@active` })
  console.log('make 10 transactions')
  for (var i=0; i<10; i++) {
    await contracts.token.transfer(firstuser, seconduser, '1.0000 SEEDS', 'memo'+i, { authorization: `${firstuser}@active` })
  }

  console.log('add referral')
  await contracts.accounts.addref(firstuser, seconduser, { authorization: `${accounts}@api` })
  console.log('update reputation')
  await contracts.accounts.addrep(firstuser, 50, { authorization: `${accounts}@api` })

  // 3 CHECK STATUS - succeed
  console.log('can resident')
  await contracts.accounts.canresident(firstuser, { authorization: `${firstuser}@active` })
  
  console.log('make resident')
  await contracts.accounts.makeresident(firstuser, { authorization: `${firstuser}@active` })

  assert({
    given: 'fulfills criteria for resident',
    should: 'is resident',
    actual: await userStatus(firstuser),
    expected: 'resident'
  })

})

describe('make citizen test', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ accounts, settings, token, harvest })

  console.log('reset settings')
  await contracts.settings.reset({ authorization: `${settings}@active` })
  
  console.log('reset harvest')
  await contracts.harvest.reset({ authorization: `${harvest}@active` })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset token stats')
  await contracts.token.resetweekly({ authorization: `${token}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(thirduser, '3 user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fourthuser, '4 user', "individual", { authorization: `${accounts}@active` })

  console.log('make citizen - fail')
  try {
    await contracts.accounts.makecitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    //console.log('expected error' + err)
  }

  console.log('can citizen - fail')
  var cancitizen = true
  try {
    await contracts.accounts.cancitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    cancitizen = false
    //console.log('expected error' + err)
  }

  assert({
    given: 'does not fulfill criteria for citizen',
    should: 'be visitor',
    actual: await userStatus(firstuser),
    expected: 'visitor'
  })

  assert({
    given: 'does not fulfill criteria for citizen - cancitizen false ',
    should: 'be false',
    actual: cancitizen,
    expected: false
  })

  await contracts.accounts.testresident(firstuser, { authorization: `${accounts}@active` })

  console.log('make citizen - fail')
  try {
    await contracts.accounts.makecitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
    //console.log('expected error' + err)
  }

  // 1 CHECK STATUS - fail
  assert({
    given: 'does not fulfill criteria for citizen',
    should: 'be resident',
    actual: await userStatus(firstuser),
    expected: 'resident'
  })

  // 2 DO SHIT
  console.log('plant 200 seeds')
  await contracts.token.transfer(firstuser, harvest, '200.0000 SEEDS', '', { authorization: `${firstuser}@active` })
  console.log('make 50 transaction')
  for (var i=0; i<25; i++) {
    await contracts.token.transfer(firstuser, seconduser, '1.0000 SEEDS', 'memo'+i, { authorization: `${firstuser}@active` })
    await contracts.token.transfer(firstuser, thirduser, '1.0000 SEEDS', 'memo2'+i, { authorization: `${firstuser}@active` })
  }
  console.log('add 3 referrals')
  await contracts.accounts.addref(firstuser, seconduser, { authorization: `${accounts}@api` })
  await contracts.accounts.addref(firstuser, thirduser, { authorization: `${accounts}@api` })
  await contracts.accounts.addref(firstuser, fourthuser, { authorization: `${accounts}@api` })
  console.log('update reputation SCORE')
  await contracts.accounts.testsetrs(firstuser, 51, { authorization: `${accounts}@active` })

  // 3 CHECK STATUS - succeed
  try {
    await contracts.accounts.makecitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
  }

  assert({
    given: 'does not fulfill criteria for citizen',
    should: 'is resident still',
    actual: await userStatus(firstuser),
    expected: 'resident'
  })

  await contracts.accounts.testresident(seconduser, { authorization: `${accounts}@active` })
  
  try {
    await contracts.accounts.makecitizen(firstuser, { authorization: `${firstuser}@active` })
  } catch (err) {
  }
  assert({
    given: 'does not fulfill criteria for citizen',
    should: 'is resident still',
    actual: await userStatus(firstuser),
    expected: 'resident'
  })
  await contracts.settings.configure("cit.age", 0, { authorization: `${settings}@active` })

  const bal = await eos.getTableRows({
    code: harvest,
    scope: harvest,
    lower_bound: firstuser,
    upper_bound: firstuser,
    table: 'balances',
    json: true,
  })

  console.log("can citizen - should succeed")
  await contracts.accounts.cancitizen(firstuser, { authorization: `${firstuser}@active` })

  console.log("make citizen")
  await contracts.accounts.makecitizen(firstuser, { authorization: `${firstuser}@active` })



  assert({
    given: 'does fulfill criteria for citizen',
    should: 'is citizen',
    actual: await userStatus(firstuser),
    expected: 'citizen'
  })


})

describe('reputation & cbs ranking', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ accounts })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(thirduser, '3 user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fourthuser, '4 user', "individual", { authorization: `${accounts}@active` })

  await contracts.accounts.addrep(firstuser, 100, { authorization: `${accounts}@api` })
  await contracts.accounts.addrep(seconduser, 4, { authorization: `${accounts}@api` })
  await contracts.accounts.addrep(thirduser, 2, { authorization: `${accounts}@api` })

  await contracts.accounts.testsetcbs(firstuser, 10, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetcbs(seconduser, 20, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetcbs(thirduser, 30, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetcbs(fourthuser, 40, { authorization: `${accounts}@active` })

  const reps = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    json: true
  })

  const cbs = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'cbs',
    json: true
  })

  const sizes = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'sizes',
    lower_bound: 'rep.sz',
    upper_bound: 'rep.sz',
    json: true
  })

  const sizesCBS = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'sizes',
    lower_bound: 'cbs.sz',
    upper_bound: 'cbs.sz',
    json: true
  })

  const userSize = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'sizes',
    lower_bound: 'users.sz',
    upper_bound: 'users.sz',
    json: true
  })

  await contracts.accounts.subrep(firstuser, 2, { authorization: `${accounts}@api` })
  await contracts.accounts.subrep(thirduser, 2, { authorization: `${accounts}@api` })

  await contracts.accounts.rankreps({ authorization: `${accounts}@active` })

  // await contracts.accounts.rankrep(0, 0, 200, { authorization: `${accounts}@active` })

  await contracts.accounts.rankcbs(0, 0, 1, accounts, { authorization: `${accounts}@active` })
  await sleep(4000)

  const repsAfter = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    json: true
  })
  
  const cbsAfter = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'cbs',
    json: true
  })
  
  await contracts.accounts.rankcbs(0, 0, 40, accounts, { authorization: `${accounts}@active` })

  const cbsAfter2 = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'cbs',
    json: true
  })

  //console.log("reps "+JSON.stringify(repsAfter, null, 2))

  //console.log("cbs "+JSON.stringify(cbsAfter, null, 2))


  const repsAfterFirstUser = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    lower_bound: firstuser,
    upper_bound: firstuser,
    json: true
  })

  const sizesAfter = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'sizes',
    lower_bound: 'rep.sz',
    upper_bound: 'rep.sz',
    json: true
  })

  assert({
    given: '3 users with rep',
    should: 'have entries in rep table',
    actual: reps.rows.length,
    expected: 3
  })

  assert({
    given: '4 users with cbs',
    should: 'have entries in cbs table',
    actual: cbsAfter.rows.map(({rank})=>rank),
    expected: [0,4,27,63]
  })

  assert({
    given: 'cbs ranked in one go',
    should: 'have same order',
    actual: cbsAfter2.rows.map(({rank})=>rank),
    expected: cbsAfter.rows.map(({rank})=>rank),
  })



  assert({
    given: '3 users with rep',
    should: 'have number in sizes table',
    actual: sizes.rows[0].size,
    expected: 3
  })

  assert({
    given: '4 users with cbs',
    should: 'have number in sizes table',
    actual: sizesCBS.rows[0].size,
    expected: 4
  })


  assert({
    given: '4 users total',
    should: 'have 4 in sizes table',
    actual: userSize.rows[0].size,
    expected: 4
  })

  assert({
    given: 'removed rep',
    should: 'have entries in rep table',
    actual: repsAfter.rows.length,
    expected: 2
  })

  assert({
    given: 'removed rep from first user',
    should: 'had 100, minus 2 is 98',
    actual: repsAfterFirstUser.rows[0].rep,
    expected: 98
  })

  assert({
    given: 'removed rep',
    should: 'have number in sizes table',
    actual: sizesAfter.rows[0].size,
    expected: 2
  })

})

describe('Referral cbp reward individual', async assert => {


  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ settings, accounts, onboarding })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset settings')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('configure rewards')


  const cbpRewardResident = 5
  const cbpRewargnitizen = 7

  await contracts.settings.configure("ref.cbp1.ind", cbpRewardResident, { authorization: `${settings}@active` })
  await contracts.settings.configure("ref.cbp2.ind", cbpRewargnitizen, { authorization: `${settings}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })

  console.log("seconduser is sponsor for first user")
  await contracts.accounts.addref(seconduser, firstuser, { authorization: `${accounts}@api` })

  console.log("firstuser becomes resident")
  await contracts.accounts.testresident(firstuser, { authorization: `${accounts}@active` })

  const cbsAfterResident = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'cbs',
    json: true
  })

  //console.log("should: ", cbpRewardResident, " cbs "+JSON.stringify(cbsAfterResident, null, 2))



  assert({
    given: 'firstuser became resident',
    should: 'sponsor received enough cbp',
    actual: cbsAfterResident.rows[0].community_building_score,
    expected: cbpRewardResident
  })

  console.log("firstuser becomes citizen")
  await contracts.accounts.testcitizen(firstuser, { authorization: `${accounts}@active` })

  const cbsAfterCitizen = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'cbs',
    json: true
  })

  //console.log("cbs "+JSON.stringify(cbsAfterCitizen, null, 2))

  assert({
    given: 'firstuser became citizen',
    should: 'sponsor received enough cbp',
    actual: cbsAfterCitizen.rows[0].community_building_score,
    expected: cbpRewardResident + cbpRewargnitizen
  })

})

describe('Referral cbp reward organization', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ settings, accounts })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset settings')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('set up rewards')
  const cbpRewardResident = 3
  const cbpRewargnitizen = 4

  await contracts.settings.configure("refcbp1.org", cbpRewardResident, { authorization: `${settings}@active` })
  await contracts.settings.configure("refcbp2.org", cbpRewargnitizen, { authorization: `${settings}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(orguser, 'org 1', "organisation", { authorization: `${accounts}@active` })

  console.log("orguser is sponsor for first user")
  await contracts.accounts.addref(orguser, firstuser, { authorization: `${accounts}@api` })

  console.log("firstuser becomes resident")
  await contracts.accounts.testresident(firstuser, { authorization: `${accounts}@active` })

  const cbsAfterResident = await getTableRows({
    code: accounts,
    scope: 'org',
    table: 'cbs',
    json: true
  })

  //console.log("cbs "+JSON.stringify(cbsAfterResident, null, 2))

  assert({
    given: 'firstuser became resident',
    should: 'sponsor received enough cbp',
    actual: cbsAfterResident.rows[0].community_building_score,
    expected: cbpRewardResident
  })

  console.log("firstuser becomes citizen")
  await contracts.accounts.testcitizen(firstuser, { authorization: `${accounts}@active` })

  const cbsAfterCitizen = await getTableRows({
    code: accounts,
    scope: 'org',
    table: 'cbs',
    json: true
  })

  // console.log("cbs 2 "+JSON.stringify(cbsAfterCitizen, null, 2))

  assert({
    given: 'firstuser became citizen',
    should: 'sponsor received enough cbp',
    actual: cbsAfterCitizen.rows[0].community_building_score,
    expected: cbpRewardResident + cbpRewargnitizen
  })

})

describe('Vouch reward', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ settings, accounts, onboarding })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })
  console.log('reset settings')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log("config")
  var expectedRepReward = 42

  await contracts.settings.configure("vouchrep.1", expectedRepReward, { authorization: `${settings}@active` })

  console.log('add users')
  await contracts.accounts.adduser(firstuser, 'First user', "individual", { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'Second user', "individual", { authorization: `${accounts}@active` })

  console.log('seconduser becomes a resident with rep and can vouch')
  var secondUserRep = 44
  await contracts.accounts.testsetrep(seconduser, secondUserRep, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(seconduser, 50, { authorization: `${accounts}@active` })
  await contracts.accounts.testresident(seconduser, { authorization: `${accounts}@active` })
  
  console.log('vouch for first user')
  await contracts.accounts.vouch(seconduser, firstuser, { authorization: `${seconduser}@active` })

  console.log("firstuser becomes resident")
  await contracts.accounts.testresident(firstuser, { authorization: `${accounts}@active` })

  const repAfterResident = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    lower_bound: seconduser,
    upper_bound: seconduser,
    json: true
  })

  //console.log("rep "+JSON.stringify(repAfterResident, null, 2))


  assert({
    given: 'firstuser became resident',
    should: 'referrer received reputation',
    actual: repAfterResident.rows[0].rep,
    expected: secondUserRep + expectedRepReward
  })

  console.log("firstuser becomes citizen")
  await contracts.accounts.testcitizen(firstuser, { authorization: `${accounts}@active` })

  const repAfterCitizen = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'rep',
    lower_bound: seconduser,
    upper_bound: seconduser,
    json: true
  })

  //console.log("rep "+JSON.stringify(repAfterCitizen, null, 2))

  var expectedRepCitizenReward = 1

  assert({
    given: 'firstuser became citizen',
    should: 'referrer received enough reputation',
    actual: repAfterCitizen.rows[0].rep,
    expected: secondUserRep + expectedRepReward + expectedRepCitizenReward
  })

})


// TODO: Test punish
const invite = async (sponsor, totalAmount, debug = false) => {
    
    const contracts = await initContracts({ onboarding, token, accounts, harvest })

    totalAmount = parseInt(totalAmount)

    const plantedSeeds = 5
    const transferredSeeds = totalAmount - plantedSeeds

    const transferQuantity = transferredSeeds + `.0000 SEEDS`
    const sowQuantity = plantedSeeds + '.0000 SEEDS'
    const totalQuantity = totalAmount + '.0000 SEEDS'
    
    const inviteSecret = await ramdom64ByteHexString()
    const inviteHash = sha256(fromHexString(inviteSecret)).toString('hex')

    console.log("     Invite Secret: "+inviteSecret)
    console.log("     Secret hash: "+inviteHash)
    
    const deposit = async () => {
        try {
            console.log(`${token}.transfer from ${sponsor} to ${onboarding} (${totalQuantity})`)
            await contracts.token.transfer(sponsor, onboarding, totalQuantity, '', { authorization: `${sponsor}@active` })        
        } catch (err) {
            console.log("deposit error: " + err)
        }
    }

    const invite = async () => {
        try {
            console.log(`${onboarding}.invite from ${sponsor}`)
            await contracts.onboarding.invite(sponsor, transferQuantity, sowQuantity, inviteHash, { authorization: `${sponsor}@active` })    
        } catch(err) {
            console.log("inv err: "+err)
        }
    }

    await deposit()

    if (debug == true) {
        const sponsorsBefore = await getTableRows({
            code: onboarding,
            scope: onboarding,
            table: 'sponsors',
            json: true
        })
        //console.log("sponsors after deposit "+JSON.stringify(sponsorsBefore.rows, null, 2))    
    }

    await invite()

    if (debug == true) {
        const sponsorsAfter = await getTableRows({
            code: onboarding,
            scope: onboarding,
            table: 'sponsors',
            json: true
        })
        //console.log("sponsors after invite "+JSON.stringify(sponsorsAfter.rows, null, 2))
    }   

    return inviteSecret

}

const accept = async (newAccount, inviteSecret, publicKey, contracts) => {
  console.log(`${onboarding}.accept invite for ${newAccount}`)
  await contracts.onboarding.accept(newAccount, inviteSecret, publicKey, { authorization: `${onboarding}@application` })        
  console.log("accept success!")
}

describe('Punishment', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ accounts, settings })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset settings')
  await contracts.settings.reset({ authorization: `${settings}@active` })

  console.log('change flag threshold')
  await contracts.settings.configure('flag.thresh', 40, { authorization: `${settings}@active` })

  const checkReps = async (expectedReps) => {
    const reps = await getTableRows({
      code: accounts,
      scope: accounts,
      table: 'rep',
      json: true
    })
    assert({
      given: 'user punished',
      should: 'have the correct reputation',
      actual: reps.rows.map(r => r.rep),
      expected: expectedReps
    })
  }

  const checkFlags = async (user, total) => {
    const flagPoints = await getTableRows({
      code: accounts,
      scope: user,
      table: 'flagpts',
      json: true
    })
    assert({
      given: `${user} flagged`,
      should: 'have the correct flags',
      actual: flagPoints.rows.map(r => r.flag_points).reduce((acc, current) => acc + current),
      expected: total
    })
    const flagPointsGeneral = await getTableRows({
      code: accounts,
      scope: 'flag.total',
      table: 'flagpts',
      json: true
    })
    assert({
      given: `${user} flagged`,
      should: 'have the correct flags (general table)',
      actual: flagPointsGeneral.rows
        .filter(r => r.account == user)
        .map(r => r.flag_points)
        .reduce((acc, current) => acc + current),
      expected: total
    }) 
  }

  const checkPunishmentPoints = async (user, total) => {
    const flagRemoved = await getTableRows({
      code: accounts,
      scope: 'flag.remove',
      table: 'flagpts',
      json: true
    })
    assert({
      given: `${user} punished`,
      should: 'have the correct removed flags points',
      actual: flagRemoved.rows[0].flag_points,
      expected: total
    })
  }

  const checkUserStatus = async (user, status) => {
    const usersTable = await getTableRows({
      code: accounts,
      scope: accounts,
      table: 'users',
      json: true
    })
    const userStatus = (usersTable.rows.filter(u => u.account == user)[0]).status
    assert({
      given: `${user} punished`,
      should: 'have the correct status',
      actual: userStatus,
      expected: status
    })
  }

  console.log('change resident threshold')
  await contracts.settings.configure('res.rep.pt', 2, { authorization: `${settings}@active` })

  console.log('join users')
  await contracts.accounts.adduser(firstuser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(thirduser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fourthuser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fifthuser, `user`, 'individual', { authorization: `${accounts}@active` })

  console.log('make residents')
  await contracts.accounts.testcitizen(firstuser, { authorization: `${accounts}@active` })
  await contracts.accounts.testresident(seconduser, { authorization: `${accounts}@active` })
  await checkUserStatus(firstuser, 'citizen')

  console.log('make citizens')
  await contracts.accounts.testcitizen(thirduser, { authorization: `${accounts}@active` })
  await contracts.accounts.testcitizen(fourthuser, { authorization: `${accounts}@active` })

  console.log('add rep')
  await contracts.accounts.addrep(firstuser, 40, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(seconduser, 100, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(thirduser, 200, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(fourthuser, 300, { authorization: `${accounts}@active` })
  // await contracts.accounts.addrep(fifthuser, 20, { authorization: `${accounts}@active` })

  console.log('manipulating the ranking')
  await contracts.accounts.testsetrs(firstuser, 10, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(seconduser, 33, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(thirduser, 60, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(fourthuser, 99, { authorization: `${accounts}@active` })
  
  console.log('vouching')
  await contracts.accounts.vouch(seconduser, firstuser, { authorization: `${seconduser}@active` })
  await contracts.accounts.vouch(thirduser, firstuser, { authorization: `${thirduser}@active` })
  await contracts.accounts.vouch(seconduser, fifthuser, { authorization: `${seconduser}@active` })

  let rep_4 = 2
  let rep_0 = 51

  await checkReps([rep_0, 100, 200, 300, rep_4])

  console.log('set batchsize')
  await contracts.settings.configure('batchsize', 1, { authorization: `${settings}@active` })
  
  console.log('flag users')
  await contracts.accounts.flag(seconduser, firstuser, { authorization: `${seconduser}@active` })
  await contracts.accounts.flag(fourthuser, firstuser, { authorization: `${fourthuser}@active` })

  const flagsFirst = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'flags',
    json: true
  })


  let onlyOneFlag = true
  try {
    await sleep(300)
    await contracts.accounts.flag(fourthuser, firstuser, { authorization: `${fourthuser}@active` })
    onlyOneFlag = false
  } catch (err) {
    console.log('only one flag (expected)')
  }

  let onlyResidentCitizen = true
  try {
    await sleep(300)
    await contracts.accounts.flag(fifthuser, firstuser, { authorization: `${fifthuser}@active` })
    onlyResidentCitizen = false
  } catch (err) {
    console.log('only residents or citizens (expected)')
  }

  await sleep(2000)

  await checkFlags(firstuser, 46)
  await checkPunishmentPoints(firstuser, 46)
  await checkReps([rep_0 - 46, 77, 177, 300, rep_4])
  await checkUserStatus(firstuser, 'resident')

  console.log('remove flag')
  await contracts.accounts.removeflag(seconduser, firstuser, { authorization: `${seconduser}@active` })

  const flagsRemoved = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'flags',
    json: true
  })

  await checkFlags(firstuser, 40)
  await checkPunishmentPoints(firstuser, 46)
  await checkReps([rep_0 - 46, 77, 177, 300, rep_4])

  console.log('flag again')
  await sleep(300)
  await contracts.accounts.flag(seconduser, firstuser, { authorization: `${seconduser}@active` })
  await contracts.accounts.flag(thirduser, firstuser, { authorization: `${thirduser}@active` })

  await sleep(1500)

  await checkFlags(firstuser, 70) // -24



  await checkPunishmentPoints(firstuser, 70)
  await checkReps([65, 165, 300, rep_4])
  await checkUserStatus(firstuser, 'visitor')

  console.log('flag a user without rep')
  await contracts.accounts.testcitizen(fifthuser, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(fifthuser, 50, { authorization: `${accounts}@active` })
  await contracts.accounts.flag(fifthuser, firstuser, { authorization: `${fifthuser}@active` })
  await checkFlags(firstuser, 90)
  await checkPunishmentPoints(firstuser, 70)

  assert({
    given: 'user has flagged another user',
    should: 'only allow one flag',
    actual: onlyOneFlag,
    expected: true
  })

  assert({
    given: 'user is not a resident/citizen',
    should: 'not allow user to flag another one',
    actual: onlyResidentCitizen,
    expected: true
  })

  assert({
    given: '2 flags added',
    should: 'have table entries',
    actual: flagsFirst.rows,
    expected: [
      {"id":0,"from":"seedsuserbbb","to":"seedsuseraaa","flag_points":6},
      {"id":1,"from":"seedsuserxxx","to":"seedsuseraaa","flag_points":40}
    ]
  })
  assert({
    given: 'flags removed again',
    should: 'have table 1 table entry',
    actual: flagsRemoved.rows,
    expected: [
      {"id":1,"from":"seedsuserxxx","to":"seedsuseraaa","flag_points":40}
    ]
  })


})

describe('Delegate flagging', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const contracts = await initContracts({ accounts, settings })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset settings')
  await contracts.settings.reset({ authorization: `${settings}@active` })

  console.log('change flag threshold')
  await contracts.settings.configure('flag.thresh', 40, { authorization: `${settings}@active` })

  console.log('change resident threshold')
  await contracts.settings.configure('res.rep.pt', 2, { authorization: `${settings}@active` })

  console.log('join users')
  await contracts.accounts.adduser(firstuser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(thirduser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fourthuser, `user`, 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fifthuser, `user`, 'individual', { authorization: `${accounts}@active` })

  console.log('make residents')
  await contracts.accounts.testresident(firstuser, { authorization: `${accounts}@active` })
  await contracts.accounts.testresident(seconduser, { authorization: `${accounts}@active` })

  console.log('make citizens')
  await contracts.accounts.testcitizen(thirduser, { authorization: `${accounts}@active` })
  await contracts.accounts.testcitizen(fourthuser, { authorization: `${accounts}@active` })

  console.log('add rep')
  await contracts.accounts.addrep(firstuser, 40, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(seconduser, 100, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(thirduser, 200, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(fourthuser, 300, { authorization: `${accounts}@active` })
  await contracts.accounts.addrep(fifthuser, 20, { authorization: `${accounts}@active` })

  console.log('manipulating the ranking')
  await contracts.accounts.testsetrs(firstuser, 10, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(seconduser, 33, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(thirduser, 60, { authorization: `${accounts}@active` })
  await contracts.accounts.testsetrs(fourthuser, 99, { authorization: `${accounts}@active` })
  
  console.log('delegate flagging')
  await contracts.accounts.delegateflag(seconduser, firstuser, { authorization: `${seconduser}@active` })
  await contracts.accounts.delegateflag(thirduser, firstuser, { authorization: `${thirduser}@active` })
  await contracts.accounts.delegateflag(fourthuser, thirduser, { authorization: `${fourthuser}@active` })
  await contracts.accounts.delegateflag(fifthuser, fourthuser, { authorization: `${fifthuser}@active` })

  let cyclesNotAllowed = true
  try {
    await contracts.accounts.delegateflag(thirduser, fifthuser, { authorization: `${thirduser}@active` })
    cyclesNotAllowed = false
  } catch (err) {
    console.log('cycles are not allowed (expected)')
  }
  assert({ given: 'flag delegated', should: 'avoid having cycles', expected: true, actual: cyclesNotAllowed })

  let hasMaxDepth = true
  try {
    console.log('change flag max depth')
    await contracts.settings.configure('dlegate.dpth', 2, { authorization: `${settings}@active` })
    await contracts.accounts.delegateflag(seconduser, fourthuser, { authorization: `${seconduser}@active` })
    hasMaxDepth = false
  } catch (err) {
    console.log('max depth reached (expected)')
    await contracts.settings.configure('dlegate.dpth', 20, { authorization: `${settings}@active` })
  }
  assert({ given: 'depth reached', should: 'throw an error', expected: true, actual: hasMaxDepth })

  console.log('flag an user')
  await contracts.accounts.flag(firstuser, fifthuser, { authorization: `${firstuser}@active` })
  await sleep(4000)

  const flagPoints = await getTableRows({
    code: accounts,
    scope: fifthuser,
    table: 'flagpts',
    json: true
  })
  console.log(JSON.stringify(flagPoints, null, 4))

  assert({
    given: 'flag delegated',
    should: 'trigger flagging in the whole tree',
    expected: [firstuser, seconduser, thirduser, fourthuser],
    actual: flagPoints.rows.map(r => r.account)
  })

  const delegatorsTable = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'delegators',
    json: true
  })
  console.log(JSON.stringify(delegatorsTable, null, 4))

  assert({
    given: 'flag delegated',
    should: 'have the correct entries in the delegators table',
    actual: delegatorsTable.rows,
    expected: [
      {
          delegator: seconduser,
          delegatee: firstuser
      },
      {
          delegator: thirduser,
          delegatee: firstuser
      },
      {
          delegator: fourthuser,
          delegatee: thirduser
      },
      {
          delegator: fifthuser,
          delegatee: fourthuser
      }
    ]
  })

  console.log('undelegate flag')
  await contracts.accounts.undlgateflag(thirduser, { authorization: `${firstuser}@active` })
  await contracts.accounts.undlgateflag(fourthuser, { authorization: `${thirduser}@active` })

  const delegatorsTableAfterUndelegate = await getTableRows({
    code: accounts,
    scope: accounts,
    table: 'delegators',
    json: true
  })
  assert({
    given: 'undelegate flag',
    should: 'have the correct entries in the delegators table',
    actual: delegatorsTableAfterUndelegate.rows,
    expected: [
      {
        delegator: seconduser,
        delegatee: firstuser
      },
      {
          delegator: fifthuser,
          delegatee: fourthuser
      }
    ]
  })

  console.log('remove flag')
  await contracts.accounts.removeflag(firstuser, fifthuser, { authorization: `${firstuser}@active` })
  await sleep(4000)

  const flagPointsAfterRemove = await getTableRows({
    code: accounts,
    scope: fifthuser,
    table: 'flagpts',
    json: true
  })
  console.log(JSON.stringify(flagPointsAfterRemove, null, 4))

  assert({
    given: 'flag delegated',
    should: 'trigger remove flagging in the whole tree',
    expected: [thirduser, fourthuser],
    actual: flagPointsAfterRemove.rows.map(r => r.account)
  })


})

describe('Enforce accounts', async assert => {

  if (!isLocal()) {
    console.log("only run unit tests on local - don't reset accounts on mainnet or testnet")
    return
  }

  const eosDevKey = 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV'

  const contracts = await initContracts({ accounts, settings })

  console.log('reset accounts')
  await contracts.accounts.reset({ authorization: `${accounts}@active` })

  console.log('reset settings')
  await contracts.settings.reset({ authorization: `${settings}@active` })

  const generateString = (length) => {
    var result = ''
    var characters = 'abcdefghijklmnopqrstuvwxyz1234'
    var charactersLength = characters.length
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength))
    }
    return result
  }

  const string600 = generateString(600)
  const string512 = generateString(512)

  await contracts.accounts.adduser(firstuser, 'firstuser', 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(seconduser, 'seconduser', 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(thirduser, 'thirduser', 'individual', { authorization: `${accounts}@active` })
  await contracts.accounts.adduser(fourthuser, 'fourthuser', 'individual', { authorization: `${accounts}@active` })

  let fail0 = false

  await contracts.accounts.update(
    firstuser, 
    "individual", 
    "a valid nickname",
    string512,
    string512,
    string512,
    string512,
    string512,
    { authorization: `${firstuser}@active` })

  let fail1 = false
  try {
    await contracts.accounts.update(
      seconduser, 
      "individual", 
      seconduser,
      string600,
      string600,
      string512,
      string512,
      string512,
      { authorization: `${seconduser}@active` })
  
  } catch (err) {
    fail1 = true
    console.log("expected error")
  }

  let fail2 = false
  try {
    await contracts.accounts.update(
      thirduser, 
      "individual", 
      thirduser,
      string600,
      string600,
      string600,
      string600,
      string600,
      { authorization: `${thirduser}@active` })
  } catch (err) {
    fail2 = true
    console.log("expected error")
  }

  let fail3 = false
  try {
    await contracts.accounts.update(
      fourthuser, 
      "individual", 
      fourthuser,
      string512,
      string512,
      string512,
      generateString(132000),
      string512,
      { authorization: `${fourthuser}@active` })
  
  } catch (err) {
    fail3 = true
    console.log("expected error")
  }

  assert({
    given: 'ok entry 1',
    should: 'succeed',
    actual: fail0,
    expected: false
  })


  assert({
    given: 'too long entry 1',
    should: 'fail',
    actual: fail1,
    expected: true
  })
  assert({
    given: 'too long entry 2',
    should: 'fail',
    actual: fail2,
    expected: true
  })
  assert({
    given: 'too long entry 3',
    should: 'fail',
    actual: fail3,
    expected: true
  })





})


