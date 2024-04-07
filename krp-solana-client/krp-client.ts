/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import {getPayer, getRpcUrl, createKeypairFromFile} from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * ketchup republic's program id
 */
let programId: PublicKey;

/**
 * The public key of the accounts that hold device list and miner list
 */
let deviceAccountPubkey: PublicKey;
let minerAccountPubkey: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'krp.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/krp.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'krp-keypair.json');

export class DeviceInfo {
  macAddr: string;
  owner: string; //  
  tokenBalance: number;
  regTime: number;
  merchant: string;
  longitude: string;
  latitude: string;
}

/**
 * The state of a device account managed by the ketchup republic contract program
 */
 class DeviceAccount {
  counter: number;
  deviceList: DeviceInfo[];

  constructor(fields?: { counter: number, deviceList: DeviceInfo[] }) {
    this.counter = fields?.counter ?? 0;
    this.deviceList = fields?.deviceList ?? [];
  }
}

/**
 * Borsh schema definition for device accounts
 */
const DeviceAccountSchema = new Map([
  [DeviceAccount, {kind: 'struct', fields: [['counter', 'u32'],['deviceList','DeviceInfo[]']]}],
]);

// device info Borsh schema
const DeviceInfoSchema = new Map([
  [
    DeviceInfo,
    {
      kind: 'struct',
      fields: [
        ['macAddr', 'string'], // 
        ['owner', 'string'], // 
        ['tokenBalance', 'u64'], //
        ['regTime', 'u64'], // 
        ['merchant', 'string'], // 
        ['longitude', 'string'], //
        ['latitude', 'string'], // 
      ],
    },
  ],
]);

/**
 * The expected size of each device holder account.
 */
const DEVICE_ACC_SIZE = borsh.serialize(
  DeviceAccountSchema,
  new DeviceAccount(),
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the payer account
    fees += await connection.getMinimumBalanceForRentExemption(DEVICE_ACC_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the krp BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}`,
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed!',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address (public key) of a pad accounts from the program so that it's easy to find later.
  const DEVICE_LIST_HOLDER_SEED = 'deviceholderpda';
  const MINER_LIST_HOLDER_SEED = 'minerholderpda';
  deviceAccountPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    DEVICE_LIST_HOLDER_SEED,
    programId,
  );
  minerAccountPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    MINER_LIST_HOLDER_SEED,
    programId,
  );

  // Check if the device holder account has already been created
  const deviceHolderAcc = await connection.getAccountInfo(deviceAccountPubkey);
  if (deviceHolderAcc === null) {
    console.log('add device',deviceAccountPubkey.toBase58());
    const lamports = await connection.getMinimumBalanceForRentExemption(
      DEVICE_ACC_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: DEVICE_LIST_HOLDER_SEED,
        newAccountPubkey: deviceAccountPubkey,
        lamports,
        space: DEVICE_ACC_SIZE,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

/**
 * add device to blockchain, with cmd : 0
 */
export async function registerDevice(device_info): Promise<void> {
    console.log('register device begin => ', deviceAccountPubkey.toBase58()); 
    const cmdBuffer = Buffer.from([1]);

    const serializedData = Buffer.from(borsh.serialize(DeviceInfoSchema, device_info)); 
    const finalData = Buffer.concat([cmdBuffer, serializedData]);
    const instruction = new TransactionInstruction({
      keys: [
        {pubkey: payer.publicKey, isSigner: false, isWritable: true},  // admin
        {pubkey: deviceAccountPubkey, isSigner: false, isWritable: true}, //device list pda
        {pubkey: payer.publicKey, isSigner: false, isWritable: true}, // owner
      ],
      programId,
      data: finalData, //   instructions  and data combine together
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [payer],
    );
}
/**
 * chargeToken to device, with cmd : 1
 */
export async function chargeTokenToDevice(mac_addr,tokenCnt): Promise<void> {
    console.log('charge token to device begin => ', deviceAccountPubkey.toBase58()); 
    const cmdBuffer = Buffer.from([1]);
    const macBuffer = Buffer.from(mac_addr); 
    const tokenBuffer = Buffer.from([tokenCnt]); 
 
    const finalData = Buffer.concat([cmdBuffer, macBuffer,tokenBuffer]);
    const instruction = new TransactionInstruction({
      keys: [
        {pubkey: payer.publicKey, isSigner: false, isWritable: true},  // admin
        {pubkey: deviceAccountPubkey, isSigner: false, isWritable: true}, //device list pda 
      ],
      programId,
      data: finalData, //   instructions  and data combine together
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [payer],
    );
}
/**
 * mine token from device, with cmd : 2
 */
export async function mineTokenFromDevice(mac_addr): Promise<void> {
    console.log('mine token from device begin => ', minerAccountPubkey.toBase58()); 
    const cmdBuffer = Buffer.from([2]);
    const macBuffer = Buffer.from(mac_addr);  
 
    const finalData = Buffer.concat([cmdBuffer, macBuffer]);
    const instruction = new TransactionInstruction({
      keys: [
        {pubkey: payer.publicKey, isSigner: false, isWritable: true},  // miner 
        {pubkey: minerAccountPubkey, isSigner: false, isWritable: true}, //miner dic pda 
        {pubkey: deviceAccountPubkey, isSigner: false, isWritable: true}, //device list pda 
      ],
      programId,
      data: finalData, //   instructions  and data combine together
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [payer],
    );
}

/**
 * get all device list
 */
export async function getAllDevices(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(deviceAccountPubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the deviceAccountPubkey';
  }
  const deviceHolderAcc = borsh.deserialize(
    DeviceAccountSchema,
    DeviceAccount,
    accountInfo.data,
  )as DeviceAccount;
  console.log( deviceAccountPubkey.toBase58(), 'all registered devices: ', deviceHolderAcc.counter);

  //travel deviceList
  deviceHolderAcc.deviceList.forEach((device: DeviceInfo) => {
    console.log('Device:', device);
  });
}

