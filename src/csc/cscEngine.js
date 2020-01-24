/**
 * Created by paul on 7/7/17.
 */
// @flow

import { bns } from 'biggystring'
import {
  type EdgeCurrencyEngineOptions,
  type EdgeSpendInfo,
  type EdgeTransaction,
  type EdgeWalletInfo,
  InsufficientFundsError,
  NoAmountSpecifiedError
} from 'edge-core-js/types'

import { CurrencyEngine } from '../common/engine.js'
import { getOtherParams, validateObject } from '../common/utils.js'
import { currencyInfo } from './cscInfo.js'
import { CscPlugin } from './cscPlugin.js'
import {
  CscGetBalancesSchema,
  CscGetServerInfoSchema,
  CscGetTransactionsSchema
} from './cscSchema.js'
import {
  type CscGetTransaction,
  type CscGetTransactions,
  type CscWalletOtherData
} from './cscTypes.js'

const ADDRESS_POLL_MILLISECONDS = 10000
const BLOCKHEIGHT_POLL_MILLISECONDS = 15000
const TRANSACTION_POLL_MILLISECONDS = 3000
const ADDRESS_QUERY_LOOKBACK_BLOCKS = 30 * 60 // ~ one minute

const PRIMARY_CURRENCY = currencyInfo.currencyCode

type CscParams = {
  preparedTx: Object
  // publicAddress?: string,
  // contractAddress?: string
}

type CscFunction =
  | 'getFee'
  | 'getServerInfo'
  | 'getTransactions'
  | 'getBalances'
  | 'connect'
  | 'disconnect'
  | 'preparePayment'
  | 'sign'
  | 'submit'
export class CscEngine extends CurrencyEngine {
  cscPlugin: CscPlugin
  otherData: CscWalletOtherData
  // callbacksSetup: boolean

  constructor(
    currencyPlugin: CscPlugin,
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ) {
    super(currencyPlugin, walletInfo, opts)
    this.cscPlugin = currencyPlugin
    // this.callbacksSetup = false
  }

  async multicastServers(func: CscFunction, ...params: any): Promise<any> {
    let out = { result: '', server: '' }
    switch (func) {
      // Functions that should waterfall from top to low priority servers
      case 'getFee':
      case 'getServerInfo':
      case 'getBalances':
      case 'getTransactions':
      case 'disconnect':
      case 'submit':
      case 'preparePayment':
      case 'sign':
        out = {
          result: await this.cscPlugin.casinocoinApi[func](...params),
          server: this.cscPlugin.casinocoinApi.serverName
        }
        break
    }
    this.log(`CSC multicastServers ${func} ${out.server} won`)
    return out.result
  }

  // Poll on the blockheight
  async checkServerInfoInnerLoop() {
    try {
      const fee = await this.multicastServers('getFee')
      if (typeof fee === 'string') {
        this.otherData.recommendedFee = fee
        this.walletLocalDataDirty = true
      }
      const jsonObj = await this.multicastServers('getServerInfo')
      const valid = validateObject(jsonObj, CscGetServerInfoSchema)
      if (valid) {
        const blockHeight: number = jsonObj.validatedLedger.ledgerVersion
        this.log(`Got block height ${blockHeight}`)
        if (this.walletLocalData.blockHeight !== blockHeight) {
          this.checkDroppedTransactionsThrottled()
          this.walletLocalData.blockHeight = blockHeight // Convert to decimal
          this.walletLocalDataDirty = true
          this.currencyEngineCallbacks.onBlockHeightChanged(
            this.walletLocalData.blockHeight
          )
        }
      } else {
        this.log('Invalid data returned from casinocoinApi.getServerInfo')
      }
    } catch (err) {
      this.log(`Error fetching height: ${JSON.stringify(err)}`)
    }
  }

  processCasinocoinTransaction(tx: CscGetTransaction) {
    const ourReceiveAddresses: Array<string> = []

    const balanceChanges =
      tx.outcome.balanceChanges[this.walletLocalData.publicKey]
    if (balanceChanges) {
      for (const bc of balanceChanges) {
        const currencyCode: string = bc.currency
        const date: number = Date.parse(tx.outcome.timestamp) / 1000
        const blockHeight: number =
          tx.outcome.ledgerVersion > 0 ? tx.outcome.ledgerVersion : 0
        const exchangeAmount: string = bc.value
        if (exchangeAmount.slice(0, 1) !== '-') {
          ourReceiveAddresses.push(this.walletLocalData.publicKey)
        }
        const nativeAmount: string = bns.mul(exchangeAmount, '100000000')
        let networkFee: string
        let parentNetworkFee: string
        if (currencyCode === PRIMARY_CURRENCY) {
          networkFee = bns.mul(tx.outcome.fee, '100000000')
        } else {
          networkFee = '0'
          parentNetworkFee = bns.mul(tx.outcome.fee, '100000000')
        }

        const edgeTransaction: EdgeTransaction = {
          txid: tx.id.toLowerCase(),
          date,
          currencyCode,
          blockHeight,
          nativeAmount,
          networkFee,
          parentNetworkFee,
          ourReceiveAddresses,
          signedTx: '',
          otherParams: {}
        }
        this.addTransaction(currencyCode, edgeTransaction)
      }
    }
  }

  async checkTransactionsInnerLoop() {
    const blockHeight = this.walletLocalData.blockHeight
    const address = this.walletLocalData.publicKey
    let startBlock: number = 0
    if (
      this.walletLocalData.lastAddressQueryHeight >
      ADDRESS_QUERY_LOOKBACK_BLOCKS
    ) {
      // Only query for transactions as far back as ADDRESS_QUERY_LOOKBACK_BLOCKS from the last time we queried transactions
      startBlock =
        this.walletLocalData.lastAddressQueryHeight -
        ADDRESS_QUERY_LOOKBACK_BLOCKS
    }

    try {
      let options
      if (startBlock > ADDRESS_QUERY_LOOKBACK_BLOCKS) {
        options = { minLedgerVersion: startBlock }
      }
      const transactions: CscGetTransactions = await this.multicastServers(
        'getTransactions',
        address,
        options
      )
      const valid = validateObject(transactions, CscGetTransactionsSchema)
      if (valid) {
        this.log(
          `Fetched transactions count: ${transactions.length} startBlock:${startBlock}`
        )

        // Get transactions
        // Iterate over transactions in address
        for (let i = 0; i < transactions.length; i++) {
          const tx = transactions[i]
          this.processCasinocoinTransaction(tx)
        }
        if (this.transactionsChangedArray.length > 0) {
          this.currencyEngineCallbacks.onTransactionsChanged(
            this.transactionsChangedArray
          )
          this.transactionsChangedArray = []
        }
        this.walletLocalData.lastAddressQueryHeight = blockHeight
        this.tokenCheckTransactionsStatus.CSC = 1
        this.updateOnAddressesChecked()
      } else {
        this.log('Invalid data returned from casinocoinApi.getTransactions')
      }
    } catch (e) {
      this.log(`Error fetching transactions: ${JSON.stringify(e)}`)
      this.log(`e.code: ${JSON.stringify(e.code)}`)
      this.log(`e.message: ${JSON.stringify(e.message)}`)
    }
  }

  async checkUnconfirmedTransactionsFetch() {}

  // Check all account balance and other relevant info
  async checkAccountInnerLoop() {
    const address = this.walletLocalData.publicKey
    try {
      const jsonObj = await this.multicastServers('getBalances', address)
      const valid = validateObject(jsonObj, CscGetBalancesSchema)
      if (valid) {
        for (const bal of jsonObj) {
          const currencyCode = bal.currency
          const exchangeAmount = bal.value
          const nativeAmount = bns.mul(exchangeAmount, '100000000')

          if (
            typeof this.walletLocalData.totalBalances[currencyCode] ===
            'undefined'
          ) {
            this.walletLocalData.totalBalances[currencyCode] = '0'
          }

          if (
            this.walletLocalData.totalBalances[currencyCode] !== nativeAmount
          ) {
            this.walletLocalData.totalBalances[currencyCode] = nativeAmount
            this.currencyEngineCallbacks.onBalanceChanged(
              currencyCode,
              nativeAmount
            )
          }
        }
        this.tokenCheckBalanceStatus.CSC = 1
        this.updateOnAddressesChecked()
      } else {
        this.log('Invalid data returned from casinocoinApi.getBalances')
      }
    } catch (e) {
      if (e.data) {
        if (e.data.error === 'actNotFound' || e.data.error_code === 19) {
          this.log('Account not found. Probably not activated w/minimum CSC')
          this.tokenCheckBalanceStatus.CSC = 1
          this.updateOnAddressesChecked()
          return
        }
      }
      this.log(`Error fetching address info: ${JSON.stringify(e)}`)
      this.log(`e.code: ${JSON.stringify(e.code)}`)
      this.log(`e.message: ${JSON.stringify(e.message)}`)
    }
  }

  async clearBlockchainCache() {
    await super.clearBlockchainCache()
  }

  // ****************************************************************************
  // Public methods
  // ****************************************************************************

  // setupCallbacks () {
  //   // Callbacks are persistent so only do once
  //   if (!this.callbacksSetup) {
  //     this.currencyPlugin.connectionPool.on('ledger', (ledger) => {
  //       this.log('Ledger A closed', ledger)
  //     })
  //     this.currencyPlugin.connectionPool.on('transaction', (tx) => {
  //       const valid = validateObject(tx, CscOnTransactionSchema)
  //       if (valid) {
  //         if (
  //           tx.Data.transaction.Account.toLowerCase() === this.walletLocalData.publicKey.toLowerCase() ||
  //           tx.Data.transaction.Destination.toLowerCase() === this.walletLocalData.publicKey.toLowerCase()
  //         ) {
  //           this.checkTransactionsInnerLoop()
  //         }
  //       } else {
  //         this.log('Invalid data from connectionPool on Transaction')
  //       }
  //     })
  //     this.callbacksSetup = true
  //   }
  // }

  // joinPool () {
  //   this.setupCallbacks()
  //   this.currencyPlugin.connectionPool.subscribeAccount(this.walletLocalData.publicKey)
  //   if (isEmpty(this.currencyPlugin.connectionClients)) {
  //     for (const s of this.currencyInfo.defaultSettings.otherSettings.casinocoindServers) {
  //       this.currencyPlugin.connectionPool.addServer(s)
  //     }
  //   }
  //   this.currencyPlugin.connectionClients[this.walletId] = true
  // }

  // leavePool () {
  //   this.currencyPlugin.connectionPool.unsubscribeAccount(this.walletLocalData.publicKey)
  //   const t = this.currencyPlugin.connectionPool.getRanking()
  //   this.log(t)
  //   delete this.currencyPlugin.connectionClients[this.walletId]
  //   if (isEmpty(this.currencyPlugin.connectionClients)) {
  //     for (const s of this.currencyInfo.defaultSettings.otherSettings.casinocoindServers) {
  //       this.currencyPlugin.connectionPool.removeServer(s)
  //     }
  //   }
  // }
  async startEngine() {
    this.engineOn = true
    // this.joinPool()
    // try {
    //   const result = await this.currencyPlugin.connectionPool.send({
    //     command: 'account_info',
    //     account: this.walletLocalData.publicKey
    //   }, {
    //     serverTimeout: 1500,
    //     overallTimeout: 10000
    //   })
    //   console.log(result)
    // } catch (e) {
    //   console.log('Error', e.message)
    // }
    try {
      await this.cscPlugin.connectApi(this.walletId)
    } catch (e) {
      this.log(`Error connecting to CSC server`)
      this.log(e)
      this.log(e.name)
      this.log(e.message)
      setTimeout(() => {
        if (this.engineOn) {
          this.startEngine()
        }
      }, 10000)
      return
    }
    this.addToLoop('checkServerInfoInnerLoop', BLOCKHEIGHT_POLL_MILLISECONDS)
    this.addToLoop('checkAccountInnerLoop', ADDRESS_POLL_MILLISECONDS)
    this.addToLoop('checkTransactionsInnerLoop', TRANSACTION_POLL_MILLISECONDS)
    super.startEngine()
  }

  async killEngine() {
    await super.killEngine()
    await this.cscPlugin.disconnectApi(this.walletId)
  }

  async resyncBlockchain(): Promise<void> {
    await this.killEngine()
    await this.clearBlockchainCache()
    await this.startEngine()
  }

  async makeSpend(edgeSpendInfoIn: EdgeSpendInfo) {
    const {
      edgeSpendInfo,
      currencyCode,
      nativeBalance,
      denom
    } = super.makeSpend(edgeSpendInfoIn)

    if (edgeSpendInfo.spendTargets.length !== 1) {
      throw new Error('Error: only one output allowed')
    }
    const publicAddress = edgeSpendInfo.spendTargets[0].publicAddress

    let nativeAmount = '0'
    if (typeof edgeSpendInfo.spendTargets[0].nativeAmount === 'string') {
      nativeAmount = edgeSpendInfo.spendTargets[0].nativeAmount
    } else {
      throw new Error('Error: no amount specified')
    }

    if (bns.eq(nativeAmount, '0')) {
      throw new NoAmountSpecifiedError()
    }

    const nativeNetworkFee = bns.mul(this.otherData.recommendedFee, '100000000')

    if (currencyCode === PRIMARY_CURRENCY) {
      const totalTxAmount = bns.add(nativeNetworkFee, nativeAmount)
      const virtualTxAmount = bns.add(totalTxAmount, '1000000000')
      if (bns.gt(virtualTxAmount, nativeBalance)) {
        throw new InsufficientFundsError()
      }
    }

    const exchangeAmount = bns.div(nativeAmount, denom.multiplier, 6)
    let uniqueIdentifier
    if (
      edgeSpendInfo.spendTargets[0].otherParams &&
      edgeSpendInfo.spendTargets[0].otherParams.uniqueIdentifier
    ) {
      if (
        typeof edgeSpendInfo.spendTargets[0].otherParams.uniqueIdentifier ===
        'string'
      ) {
        uniqueIdentifier = parseInt(
          edgeSpendInfo.spendTargets[0].otherParams.uniqueIdentifier
        )
      } else {
        throw new Error('Error invalid destinationtag')
      }
    }
    const payment = {
      source: {
        address: this.walletLocalData.publicKey,
        maxAmount: {
          value: exchangeAmount,
          currency: currencyCode
        }
      },
      destination: {
        address: publicAddress,
        amount: {
          value: exchangeAmount,
          currency: currencyCode
        },
        tag: uniqueIdentifier
      }
    }

    let preparedTx = {}
    let i = 6
    while (true) {
      i--
      try {
        preparedTx = await this.multicastServers(
          'preparePayment',
          this.walletLocalData.publicKey,
          payment,
          { maxLedgerVersionOffset: 300 }
        )
        break
      } catch (err) {
        if (typeof err.message === 'string' && i) {
          if (err.message.includes('has too many decimal places')) {
            // HACK: casinocoin-js seems to have a bug where this error is intermittently thrown for no reason.
            // Just retrying seems to resolve it. -paulvp
            console.log(
              'Got "too many decimal places" error. Retrying... ' + i.toString()
            )
            continue
          }
        }
        this.log(err)
        throw new Error('Error in preparePayment')
      }
    }

    const otherParams: CscParams = {
      preparedTx
    }

    nativeAmount = bns.add(nativeAmount, nativeNetworkFee)
    nativeAmount = '-' + nativeAmount

    const edgeTransaction: EdgeTransaction = {
      txid: '', // txid
      date: 0, // date
      currencyCode, // currencyCode
      blockHeight: 0, // blockHeight
      nativeAmount, // nativeAmount
      networkFee: nativeNetworkFee, // networkFee
      ourReceiveAddresses: [], // ourReceiveAddresses
      signedTx: '', // signedTx
      otherParams
    }

    this.log('Payment transaction prepared...')
    return edgeTransaction
  }

  async signTx(edgeTransaction: EdgeTransaction): Promise<EdgeTransaction> {
    const otherParams = getOtherParams(edgeTransaction)

    // Do signing
    const txJson = otherParams.preparedTx.txJSON
    const privateKey = this.walletInfo.keys.casinocoinKey

    const { signedTransaction, id } = await this.multicastServers(
      'sign',
      txJson,
      privateKey
    )
    this.log('Payment transaction signed...')

    edgeTransaction.signedTx = signedTransaction
    edgeTransaction.txid = id.toLowerCase()
    edgeTransaction.date = Date.now() / 1000

    return edgeTransaction
  }

  async broadcastTx(
    edgeTransaction: EdgeTransaction
  ): Promise<EdgeTransaction> {
    await this.multicastServers('submit', edgeTransaction.signedTx)
    return edgeTransaction
  }

  getDisplayPrivateSeed() {
    if (this.walletInfo.keys && this.walletInfo.keys.casinocoinKey) {
      return this.walletInfo.keys.casinocoinKey
    }
    return ''
  }

  getDisplayPublicSeed() {
    if (this.walletInfo.keys && this.walletInfo.keys.publicKey) {
      return this.walletInfo.keys.publicKey
    }
    return ''
  }
}

export { CurrencyEngine }
