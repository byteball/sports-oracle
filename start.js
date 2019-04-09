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

var assocPeers = [];

setTimeout(loadChampionships,500);

function loadChampionships(){
	//------The different feeds are added to the calendar
	//------The 2 first arguments specify category and keyword
	mySportFeed.getFixturesAndPushIntoCalendar('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2019-regular/');
	//mySportFeed.getFixturesAndPushIntoCalendar('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2019-playoff/');
	mySportFeed.getFixturesAndPushIntoCalendar('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2018-regular/');
	mySportFeed.getFixturesAndPushIntoCalendar('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2019-playoff/');

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


function retrieveAndPostResult(url, championship, feedName, resultHelper, handle) {

	if (!resultHelper || !championship)
		return handle("Internal error, please retry later");
	
	function setHasCriticalError(){
		db.query("UPDATE requested_fixtures SET has_critical_error=1 WHERE feed_name=?", [feedName]);
	}
	
	request({
		url: url,
		headers: resultHelper.headers
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			handle("Error, can't get info from data provider. Please try later.");
			return;
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
				ifPostponed: () => {
					commons.deleteFromDB(feedName);
					return handle("This result has been postponed.");
				},
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
					return handle(result.homeTeam + " vs " + result.awayTeam + "\n " + (result.localDay ? " on " + result.localDay.format("YYYY-MM-DD") : " ") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked");
				}
			});

		});
	});


}

function getFeedStatus(from_address, feedName, handle) {
					
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
				handle(getResponseForFeedAlreadyInDAG(fixture, value, is_stable));
			} else {
				insertIntoRequestedFixtures();
				var device = require('ocore/device.js');
				device.sendMessageToDevice(from_address, 'text', "Result is being retrieved, please wait.");
				retrieveAndPostResult(fixture.urlResult, championship, feedName, resultHelper, function(txt) {
					handle(txt);
				});
			}
		});
	} else {
		insertIntoRequestedFixtures();
		handle("To bet on this fixture, select the Sport Oracle and use the feedname below when you offer the contract to your peer: \n\n" + feedName + "\n\nThe value should be the team you expect as winner or 'draw': \n" + "Eg: " + fixture.feedName + " = " + fixture.feedName.split('_')[1] 
		+ "\n\nRules for " + championship + ": " + resultHelper.rules
		+ "\n\nResult is available "+ resultHelper.hoursToWaitBeforeGetResult +" hours after the fixture, you will be notified when the contract can be unlocked.\n\nFind more information about sport betting on our wiki: https://wiki.obyte.org/Sports_betting");
	}
}



function notifyForDatafeedPosted(feedName, value) {
	db.query(
		"SELECT device_address FROM devices_having_requested_fixture WHERE feed_name=?", [feedName],
		function(rows) {
			rows.forEach(
				function(row) {
					var device = require('ocore/device.js');
					device.sendMessageToDevice(row.device_address, 'text', "Sport oracle posted " + feedName + " = " + value);
				}
			)

			commons.deleteFromDB(feedName);
		}
	);
}




function findFixturesToCheckAndGetResult() {

	db.query(
		"SELECT feed_name,result_url,(strftime('%s','now') - strftime('%s',fixture_date) - hours_to_wait * 3600) AS time_from_first_check FROM requested_fixtures WHERE  \n\
		(fixture_date < datetime('now', '-' || hours_to_wait ||' hours') AND has_critical_error=0) \n\
		OR \n\
		(time_from_first_check/3600.0*12.0 LIKE '%.0%' AND has_critical_error=1)", //try to recheck every 12 hours fixtures having critical errors
		function(rows) {
			rows.forEach(
				function(row) {
					if (calendar.isThereChampionshipReloading())
						return;
					if (calendar.getFixtureFromFeedName(row.feed_name)) {
						datafeeds.readExisting(row.feed_name, function(exists) {
							if(!exists)
							retrieveAndPostResult(row.result_url, calendar.getChampionshipFromFeedName(row.feed_name), row.feed_name, calendar.getResultHelperFromFeedName(row.feed_name), function() {});
						});
					} else {
						notifications.notifyAdmin("Championship " + row.feed_name + " not in calendar anymore, can't get result", "");
						commons.deleteFromDB(row.feed_name);
					}
				}
			)

		}
	);
}



eventBus.on('paired', function(from_address) {
	var device = require('ocore/device.js');
	device.sendMessageToDevice(from_address, 'text', getHomeInstructions());
});

eventBus.on('text', function(from_address, text) {
	var device = require('ocore/device.js');
	text = text.trim();
	let ucText = text.toUpperCase();
 
	if (!assocPeers[from_address]) {
		assocPeers[from_address] = {
			step: "home",
		};
	}
	
/*
* if return home
*/
	if (text == "home") {
		assocPeers[from_address].step = 'home';
	}

/*
* if JSON calendar requested
*/	
	if (text == "/JSON") {
		return device.sendMessageToDevice(from_address, 'text', calendar.getPublicCalendar());
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
* if fixture requested
*/
	if (calendar.getFixtureFromFeedName(text)) {
		getFeedStatus(from_address, text, function(response) {
			device.sendMessageToDevice(from_address, 'text', response);
		});
		return;
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



function getResponseForFeedAlreadyInDAG(fixture, result, is_stable) {
	return fixture.homeTeamName + ' vs ' + fixture.awayTeamName + '\n' +
		'on ' + fixture.localDay.format("DD MMMM YYYY") + '\n' +
		(result === 'draw' ? 'draw' : result + ' won') +
		(is_stable ?
			"\n\nThe data is already in the database, you can unlock your smart contract now." :
			"\n\nThe data will be added into the database, I'll let you know when it is confirmed and you are able to unlock your contract.");
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
setInterval(findFixturesToCheckAndGetResult, 1000 * 3600);

});
