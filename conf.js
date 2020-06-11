/*jslint node: true */
"use strict";

exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';


exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'sports oracle';
exports.permanent_pairing_secret = '0000';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 20;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.bRunWitness = false; // also post empty transactions when there are few datafeed transactions

// football-data.org credentials
exports.footballDataApiKey = '';

exports.KEYS_FILENAME = 'keys.json';

exports.expectedPaymentFromAa = 10000;
exports.issuer_base_aa = "UPGVQBNM6YOZS5OG7QFB2O2P4UF3LQNR";

console.log('finished sports oracle conf');
