// @flow

import { assert, expect } from 'chai'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyPlugin,
  type EdgeCurrencyTools,
  makeFakeIo
} from 'edge-core-js'
import { before, describe, it } from 'mocha'

import edgeCorePlugins from '../../src/index.js'
import { expectRejection } from '../expectRejection.js'
import fixtures from './fixtures.js'

for (const fixture of fixtures) {
  let tools: EdgeCurrencyTools

  const WALLET_TYPE = fixture.WALLET_TYPE

  const fakeIo = makeFakeIo()
  const opts: EdgeCorePluginOptions = {
    initOptions: {},
    io: { ...fakeIo, random: size => fixture.key },
    nativeIo: {},
    pluginDisklet: fakeIo.disklet
  }
  const factory = edgeCorePlugins[fixture.pluginName]
  const plugin: EdgeCurrencyPlugin = factory(opts)

  describe(`parseUri for Wallet type ${WALLET_TYPE}`, function() {
    before('Tools', async function() {
      expect(plugin.currencyInfo.currencyCode).equals(
        fixture['Test Currency code']
      )
      return plugin.makeCurrencyTools().then(async currencyTools => {
        tools = currencyTools
      })
    })

    it('casinocoin valid address', function() {
      return expectRejection(
        tools.parseUri(fixture.parseUri['casinocoin valid address'][0])
      )
    })

  })
}
