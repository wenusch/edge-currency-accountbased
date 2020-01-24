/**
 * Created by paul on 8/26/17.
 */
// @flow

export type CscSettings = {
  casinocoindServers: Array<string>
}

export type CscCustomToken = {
  currencyCode: string,
  currencyName: string,
  multiplier: string,
  contractAddress: string
}

export type CscBalanceChange = {
  currency: string,
  value: string
}
export type CscGetTransaction = {
  type: string,
  address: string,
  id: string,
  outcome: {
    result: string,
    timestamp: string,
    fee: string,
    ledgerVersion: number,
    balanceChanges: {
      [address: string]: Array<CscBalanceChange>
    }
  }
}
export type CscWalletOtherData = {
  recommendedFee: string // Floating point value in full CSC value
}
export type CscGetTransactions = Array<CscGetTransaction>
