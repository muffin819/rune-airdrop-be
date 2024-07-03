import { Psbt } from "bitcoinjs-lib";
import { SEND_UTXO_FEE_LIMIT } from "../../config/config";
import { IUtxo } from "../../utils/types";
import {
  getBtcUtxoInfo,
  getRuneUtxos,
  getRuneBalance,
} from "../../utils/unisat.api";
import { getSendBTCUTXOArray } from "../utxo/utxo.management";
import wallet from "../wallet/initializeWallet";
import { RuneTransferpsbt } from "./runeBtcTransactionPsbt";

export const sendRuneBtcTransaction = async (
  rune_id: string,
  networkType: string,
  total_amount: number,
  utxo_value: number,
  feeRate: number
): Promise<any> => {
  //get rune balance of admin wallet
  const rune_balance: any = await getRuneBalance(
    rune_id,
    networkType,
    wallet.address
  );

  //Check rune token is enough
  if (+rune_balance < total_amount) {
    return { isSuccess: false, data: `No enough rune balance for ${rune_id}` };
  }

  // Get rune utxos of admin wallet
  let runeUtxosTemp: any = await getRuneUtxos(
    rune_id,
    networkType,
    wallet.address
  );
  let runeUtxos: Array<IUtxo> = runeUtxosTemp;

  // Get btc utxos of admin wallet
  let btcUtxos: any = await getBtcUtxoInfo(wallet.address, networkType);

  btcUtxos = btcUtxos.filter(
    (item: IUtxo, index: number) =>
      item.value >= 10000 &&
      runeUtxos.find(
        (runeItem: IUtxo) =>
          runeItem.txid == item.txid && runeItem.vout == item.vout
      ) == undefined
  );

  // Sum of required Rune utxos values
  let runeUtxoArraySum = runeUtxos.reduce(
    (accum: number, utxo: IUtxo) => accum + utxo.value,
    0
  );

  // get initially selected utxo array
  let response = getSendBTCUTXOArray(
    btcUtxos,
    utxo_value + SEND_UTXO_FEE_LIMIT - runeUtxoArraySum
  );
  // check the btc balance is enough
  if (!response.isSuccess) {
    return { isSuccess: false, data: "Not enough balance on your wallet." };
  }

  // loop calculate fee using dummy transaction
  let selectedBtcUtxos = response.data;
  let redeemFee = SEND_UTXO_FEE_LIMIT;

  for (let i = 0; i < 3; i++) {
    //loop for exact calculation fee
    let redeemPsbt: Psbt = await RuneTransferpsbt(
      total_amount,
      utxo_value,
      rune_id,
      selectedBtcUtxos,
      networkType,
      runeUtxos,
      redeemFee
    );

    // Sign redeem psbt
    redeemPsbt = wallet.signPsbt(redeemPsbt, wallet.ecPair);
    // Calculate redeem fee
    redeemFee = redeemPsbt.extractTransaction(true).virtualSize() * feeRate;

    // update selectedBtcUtxo array
    response = getSendBTCUTXOArray(
      btcUtxos,
      utxo_value + SEND_UTXO_FEE_LIMIT - runeUtxoArraySum
    );
    if (!response.isSuccess) {
      return { isSuccess: false, data: "Not enough balance in your wallet." };
    }
    selectedBtcUtxos = response.data;
  }

  // Create real psbt
  let realPsbt: Psbt = await RuneTransferpsbt(
    total_amount,
    utxo_value,
    rune_id,
    selectedBtcUtxos,
    networkType,
    runeUtxos,
    redeemFee
  );

  // Sign real psbt
  realPsbt = wallet.signPsbt(realPsbt, wallet.ecPair);

  // Calculate real transaction fee
  const txHex: string = realPsbt.extractTransaction(true).toHex();

  return { isSuccess: true, data: txHex };
};