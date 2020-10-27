/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const async = require('async');
const conf = require('ocore/conf.js');
const db = require('ocore/db.js');
const eventBus = require('ocore/event_bus.js');
const headlessWallet = require('headless-obyte');
const desktopApp = require('ocore/desktop_app.js');
const notifications = require('./modules/notifications.js');
const commons = require('./modules/commons.js');
const calendar = require('./modules/calendar.js');
const datafeeds = require('./modules/datafeeds.js');
const administration = require('./modules/administration.js');
const mySportFeed = require('./modules/api_mysportfeed.js');
const footballDataOrg = require('./modules/api_footballdata_org.js');
const theScore = require('./modules/api_thescore.js');
const validationUtils = require('ocore/validation_utils.js');
require('./modules/aa_watcher.js');

var assocPeers = [];

setTimeout(loadChampionships,500);

function loadChampionships(){
	//------The different feeds are added to the calendar
	//------The 2 first arguments specify category and keyword
	mySportFeed.getFixturesAndPushIntoCalendar('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2020-regular/');
	mySportFeed.getFixturesAndPushIntoCalendar('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2020-regular/');
	mySportFeed.getFixturesAndPushIntoCalendar('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2020-playoff/');
	//mySportFeed.getFixturesAndPushIntoCalendar('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2019-regular/');

	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','CL', 'https://api.football-data.org/v2/competitions/2001/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','BL1', 'https://api.football-data.org/v2/competitions/2002/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','DED', 'https://api.football-data.org/v2/competitions/2003/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','BSA', 'https://api.football-data.org/v2/competitions/2013/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','PD', 'https://api.football-data.org/v2/competitions/2014/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','L1', 'https://api.football-data.org/v2/competitions/2015/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','SA', 'https://api.football-data.org/v2/competitions/2019/matches');
	footballDataOrg.getFixturesAndPushIntoCalendar('Soccer','PL', 'https://api.football-data.org/v2/competitions/2021/matches');
}

if (conf.bRunWitness)
	require('obyte-witness');

if (!conf.bSingleAddress)
	throw Error('oracle must be single address');

if (!conf.bRunWitness)
	headlessWallet.setupChatEventHandlers();

function getHomeInstructions() {
	var instructions = "Please choose a championship:\n";

	if (calendar.getAllCategories().length === 0)
		instructions = "Sorry, no championship available.";

	calendar.getAllCategories().forEach(function(cat) {
		instructions += '\n---' + cat + '---\n';
		calendar.getAllChampionshipsFromCategory(cat).forEach(function(championship){
			instructions += commons.getTxtCommandButton(championship) + ' ';
		});
	});

	instructions+= "\n------------------------------------------------------\nFor information about sports betting, please visit our wiki: https://wiki.obyte.org/Sports_betting"
	return instructions;
}

function getChampionshipInstructions(championshipName) {
	return "-----------------------------  " + championshipName + "  -----------------------------\n Actions: \n" + " - List " + commons.getTxtCommandButton("last") + " games played \n - List " + commons.getTxtCommandButton("coming") + " games \n" + " - Return " + commons.getTxtCommandButton("home") + "\n - Or write the team names in the format: 'team1 vs team2', partial names are also accepted";
}


function getFixturesAfterNow(championship) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var txtReturn = '12 next games coming: \n';
	var buffer = [];
	for (var feedName in fixtures) {
		if (fixtures[feedName].date.isAfter(moment())) {
			buffer.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
		}
	}
	if (buffer.length == 0) {
		txtReturn = "No results found \n";
		return txtReturn;
	}
	txtReturn += buffer.slice(0, 12).join('\n') + "\n";
	return txtReturn;
}

function getFixturesBeforeNow(championship) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var txtReturn = '12 last games played: \n';
	var buffer = [];
	for (var feedName in fixtures) {
		if (fixtures[feedName].date.isBefore(moment())) {
			buffer.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
		}
	}
	if (buffer.length == 0) {
		txtReturn = "No results found  \n";
		return txtReturn;
	}
	txtReturn += buffer.slice(-12).join('\n') + "\n";
	return txtReturn;
}

function searchFixtures(championship, searchedString) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var splitText = searchedString.split(/\sVS\s|\sVs\.\s|\svs\s|\sVS\.\s|\sV\.\s/);
	var buffer = [];
	if (splitText.length === 1) {
		for (var feedName in fixtures) {
			if (commons.removeAccents(fixtures[feedName].homeTeam).toUpperCase().indexOf(commons.removeAccents(searchedString).toUpperCase()) > -1 || commons.removeAccents(fixtures[feedName].awayTeam).toUpperCase().indexOf(commons.removeAccents(searchedString).toUpperCase()) > -1) {
				buffer.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
			}
		}
	} else if (splitText.length === 2) {
		var team1Name = splitText[0].replace(/\s/g, '');
		var team2Name = splitText[1].replace(/\s/g, '');
		for (var feedName in fixtures) {
			if ((commons.removeAccents(fixtures[feedName].homeTeam).replace(/\s/g, '').toUpperCase().indexOf(commons.removeAccents(team1Name).toUpperCase()) > -1 && commons.removeAccents(fixtures[feedName].awayTeam).replace(/\s/g, '').toUpperCase().indexOf(commons.removeAccents(team2Name).toUpperCase()) > -1) ||
				(commons.removeAccents(fixtures[feedName].homeTeam).replace(/\s/g, '').toUpperCase().indexOf(commons.removeAccents(team2Name).toUpperCase()) > -1 && commons.removeAccents(fixtures[feedName].awayTeam).replace(/\s/g, '').toUpperCase().indexOf(commons.removeAccents(team1Name).toUpperCase()) > -1)) {
				buffer.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
			}
		}

	} else {
		return "Incorrect request \n";
	}

	if (buffer.length == 0) {
		return "No results found  \n";
	}
	return buffer.join('\n') + "\n";
}


function retrieveAndPostResultToDag(fixture_date, url, championship, feedName, resultHelper, handle) {
	if (!resultHelper || !championship)
		return handle("Internal error, please retry later");
	
	function setHasCriticalError(){
		db.query("UPDATE requested_fixtures SET has_critical_error=1 WHERE feed_name=?", [feedName]);
	}
	
	request({
		url: url,
		headers: resultHelper.headers
	}, function(error, response, body) {
		if (error || (response.statusCode !== 200 && response.statusCode !== 204)) {
			handle("Error, can't get info from data provider. Please try later.");
			return;
		}

		if (response.statusCode == 204) { // the score API will return an error 204 if a match hasn't been played yet, we check with second source that it has actually been canceled
			return checkUsingSecondSource(championship, feedName, fixture_date, 'canceled', {
				ifCriticalError: () => {
					setHasCriticalError();
					return handle("I couldn't check the result with a second source of data, admin is notified.");
				},
				ifError: () => {
					return handle("I couldn't check the result with a second source of data, please try later");
				},
				ifFailedCheck: () => {
					return handle("Inconsistency found for result, admin is notified.");
				},
				ifOK: () => {
					var datafeed = {};
					datafeed[feedName] = 'canceled';
					datafeeds.reliablyPost(datafeed);
					return handle(feedName + "=canceled \n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked."
					+ "\nYou can also request to "+ commons.getTxtCommandButton('trigger an autonomous agent',feedName + " trigger" )+" with this result.", 'canceled');
				}
			});
		}


		try {
			var parsedBody = JSON.parse(body);

		} catch (e) {
			notifications.notifyAdmin("Result for " + feedName + " can't be parsed", e + "\n" + body);
			return handle('Couldn t parse result, admin is notified');
		}

		resultHelper.process(parsedBody, feedName, function(errMainSource, result) {
			if (errMainSource) {
				notifications.notifyAdmin("There was an error getting result for " + feedName, "URL concerned: " + url + " error: " + errMainSource);
				setHasCriticalError();
				return handle("Problem getting this result, admin is notified");
			}

			checkUsingSecondSource(championship, feedName, result.date, result.winnerCode, {
				ifCriticalError: () => {
					setHasCriticalError();
					return handle("I couldn't check the result with a second source of data, admin is notified.");
				},
				ifError: () => {
					return handle("I couldn't check the result with a second source of data, please try later");
				},
				ifFailedCheck: () => {
					return handle("Inconsistency found for result, admin is notified.");
				},
				ifOK: () => {
					var datafeed = {};
					datafeed[feedName] = result.winnerCode;
					datafeeds.reliablyPost(datafeed);
					return handle(result.homeTeam + " vs " + result.awayTeam + "\n " + (result.localDay ? " on " + result.localDay.format("YYYY-MM-DD") : " ") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked."
					+ "\nYou can also request to "+ commons.getTxtCommandButton('trigger an autonomous agent',feedName + " trigger" )+" with this result.", result.winnerCode);
				}
			});

		});
	});


}

function treatRequestForAaPosting(from_address, feedName, aa_address, handle){
	var fixture = calendar.getFixtureFromFeedName(feedName);
	var resultHelper = calendar.getResultHelperFromFeedName(feedName);
	var championship = calendar.getChampionshipFromFeedName(feedName);
	
	if (!fixture || !resultHelper || !championship)
		return handle("Internal error, please retry later");
	
	function insertIntoRequestedFixturesForAa(){
		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN");
			conn.addQuery(arrQueries, "INSERT OR IGNORE INTO requested_fixtures ( feed_name, fixture_date, result_url, hours_to_wait) VALUES (?,?,?,?) ",[feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"),fixture.urlResult,resultHelper.hoursToWaitBeforeGetResult]);
			conn.addQuery(arrQueries, "INSERT OR IGNORE INTO aas_having_requested_fixture (device_address, feed_name, aa_address) VALUES (?,?,?)",[from_address, feedName, aa_address]);
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
			});
		});
	}

	if (fixture.date.isBefore(moment().subtract(resultHelper.hoursToWaitBeforeGetResult, 'hours'))) {
		datafeeds.readExisting(feedName, function(exists, is_stable, value) {

			if (exists) {
				datafeeds.postDatafeedToAa(feedName, value, aa_address,  getDatafeedPostingToAaCallbacks([from_address], aa_address, feedName, value));
				handle();
			} else {
				insertIntoRequestedFixturesForAa();
				var device = require('ocore/device.js');
				device.sendMessageToDevice(from_address, 'text', "Result is being retrieved, please wait.");
				retrieveAndPostResultToDag(fixture.date, fixture.urlResult, championship, feedName, resultHelper, function(txt, value) {
					if (value)
						datafeeds.postDatafeedToAa(feedName, value, aa_address,  getDatafeedPostingToAaCallbacks([from_address], aa_address, feedName, value));
					handle();
				});
			}
		});
	} else {
		insertIntoRequestedFixturesForAa();
		handle(`I will trigger your autonomous agent ${aa_address} as soon as result is available`);
	}

}


function treatRequestForDagPosting(from_address, feedName, handle) {

	var fixture = calendar.getFixtureFromFeedName(feedName);
	var resultHelper = calendar.getResultHelperFromFeedName(feedName);
	var championship = calendar.getChampionshipFromFeedName(feedName);
	
	if (!fixture || !resultHelper || !championship)
		return handle("Internal error, please retry later");
	
	function insertIntoRequestedFixtures(){
		db.takeConnectionFromPool(function(conn) {
			var arrQueries = [];
			conn.addQuery(arrQueries, "BEGIN");
			conn.addQuery(arrQueries, "INSERT OR IGNORE INTO requested_fixtures ( feed_name, fixture_date, result_url, hours_to_wait) VALUES (?,?,?,?) ",[feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"),fixture.urlResult,resultHelper.hoursToWaitBeforeGetResult]);
			conn.addQuery(arrQueries, "INSERT OR IGNORE INTO devices_having_requested_fixture (device_address, feed_name) VALUES (?,?)",[from_address, feedName]);
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, function() {
				conn.release();
			});
		});
	}

	if (fixture.date.isBefore(moment().subtract(resultHelper.hoursToWaitBeforeGetResult, 'hours'))) {
		datafeeds.readExisting(feedName, function(exists, is_stable, value) {

			if (exists) {
				if (!is_stable) {
					insertIntoRequestedFixtures();
				}
				handle(getResponseForFeedAlreadyInDAG(fixture, value, is_stable, feedName));
			} else {
				insertIntoRequestedFixtures();
				var device = require('ocore/device.js');
				device.sendMessageToDevice(from_address, 'text', "Result is being retrieved, please wait.");
				retrieveAndPostResultToDag(fixture.date, fixture.urlResult, championship, feedName, resultHelper, function(txt) {
					handle(txt);
				});
			}
		});
	} else {
		insertIntoRequestedFixtures();
		handle("To bet on this fixture, select the Sport Oracle and use the feedname below when you offer the contract to your peer: \n\n" + feedName + "\n\nThe value should be the team you expect as winner or 'draw': \n" + "Eg: " + fixture.feedName + " = " + fixture.feedName.split('_')[1] 
		+ "\n\nRules for " + championship + ": " + resultHelper.rules
		+ "\n\nResult is available "+ resultHelper.hoursToWaitBeforeGetResult +" hours after the fixture, you will be notified when the contract can be unlocked.\n\nFind more information about sport betting on our wiki: https://wiki.obyte.org/Sports_betting "
		+	"\n\nYou can also request to "+ commons.getTxtCommandButton('trigger an autonomous agent',feedName + " trigger" )+" with this result.");
	}
}

function getDatafeedPostingToAaCallbacks(device_addresses, aa_address, feedName, value){

	function notifyDevices(message){
		var device = require('ocore/device.js');
		device_addresses.forEach(function (device_address){
			device.sendMessageToDevice(device_address, 'text', message);
		})
	}

	return {
		ifNotAa: function(){
			notifyDevices(`${aa_address} is not an autonomous agent address, I couldn't trigger it with result for ${feedName}.`);
			return commons.deleteAaHavingRequestedFixturesFromDB(feedName, aa_address);
		},
		ifNotPayingAa: function(){
			notifyDevices(`${aa_address} doesn't refund at least ${conf.expectedPaymentFromAa} bytes to oracle.`);
			return commons.deleteAaHavingRequestedFixturesFromDB(feedName, aa_address);
		},
		ifError: function() {
			return notifyDevices(`Internal error, couldn't trigger your AA. I will retry later.`);
		},
		ifSuccess: function() {
			notifyDevices(`I triggered your AA ${aa_address} with ${feedName} = ${value}`);
			return commons.deleteAaHavingRequestedFixturesFromDB(feedName, aa_address);
		},
		ifAlreadyTriggered: function() {
			notifyDevices(`AA ${aa_address} was already triggered with ${feedName} = ${value}`);
			return commons.deleteAaHavingRequestedFixturesFromDB(feedName, aa_address);
		}
	}
}

function postResultToAas(feedName, value, callbacks){

	db.query("SELECT DISTINCT feed_name, aa_address FROM aas_having_requested_fixture WHERE feed_name=?", [feedName], function(rows){
		if (rows.length == 0)
			return callbacks.noAaRequestLeft();
		rows.forEach(function(row){
			db.query("SELECT DISTINCT device_address FROM aas_having_requested_fixture WHERE feed_name=? AND aa_address=?", [feedName, row.aa_address], function(device_addresses){
				datafeeds.postDatafeedToAa(feedName, value, row.aa_address,  getDatafeedPostingToAaCallbacks(device_addresses.map(function(address){return address.device_address}), row.aa_address, feedName,value));
			});
		})
		return callbacks.processingAaRequests();
	});
}



function notifyForDatafeedPosted(feedName, value) {
	db.query(
		"SELECT device_address FROM devices_having_requested_fixture WHERE feed_name=?", [feedName],
		function(rows) {
			rows.forEach(
				function(row) {
					var device = require('ocore/device.js');
					device.sendMessageToDevice(row.device_address, 'text', "Sport oracle posted " + feedName + " = " + value);
					commons.deleteDevicesHavingRequestedFixturesFromDB(feedName, row.device_address);
				}
			)

		}
	);
}




function findFixturesToCheckAndGetResult() {

	db.query(
		"SELECT fixture_date,feed_name,result_url,(strftime('%s','now') - strftime('%s',fixture_date) - hours_to_wait * 3600) AS time_from_first_check FROM requested_fixtures \n\
		WHERE (fixture_date < datetime('now', '-' || hours_to_wait ||' hours') AND has_critical_error=0) \n\
		OR \n\
		(time_from_first_check/(3600.0*12.0) LIKE '%.0%' AND has_critical_error=1)", //try to recheck every 12 hours fixtures having critical errors
		function(rows) {
			rows.forEach(
				function(row) {
					if (calendar.isThereChampionshipReloading())
						return;
					const postToAaCallbacks = {
						noAaRequestLeft: function(){commons.deleteRequestedFixture(row.feed_name)},
						processingAaRequests: function(){}
					}
					datafeeds.readExisting(row.feed_name, function(exists, is_stable, existing_value) {
						if(!exists)
							retrieveAndPostResultToDag(moment.utc(row.fixture_date), row.result_url, calendar.getChampionshipFromFeedName(row.feed_name), row.feed_name, calendar.getResultHelperFromFeedName(row.feed_name), function(text, retrieved_value) {
								if (retrieved_value){
									postResultToAas(row.feed_name, retrieved_value, postToAaCallbacks);
								}
							});
						if (existing_value)
							postResultToAas(row.feed_name, existing_value, postToAaCallbacks);
					});
				}
			)

		}
	);
}



eventBus.on('paired', function(from_address) {
	var device = require('ocore/device.js');
	device.sendMessageToDevice(from_address, 'text', getHomeInstructions());
});


eventBus.on('object', function(from_address,  object) {

	if (!object.time_limit || typeof object.time_limit != 'number' || object.time_limit  < new Date() / 1000)
		return;

	if (object.action == "get_calendar"){
		var device = require('ocore/device.js');
		return device.sendMessageToDevice(from_address, 'object', calendar.getPublicCalendar());
	}

});


eventBus.on('text', function(from_address, text) {
	var device = require('ocore/device.js');
	text = text.trim();
 
	if (!assocPeers[from_address]) {
		assocPeers[from_address] = {
			step: "home",
		};
	}
	
/*
* if return home
*/
	if (text == "home" || text == "cancel") {
		assocPeers[from_address].step = 'home';
	}

/*
* if JSON calendar requested - being deprecated use 'object'-'get_calendar' event instead
*/	
	if (text == "/JSON") {
		return device.sendMessageToDevice(from_address, 'text', JSON.stringify(calendar.getPublicCalendar()));
	}

/*
* if device is admin
*/	
	if (headlessWallet.isControlAddress(from_address)){
		if (administration.processCmd(from_address, assocPeers, text))
			return;
	 }

/*
* if championship requested
*/
	if (calendar.isExistingChampionship(text)){
		assocPeers[from_address].step = "searchingFixture";
		assocPeers[from_address].championship = text;
		return device.sendMessageToDevice(from_address, 'text', getChampionshipInstructions(text));
	}

/*
* if fixture requested for AA
*/
	if (text.split(' ').length == 2){
		var feedName = text.split(' ')[0];
		var aa_address = text.split(' ')[1];

		if (calendar.getFixtureFromFeedName(feedName) && validationUtils.isValidAddress(aa_address)) {
			treatRequestForAaPosting(from_address, feedName, aa_address, function(response){
				device.sendMessageToDevice(from_address, 'text', response);
			});
			return;
		}
		if (calendar.getFixtureFromFeedName(feedName) && aa_address == 'trigger') {
			assocPeers[from_address].feedName = feedName;
			assocPeers[from_address].step = 'request_aa_address';
			return device.sendMessageToDevice(from_address, 'text', `Enter the autonomous agent you want to trigger with result for ${feedName} or ${commons.getTxtCommandButton('cancel')}`);
		}
	}


/*
* if fixture requested
*/
	if (calendar.getFixtureFromFeedName(text)) {
		treatRequestForDagPosting(from_address, text, function(response) {
			device.sendMessageToDevice(from_address, 'text', response);
		});
		return;
	}

	if (assocPeers[from_address].step == "request_aa_address") {
		if (validationUtils.isValidAddress(text)){
			return treatRequestForAaPosting(from_address, assocPeers[from_address].feedName, text, function(response){
				assocPeers[from_address].step = 'home';
				device.sendMessageToDevice(from_address, 'text', response);
			});
		}
		return device.sendMessageToDevice(from_address, 'text', `Not a valid address, try again or ${feedName} or ${commons.getTxtCommandButton('cancel')}`);
	}


/*
* if searching into championship
*/
	if (assocPeers[from_address].step == "searchingFixture") {

		if (text == "last") {
			return device.sendMessageToDevice(from_address, 'text', getFixturesBeforeNow(assocPeers[from_address].championship) + getChampionshipInstructions(assocPeers[from_address].championship));
		}
		if (text == "coming") {
			return device.sendMessageToDevice(from_address, 'text', getFixturesAfterNow(assocPeers[from_address].championship) + getChampionshipInstructions(assocPeers[from_address].championship));
		}
		return device.sendMessageToDevice(from_address, 'text', "Search for '" + text + "' :\n" + searchFixtures(assocPeers[from_address].championship, text) + getChampionshipInstructions(assocPeers[from_address].championship));
	}

	return device.sendMessageToDevice(from_address, 'text', getHomeInstructions());

});



function getResponseForFeedAlreadyInDAG(fixture, result, is_stable, feedName) {
	return fixture.homeTeam + ' vs ' + fixture.awayTeam + '\n' +
		'on ' + fixture.localDay.format("DD MMMM YYYY") + '\n' +
		(result === 'draw' ? 'draw' : result + ' won') +
		(is_stable ?
			"\n\nThe data is already in the database, you can unlock your smart contract now." +
			"You can also request to "+ commons.getTxtCommandButton('trigger an autonomous agent',feedName + " trigger" )+" with this result.":
			"\n\nThe data will be added into the database, I'll let you know when it is confirmed and you are able to unlock your contract." +
			"You can also request to "+ commons.getTxtCommandButton('trigger an autonomous agent',feedName + " trigger" )+" with this result.");
}


function checkUsingSecondSource(championship, feedName, UTCdate, result, callbacks) {

	if (theScore.canCheckChampionship(championship)) 
		return theScore.checkResult(championship, feedName, UTCdate, result, callbacks);
	return callbacks.ifOK();
}



eventBus.on('my_transactions_became_stable', function(arrUnits) {

	db.query("SELECT feed_name,value FROM data_feeds WHERE unit IN(?)", [arrUnits], function(rows) {
		rows.forEach(row => {
			notifyForDatafeedPosted(row.feed_name, row.value);
		});
	});

});



eventBus.on('headless_wallet_ready', function() {
	if (!conf.admin_email || !conf.from_email) {
		console.log("please specify admin_email and from_email in your " + desktopApp.getAppDataDir() + '/conf.json');
		process.exit(1);
	}
	if (!conf.footballDataApiKey) {
		console.log("please specify footballDataApiKey in your " + desktopApp.getAppDataDir() + '/conf.json');
		process.exit(1);
	}
	if (!conf.MySportsFeedsUser || !conf.MySportsFeedsPw) {
		console.log("please specify MySportsFeeds credentials in your " + desktopApp.getAppDataDir() + '/conf.json');
		process.exit(1);
	}

	setTimeout(findFixturesToCheckAndGetResult, 1000 * 10); //wait that the calendar is intitialized
	setInterval(findFixturesToCheckAndGetResult, 1000 * 900);

});
