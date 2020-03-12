/*jslint node: true */
"use strict";
const db = require('ocore/db.js');
const eventBus = require('ocore/event_bus.js');
const headlessWallet = require('headless-obyte');
const notifications = require('./notifications.js');
const conf = require('ocore/conf.js');
const objectHash = require('ocore/object_hash.js');
const aa_composer = require('ocore/aa_composer.js');
const data_feeds = require('ocore/data_feeds.js');
const storage = require('ocore/storage.js');
const commons = require('./commons.js');

const RETRY_TIMEOUT = 5 * 60 * 1000;

var assocQueuedDataFeeds = {};
var assocQueuedDataFeedsToAa = {};
var my_address;


function postDataFeed(datafeed, onDone) {
	var objMessage = {
		app: "data_feed",
		payload_location: "inline",
		payload_hash: objectHash.getBase64Hash(datafeed),
		payload: datafeed
	};
	var opts = {
		paying_addresses: [my_address],
		change_address: my_address,
		messages: [objMessage]
	};

	headlessWallet.sendMultiPayment(opts, onDone);
}

function reliablyPost(datafeed) {
	var feed_name, feed_value;
	for (var key in datafeed) {
		feed_name = key;
		feed_value = datafeed[key];
		break;
	}
	if (!feed_name)
		throw Error('no feed name');
	if (assocQueuedDataFeeds[feed_name]) // already queued
		return console.log(feed_name + " already queued");
	assocQueuedDataFeeds[feed_name] = feed_value;
	var onDataFeedResult = function(err) {
		if (err) {
			console.log('will retry posting the data feed later');
			notifications.notifyAdminAboutPostingProblem(err);
			setTimeout(function() {
				postDataFeed(datafeed, onDataFeedResult);
			}, RETRY_TIMEOUT + Math.round(Math.random() * 3000));
		}
		else {
			console.log("DataFeed published: " + feed_name);
			delete assocQueuedDataFeeds[feed_name];
		}
	};
	postDataFeed(datafeed, onDataFeedResult);
}


function readExisting(feed_name, handleResult) {
	if (assocQueuedDataFeeds[feed_name]) {
		return handleResult(true, false, assocQueuedDataFeeds[feed_name]);
	}

	var unstableDatafeedValue = readMyUnstableDatafeed(feed_name);
	if (unstableDatafeedValue)
		return handleResult(true, false, unstableDatafeedValue);

	data_feeds.readDataFeedValue([my_address], feed_name, null, 0, Infinity, false, "last", function(objResult){
		if (objResult.value === undefined)
			return handleResult(false);
		return handleResult(true, true, objResult.value);
	})

}

function postDatafeedToAa(feedName, value, aa_address, callbacks){

	if (assocQueuedDataFeedsToAa[feedName + aa_address]){
		console.log(feedName + ' to ' + aa_address + " already queued");
		return callbacks.ifError();
	}
	assocQueuedDataFeedsToAa[feedName + aa_address] = true;

	function deleteFromQueue(){
		assocQueuedDataFeedsToAa[feedName + aa_address] = false;
	}

	db.query("SELECT 1 FROM triggered_aas WHERE aa_address=? AND feed_name=?", [aa_address, feedName], function(triggered_aas_rows){
		if (triggered_aas_rows.length === 1){
			deleteFromQueue();
			return callbacks.ifAlreadyTriggered();
		}

		storage.readAADefinition(db, aa_address, function(definition){
			if (!definition){
				commons.deleteAaHavingRequestedFixturesFromDB(aa_address);
				deleteFromQueue();
				return callbacks.ifNotAa();
			}

			var trigger = { 
				outputs: {base: 10000}, 
				address: my_address,
				data: {}
			};
			
			trigger.data['feed_name'] = feedName;
			trigger.data['result'] = value;

			var paymentToMe = 0;
			aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, definition, function (arrResponses) {
				arrResponses.forEach(function (objResponse) {
					if (objResponse.objResponseUnit && objResponse.objResponseUnit.messages){
						objResponse.objResponseUnit.messages.forEach(function (message) {
							if (message.app === 'payment') {
								message.payload.outputs.forEach(function (output) {
									if (output.address === my_address)
										paymentToMe += output.amount;
								});
							}
						});
					}
				})

				if (paymentToMe < conf.expectedPaymentFromAa){
					deleteFromQueue();
					return callbacks.ifNotPayingAa();
				}

				var objMessage = {
					app: "data",
					payload_location: "inline",
					payload_hash: objectHash.getBase64Hash(trigger.data),
					payload: trigger.data
				};
				var opts = {
					paying_addresses: [my_address],
					change_address: my_address,
					amount: 10000,
					to_address: aa_address,
					messages: [objMessage]
				};
			
				headlessWallet.sendMultiPayment(opts, function(err){
					
					if (err){
						console.log("payment failed " + err);
						deleteFromQueue();
						callbacks.ifError();

					} else {
						db.query("INSERT INTO triggered_aas (aa_address, feed_name) VALUES (?,?)", [aa_address,feedName], function(){ 
							deleteFromQueue();
							callbacks.ifSuccess();
						});

					}
					
				});

			});
		});
	});

}


function readMyUnstableDatafeed(feed_name){
	var foundValue = null;
	for (var unit in storage.assocUnstableMessages) {
		var objUnit = storage.assocUnstableUnits[unit] || storage.assocStableUnits[unit];
		if (!objUnit)
			throw Error("unstable unit " + unit + " not in assoc");
		if (objUnit.author_addresses != my_address)
			continue;
		storage.assocUnstableMessages[unit].forEach(function (message) {
			if (message.app !== 'data_feed')
				return;
			var payload = message.payload;
			if (!payload.hasOwnProperty(feed_name))
				return;
			foundValue = payload[feed_name];
		});
	}
	return foundValue;
}

eventBus.on('headless_wallet_ready', function() {

	headlessWallet.readSingleAddress(function(address) {
		my_address = address;
	});
});

exports.reliablyPost = reliablyPost;
exports.readExisting = readExisting;
exports.postDatafeedToAa = postDatafeedToAa;