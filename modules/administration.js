/*jslint node: true */
"use strict";
const db = require('byteballcore/db.js');
const commons = require('./commons.js');
const datafeeds = require('./datafeeds.js');

function processCmd(from_address, assocPeers, text){
	
	if (text == "post") {
		assocPeers[from_address].step = 'waitingFeedname';
		var device = require('byteballcore/device.js');
		device.sendMessageToDevice(from_address, 'text', "Enter feedname or return " + commons.getTxtCommandButton("home"));
		return true;
	}

	if (assocPeers[from_address].step == 'waitingFeedname') {
		datafeeds.readExisting(text, function(exists, is_stable, value) {
			if (exists) {
				assocPeers[from_address].step = 'home';
				var device = require('byteballcore/device.js');
				return device.sendMessageToDevice(from_address, 'text', "This feedname was already posted with " + value + " as value");
			} else {
				assocPeers[from_address].step = 'waitingValue';
				assocPeers[from_address].feedNametoBePosted = text;
				var device = require('byteballcore/device.js');
				return device.sendMessageToDevice(from_address, 'text', "Enter value for " + text + " or return " + commons.getTxtCommandButton("home"));
			}
		});
		return true;
	}
	
	if (assocPeers[from_address].step == 'waitingValue') {
		var datafeed = {};
		datafeed[assocPeers[from_address].feedNametoBePosted] = text;
		datafeeds.reliablyPost(datafeed);
		assocPeers[from_address].step = 'home';
		var device = require('byteballcore/device.js');
		device.sendMessageToDevice(from_address, 'text', "The feedname is being posted \n➡ " + commons.getTxtCommandButton("ok"));
		return true;
	}

	return false;
}

exports.processCmd = processCmd;