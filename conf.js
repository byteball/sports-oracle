/*jslint node: true */
"use strict";

exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';


exports.hub = 'byteball.org/bb';
exports.deviceName = 'Flight delays oracle';
exports.permanent_paring_secret = '0000';
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

console.log('finished flight delays conf');
