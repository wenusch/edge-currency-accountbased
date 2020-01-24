/**
 * Created by paul on 8/8/17.
 */
// @flow

import {bns} from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyEngineOptions,
  type EdgeCurrencyPlugin,
  type EdgeEncodeUri,
  type EdgeIo,
  type EdgeParsedUri,
  type EdgeWalletInfo
} from 'edge-core-js/types'
import keypairs from 'casinocoin-libjs-keypairs'
import {CasinocoinAPI} from '@casinocoin/libjs'

import {CurrencyPlugin} from '../common/plugin.js'
import {asyncWaterfall, getDenomInfo} from '../common/utils.js'
import {CscEngine} from './cscEngine.js'
import {currencyInfo} from './cscInfo.js'


export class CscPlugin extends CurrencyPlugin {
  casinocoinApi: Object
  casinocoinApiSubscribers: { [walletId: string]: boolean }
  // connectionPool: Object
  connectionClients: { [walletId: string]: boolean }

  constructor(io: EdgeIo) {
    super(io, 'casinocoin', currencyInfo)
    this.connectionClients = {}
    this.casinocoinApi = {}
    this.casinocoinApiSubscribers = {}
  }


  checkAddress(address: string): boolean {
    try {
      var accountValidator = new RegExp('(?:^c[0-9a-zA-Z]{24,34}$)')
      return accountValidator.test(address)
    } catch (e) {
      return false
    }
  }


  async connectApi(walletId: string): Promise<void> {
    if (!this.casinocoinApi.serverName) {
      const funcs = this.currencyInfo.defaultSettings.otherSettings.casinocoindServers.map(
        server => async () => {
          const api = new CasinocoinAPI({ server })
          api.serverName = server
          const result = await api.connect()
          const out = { server, result, api }
          return out
        }
      )
      const result = await asyncWaterfall(funcs)
      if (!this.casinocoinApi.serverName) {
        this.casinocoinApi = result.api
      }
    }
    this.casinocoinApiSubscribers[walletId] = true
  }

  async disconnectApi(walletId: string): Promise<void> {
    delete this.casinocoinApiSubscribers[walletId]
    if (Object.keys(this.casinocoinApiSubscribers).length === 0) {
      await this.casinocoinApi.disconnect()
      this.casinocoinApi = {}
    }
  }

  importPrivateKey(privateKey: string): Promise<{ casinocoinKey: string }> {
    privateKey.replace(/ /g, '')
    if (privateKey.length !== 29 && privateKey.length !== 31) {
      throw new Error('Private key wrong length')
    }
    const keypair = keypairs.deriveKeypair(privateKey)
    keypairs.deriveAddress(keypair.publicKey)
    return Promise.resolve({ casinocoinKey: privateKey })
  }

  async createPrivateKey(walletType: string): Promise<Object> {
    const type = walletType.replace('wallet:', '')

    if (type === 'casinocoin' ) {
      const server = this.currencyInfo.defaultSettings.otherSettings
        .casinocoindServers[0]
      const api = new CasinocoinAPI({ server })
      const address = api.generateAddress()

      return { casinocoinKey: address.secret }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async derivePublicKey(walletInfo: EdgeWalletInfo): Promise<Object> {
    const type = walletInfo.type.replace('wallet:', '')
    if (type === 'casinocoin') {
      const keypair = keypairs.deriveKeypair(walletInfo.keys.casinocoinKey)
      const publicKey = keypairs.deriveAddress(keypair.publicKey)
      return { publicKey }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async parseUri(uri: string): Promise<EdgeParsedUri> {
    const networks = {
      casinocoin: true,
    }

    const { parsedUri, edgeParsedUri } = this.parseUriCommon(
      currencyInfo,
      uri,
      networks
    )
    const valid = checkAddress(edgeParsedUri.publicAddress || '')

    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }

    edgeParsedUri.uniqueIdentifier = parsedUri.query.dt || undefined
    return edgeParsedUri
  }

  async encodeUri(obj: EdgeEncodeUri): Promise<string> {
    const valid = checkAddress(obj.publicAddress)
    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }
    let amount
    if (typeof obj.nativeAmount === 'string') {
      const currencyCode: string = 'CSC'
      const nativeAmount: string = obj.nativeAmount
      const denom = getDenomInfo(currencyInfo, currencyCode)
      if (!denom) {
        throw new Error('InternalErrorInvalidCurrencyCode')
      }
      amount = bns.div(nativeAmount, denom.multiplier, 6)
    }
    return this.encodeUriCommon(obj, 'casinocoin', amount)
  }
}

export function makeCasinocoinPlugin(
  opts: EdgeCorePluginOptions
): EdgeCurrencyPlugin {
  const { io } = opts

  let toolsPromise: Promise<CscPlugin>
  function makeCurrencyTools(): Promise<CscPlugin> {
    if (toolsPromise != null) return toolsPromise
    toolsPromise = Promise.resolve(new CscPlugin(io))
    return toolsPromise
  }

  async function makeCurrencyEngine(
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine> {
    const tools = await makeCurrencyTools()
    const currencyEngine = new CscEngine(tools, walletInfo, opts)

    await currencyEngine.loadEngine(tools, walletInfo, opts)

    // This is just to make sure otherData is Flow type checked
    currencyEngine.otherData = currencyEngine.walletLocalData.otherData

    if (!currencyEngine.otherData.recommendedFee) {
      currencyEngine.otherData.recommendedFee = '0'
    }

    const out: EdgeCurrencyEngine = currencyEngine
    return out
  }

  return {
    currencyInfo,
    makeCurrencyEngine,
    makeCurrencyTools
  }
}
