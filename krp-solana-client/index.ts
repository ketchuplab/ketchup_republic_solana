import { clusterApiUrl, Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, transfer } from "@solana/spl-token";

import { getAllDevices, registerDevice, chargeTokenToDevice, checkProgram, mineTokenFromDevice, DeviceInfo } from './krp-client';
(async () => {

    console.log('begin....')

    ////////////////////////////////////////////////some actions here///////////////////////////////////////////////
    // test device object
    const device_info: DeviceInfo = {
        macAddr: "00:11:22:33:44:55", // device mac address
        owner: (new PublicKey(Array.from({ length: 32 }, () => 0))).toString(), // device holder
        tokenBalance: 100, //  init balance
        regTime: 1630301040, // register time of unix timestamp
        merchant: "Merchant", // merchant name
        longitude: "100.23111", // longitude
        latitude: "50.11231", //  latitude
    };
 
    // test some interfaces

    // step1: register device
    await registerDevice(device_info);

    // step2: charge token
    await chargeTokenToDevice(device_info.macAddr, 10000);
    
    // step3: mine token
    await mineTokenFromDevice(device_info.macAddr);

})();
