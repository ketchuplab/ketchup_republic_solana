use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use std::collections::HashMap;
// define the device struct
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct DeviceInfo {
    pub mac_addr: String,
    pub owner: Pubkey,
    pub token_balance: u64,
    pub reg_time: u64,
    pub merchant: String,
    pub longitude: String,
    pub latitude: String,
}

// define the device list holder struct
#[derive(BorshSerialize, BorshDeserialize, Debug)]
struct DeviceAccount {
    pub counter: u32,
    pub device_list: Vec<DeviceInfo>,
}
// define miner struct
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct MinerInfo {
    pub owner: Pubkey,
    pub token_balance: u64,
}

// define miner list holder struct
#[derive(BorshSerialize, BorshDeserialize, Debug)]
struct MinerAccount {
    pub counter: u32,
    pub miner_dic: HashMap<Pubkey, MinerInfo>,
}

// Declare and export the program's entrypoint
entrypoint!(process_instruction);

// Program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to
    _instruction_data: &[u8], // Ignored, all instructions are here
) -> ProgramResult {
    msg!("Ketchup Node Rust program entrypoint");
    let (instruction, rest) = _instruction_data
        .split_first()
        .ok_or(ProgramError::Custom(1))?;

    // according to the instructions and do some actions
    match instruction {
        // add device to device list
        0 => {
            // parse the data fields
            let (mac_address, rest) = split_bytes(rest)?;
            let (initial_tokens, rest) = split_u64(rest)?;
            let (registration_time, rest) = split_u64(rest)?;
            let (merchant_name, rest) = split_bytes(rest)?;
            let (longitude, rest) = split_bytes(rest)?;
            let (latitude, rest) = split_bytes(rest)?;
            // let (is_valid, _) = split_bool(rest)?;

            // get accounts
            // account1: operator  account: usually an administer
            // account2: device list account(PDA)
            // account3: device owner account
            let accounts_iter = &mut accounts.iter();
            let admin_account = next_account_info(accounts_iter)?;
            let device_list_account = next_account_info(accounts_iter)?;
            let device_owner_account = next_account_info(accounts_iter)?;

            // The account must be owned by the program in order to modify its data
            if admin_account.owner != program_id {
                msg!("admin account does not have the correct program id");
                return Err(ProgramError::IncorrectProgramId);
            }

            // get he device holder pub key
            let device_owner = device_owner_account.key;

            //create a device object
            let device_info = DeviceInfo {
                mac_addr: mac_address.to_string(),   // device beacon mac
                owner: *device_owner,                // device holder pubkey
                token_balance: initial_tokens,       // init token balance of one devie
                reg_time: registration_time,         // int register time (Unix timestamp)
                merchant: merchant_name.to_string(), // merchant name
                longitude: longitude.to_string(),    // longitude
                latitude: latitude.to_string(),      // latitude
            };

            // Increment and store the number of device list count
            let mut device_holder =
                DeviceAccount::try_from_slice(&device_list_account.data.borrow())?;
            device_holder.counter += 1;

            // create a test device object
            //  let device_info = DeviceInfo {
            //      mac_addr: "00:11:22:33:44:55".to_string(), // device beacon mac
            //      owner: Pubkey::new_from_array([0; 32]),    // device holder pubkey
            //      token_balance: 100,                        // init token balance of one devie
            //      reg_time: 1630301040,                      // int register time (Unix timestamp)
            //      merchant: "Merchant".to_string(),          // merchant name
            //      longitude: "100.0".to_string(),            // longitude
            //      latitude: "50.0".to_string(),              // latitude
            //  };

            // check device exist
            for existing_device in &device_holder.device_list {
                if existing_device.mac_addr == device_info.mac_addr {
                    return Err(ProgramError::Custom(1)); // throw a new custom error
                }
            }
            device_holder.device_list.push(device_info);
            device_holder.serialize(&mut &mut device_list_account.data.borrow_mut()[..])?;

            msg!("Device hub add device No. {} !", device_holder.counter);
        }
        1 => {
            // charge some token balance to our device
            let (mac_address, rest) = split_bytes(rest)?;
            let (charge_tokens, rest) = split_u64(rest)?;

            let accounts_iter = &mut accounts.iter();
            let admin_account = next_account_info(accounts_iter)?;
            let device_list_account = next_account_info(accounts_iter)?;

            let mut device_holder = DeviceAccount::try_from_slice(&device_list_account.data.borrow())?;
            for existing_device in &mut device_holder.device_list {
                if existing_device.mac_addr == mac_address.to_string() {
                    existing_device.token_balance += charge_tokens;
                    device_holder.serialize(&mut &mut device_list_account.data.borrow_mut()[..])?;
                    break;
                }
            }
        }
        2 => {
            // mine some tokens from the device
            let (mac_address, rest) = split_bytes(rest)?; 
            
            let accounts_iter = &mut accounts.iter();
            let miner_account = next_account_info(accounts_iter)?;
            let miner_dic_account = next_account_info(accounts_iter)?;
            let device_list_account = next_account_info(accounts_iter)?;

            let mut miner_holder = MinerAccount::try_from_slice(&miner_dic_account.data.borrow())?;
            let mut device_holder = DeviceAccount::try_from_slice(&device_list_account.data.borrow())?;


            let account_key: &Pubkey = miner_account.key;
            if let None = miner_holder.miner_dic.get(&account_key) {
                // if not exist in miner_dic, create a new one 
                let new_miner_info = MinerInfo {
                    owner: account_key.clone(),  //  
                    token_balance: 0,  // init it token_balance 0
                };
                miner_holder.miner_dic.insert(account_key.clone(), new_miner_info);
            }
            let is_find = false;
            for existing_device in &mut device_holder.device_list {
                if existing_device.mac_addr == mac_address.to_string() {
                    if (existing_device.token_balance > 0) {  
                        if let Some(mut miner_info) = miner_holder.miner_dic.get_mut(account_key) { 
                            let mine_min_unit = 1;
                            let token_balance = miner_info.token_balance;
                            miner_info.token_balance +=mine_min_unit;    // add one unit
                            existing_device.token_balance -= mine_min_unit;  // sub  one unit
                            device_holder.serialize(&mut &mut device_list_account.data.borrow_mut()[..])?;
                            is_find = true;
                            break;
                        }
                    }
                }
            }
            if(!is_find){
                return Err(ProgramError::Custom(2)); // not device find
            }
        },
        3 => {
            // TODO: withdraw from account

        },
        4 => {
            // TODO: other action here
            
        }
        _ => {
            msg!("Invalid instruction");
            return Err(ProgramError::Custom(1));
        }
    }

    Ok(())
}

////////////////////////////////////////////////////////////////////////////////////////
// some help functions to parse data from client

// parse string from the byte array
fn split_bytes<'a>(bytes: &'a [u8]) -> Result<(&'a str, &'a [u8]), ProgramError> {
    let length = bytes[0] as usize;
    let string = std::str::from_utf8(&bytes[1..=length]).map_err(|_| ProgramError::Custom(1))?;
    Ok((string, &bytes[length + 1..]))
}

// parse u64 from the byte array
fn split_u64(bytes: &[u8]) -> Result<(u64, &[u8]), ProgramError> {
    let (bytes_u64, rest) = bytes.split_at(std::mem::size_of::<u64>());
    let value = u64::from_le_bytes(bytes_u64.try_into().map_err(|_| ProgramError::Custom(1))?);
    Ok((value, rest))
}

// parse bool from the byte array
fn split_bool(bytes: &[u8]) -> Result<(bool, &[u8]), ProgramError> {
    let (byte_bool, rest) = bytes.split_at(1);
    let value = match byte_bool[0] {
        0 => false,
        1 => true,
        _ => return Err(ProgramError::Custom(1)),
    };
    Ok((value, rest))
}

////////////////////////////////////////////////////////////////////////////////////////
