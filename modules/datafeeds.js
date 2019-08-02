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
const WITNESSING_COST = 600; // size of typical witnessing unit

var assocQueuedDataFeeds = {};
var count_witnessings_available = 0;
var my_address;

// this duplicates witness code if we are also running a witness
function readNumberOfWitnessingsAvailable(handleNumber) {
	count_witnessings_available--;
	if (count_witnessings_available > conf.MIN_AVAILABLE_WITNESSINGS)
		return handleNumber(count_witnessings_available);
	db.query(
		"SELECT COUNT(*) AS count_big_outputs FROM outputs JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0", [my_address, WITNESSING_COST],
		function(rows) {
			var count_big_outputs = rows[0].count_big_outputs;
			db.query(
				"SELECT SUM(amount) AS total FROM outputs JOIN units USING(unit) \n\
				WHERE address=? AND is_stable=1 AND amount<? AND asset IS NULL AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM witnessing_outputs \n\
				WHERE address=? AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM headers_commission_outputs \n\
				WHERE address=? AND is_spent=0", [my_address, WITNESSING_COST, my_address, my_address],
				function(rows) {
					var total = rows.reduce(function(prev, row) {
						return (prev + row.total);
					}, 0);
					var count_witnessings_paid_by_small_outputs_and_commissions = Math.round(total / WITNESSING_COST);
					count_witnessings_available = count_big_outputs + count_witnessings_paid_by_small_outputs_and_commissions;
					handleNumber(count_witnessings_available);
				}
			);
		}
	);
}


// make sure we never run out of spendable (stable) outputs. Keep the number above a threshold, and if it drops below, produce more outputs than consume.
function createOptimalOutputs(handleOutputs) {
	var arrOutputs = [{
		amount: 0,
		address: my_address
	}];
	readNumberOfWitnessingsAvailable(function(count) {
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs(arrOutputs);
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1", [my_address, 2 * WITNESSING_COST],
			function(rows) {
				if (rows.length === 0) {
					notifications.notifyAdminAboutPostingProblem('only ' + count + " spendable outputs left, and can't add more");
					return handleOutputs(arrOutputs);
				}
				var amount = rows[0].amount;
				//	notifications.notifyAdminAboutPostingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({
					amount: Math.round(amount / 2),
					address: my_address
				});
				handleOutputs(arrOutputs);
			}
		);
	});
}



function postDataFeed(datafeed, onDone) {
	function onError(err) {
		notifications.notifyAdminAboutFailedPosting(err);
		onDone(err);
	}
	var network = require('ocore/network.js');
	var composer = require('ocore/composer.js');
	createOptimalOutputs(function(arrOutputs) {
		let params = {
			paying_addresses: [my_address],
			outputs: arrOutputs,
			signer: headlessWallet.signer,
			callbacks: composer.getSavingCallbacks({
				ifNotEnoughFunds: onError,
				ifError: onError,
				ifOk: function(objJoint) {
					network.broadcastJoint(objJoint);
					onDone();
				}
			})
		};
		if (conf.bPostTimestamp)
			datafeed.timestamp = Date.now();
		let objMessage = {
			app: "data_feed",
			payload_location: "inline",
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		};
		params.messages = [objMessage];
		composer.composeJoint(params);
	});
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
			setTimeout(function() {
				postDataFeed(datafeed, onDataFeedResult);
			}, RETRY_TIMEOUT + Math.round(Math.random() * 3000));
		}
		else
			delete assocQueuedDataFeeds[feed_name];
	};
	postDataFeed(datafeed, onDataFeedResult);
}


function readExisting(feed_name, handleResult) {
	console.error("read existing: " + feed_name);
	if (assocQueuedDataFeeds[feed_name]) {
		return handleResult(true, 0, assocQueuedDataFeeds[feed_name]);
	}
	data_feeds.readDataFeedValue([my_address], feed_name, null, 0, 10000000000000, false, "abort", function(objResult){
		if (objResult.value === undefined)
			return handleResult(false);
		if (objResult.bAbortedBecauseOfSeveral)
			notifications.notifyAdmin('Multiple entries for feed', feed_name);
		storage.readLastMainChainIndex(function(last_mci){
			if (objResult.mci <= last_mci)
				return handleResult(true, true, objResult.value);
			else
				return handleResult(true, false, objResult.value);
		});
		
	})

}

function postDatafeedToAa(feedName, value, aa_address, callbacks){
	db.query("SELECT definition FROM aa_addresses WHERE address=?", [aa_address], function(rows){
		if (!rows[0]){
			commons.deleteAaHavingRequestedFixturesFromDB(aa_address);
			return callbacks.ifNotAa();
		}

		var trigger = { 
			outputs: {base: 10000}, 
			address: my_address,
			data: {}
		
		};
		trigger.data[feedName] = value;
		var paymentToMe = 0;
		aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, JSON.parse(rows[0].definition), function (arrResponses) {
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

			if (paymentToMe < conf.expectedPaymentFromAa)
				return callbacks.ifNotPayingAa();
				
			var network = require('ocore/network.js');
			var composer = require('ocore/composer.js');
			var params = {
				paying_addresses: [my_address],
				outputs: [{address: aa_address, amount: 10000},{address: my_address, amount:0}],
				signer: headlessWallet.signer,
				callbacks: composer.getSavingCallbacks({
					ifNotEnoughFunds: function(){
						console.log("payment failed cause not enough found");
						callbacks.ifError();
					},
					ifError: function(error){
						console.log("payment failed " + error);
						callbacks.ifError();
					},
					ifOk: function(objJoint) {
						network.broadcastJoint(objJoint);
						callbacks.ifSuccess();
					}
				})
			};

			var objMessage = {
				app: "data",
				payload_location: "inline",
				payload_hash: objectHash.getBase64Hash(trigger.data),
				payload: trigger.data
			};
			params.messages = [objMessage];
			composer.composeJoint(params);

		});
	});

}


eventBus.on('headless_wallet_ready', function() {

	headlessWallet.readSingleAddress(function(address) {
		my_address = address;
	});
});

exports.reliablyPost = reliablyPost;
exports.readExisting = readExisting;
exports.postDatafeedToAa = postDatafeedToAa;