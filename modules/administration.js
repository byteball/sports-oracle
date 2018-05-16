/*jslint node: true */
"use strict";
const db = require('byteballcore/db.js');
const commons = require('./commons.js');
const datafeeds = require('./datafeeds.js');

function processCmd(from_address, assocPeers, text){
	
	if (text == "post") {
		assocPeers[from_address].step = 'waitingFeedname';
		listFixturesHavingCriticalError(function(list){
			var device = require('byteballcore/device.js');
			device.sendMessageToDevice(from_address, 'text', list + "Enter feedname to post or return " + commons.getTxtCommandButton("home"));
		});
		return true;
	}
	
		
	if (text == "delete") {
		assocPeers[from_address].step = 'deleteFeedname';
		listFixturesHavingCriticalError(function(list){
			var device = require('byteballcore/device.js');
			device.sendMessageToDevice(from_address, 'text', list + "\nEnter feedname to delete or return " + commons.getTxtCommandButton("home"));
		});

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
				return device.sendMessageToDevice(from_address, 'text', "\nEnter value for " + text + " or return " + commons.getTxtCommandButton("home"));
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

	
	if (assocPeers[from_address].step == 'deleteFeedname') {
		commons.deleteFromDB(text);
		assocPeers[from_address].step = 'home';
		var device = require('byteballcore/device.js');
		device.sendMessageToDevice(from_address, 'text', text + " has been deleted from DB.\n➡ " + commons.getTxtCommandButton("ok"));
		return true;
	}

	return false;
}

function listFixturesHavingCriticalError(handle){
	var returnedTxt = ''
	db.query("SELECT feed_name FROM requested_fixtures WHERE has_critical_error = 1",function(rows){
		rows.forEach(row => {
			returnedTxt+= "\n" + commons.getTxtCommandButton(row.feed_name);
		});
	return handle(returnedTxt);
	});
}

exports.processCmd = processCmd;