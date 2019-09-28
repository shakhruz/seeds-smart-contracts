const { describe } = require('riteway')
const { eos, names } = require('../scripts/helper')

const { policy, firstuser } = names

describe('policy', async assert => {
  const contract = await eos.contract(policy)

  let accountField = firstuser
  let uuidField = '123'
  let signatureField = 'signature-string'
  let policyField = 'policy-string'

  await contract.create(
    accountField,
    uuidField,
    signatureField,
    policyField,
    { authorization: `${firstuser}@active` }
  )

  policyField = 'updated-policy-string'

  await contract.update(
    accountField,
    uuidField,
    signatureField,
    policyField,
    { authorization: `${firstuser}@active` }
  )

  const { rows } = await eos.getTableRows({
    code: policy,
    scope: firstuser,
    table: 'policies',
    json: true
  })

  assert({
    given: 'created & updated policy',
    should: 'show created row in table',
    actual: rows,
    expected: [{
      account: accountField,
      uuid: uuidField,
      signature: signatureField,
      policy: policyField
    }]
  })
})
