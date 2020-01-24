/* global */
// @flow

import { type EdgeCurrencyInfo } from 'edge-core-js/types'

import { imageServerUrl } from '../common/utils'
import { type CscSettings } from './cscTypes.js'

const otherSettings: CscSettings = {
  casinocoindServers: [
    'wss://ws01.casinocoin.org:4443'
  ]
}

const defaultSettings: any = {
  otherSettings
}

export const currencyInfo: EdgeCurrencyInfo = {
  currencyCode: 'CSC',
  displayName: 'CSC',
  pluginName: 'casinocoin',
  walletType: 'wallet:casinocoin',

  defaultSettings,

  addressExplorer: 'https://csc.observer/account/%s',
  transactionExplorer: 'https://csc.observer/transaction/%s',

  denominations: [
    {
      name: 'CSC',
      multiplier: '100000000',
      symbol: 'X'
    }
  ],
  symbolImage: `${imageServerUrl}/casinocoin-logo-solo-64.png`,
  symbolImageDarkMono: `${imageServerUrl}/casinocoin-logo-solo-64.png`,
  metaTokens: []
}
