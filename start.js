/*jslint node: true */
"use strict";
var moment = require('moment');
var request = require('request');
const async = require('async');
var conf = require('byteballcore/conf.js');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var headlessWallet = require('headless-byteball');
var desktopApp = require('byteballcore/desktop_app.js');
const notifications = require('./modules/notifications.js');
const commons = require('./modules/commons.js');
const calendar = require('./modules/calendar.js');
const datafeeds = require('./modules/datafeeds.js');
const mySportFeed = require('./modules/api_mysportfeed.js');
const UfcCom = require('./modules/api_ufc_com.js');
const footballDataOrg = require('./modules/api_footballdata_org.js');
const theScore = require('./modules/api_thescore.js');

var assocPeers = [];


//------The different feeds are added to the calendar
//------The 2 first arguments specify category and keyword
mySportFeed.getFixturesAndPushIntoCalendar('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2018-regular/');
mySportFeed.getFixturesAndPushIntoCalendar('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2018-playoff/');
mySportFeed.getFixturesAndPushIntoCalendar('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2018-playoff/');
UfcCom.getFixturesAndPushIntoCalendar('Mixed Martial Arts', 'UFC');

footballDataOrg.getAllChampionshipsAndPushIntoCalendar();


if (conf.bRunWitness)
	require('byteball-witness');

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
	instructions+= "\n------------------------------------------------------\nFor information about sports betting, please visit our wiki: https://wiki.byteball.org/Sports_betting"
	return instructions;
}

function getChampionshipInstructions(championshipName) {
	return "-----------------------------  " + championshipName + "  -----------------------------\n Actions: \n" + " - List " + commons.getTxtCommandButton("last") + " games played \n - List " + commons.getTxtCommandButton("coming") + " games \n" + " - Return " + commons.getTxtCommandButton("home") + "\n - Or write the team names in the format: 'team1 vs team2', partial names are also accepted";
}


function getFixturesAfterNow(championship) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var txtReturn = '12 next games coming: \n';
	var bufferAfter = [];
	for (var feedName in fixtures) {
		if (fixtures[feedName].date.isAfter(moment())) {
			bufferAfter.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
		}
	}
	if (bufferAfter.length == 0) {
		txtReturn = "No results found \n";
		return txtReturn;
	}
	txtReturn += bufferAfter.slice(0, 12).join('\n') + "\n";
	return txtReturn;
}

function getFixturesBeforeNow(championship) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var txtReturn = '12 last games played: \n';
	var bufferBefore = [];
	for (var feedName in fixtures) {
		if (fixtures[feedName].date.isBefore(moment())) {
			bufferBefore.push(commons.getTxtCommandButton(fixtures[feedName].homeTeam + ' vs ' + fixtures[feedName].awayTeam + " on " + fixtures[feedName].localDay.format("YYYY-MM-DD"), feedName) + "\n");
		}
	}
	if (bufferBefore.length == 0) {
		txtReturn = "No results found  \n";
		return txtReturn;
	}
	txtReturn += bufferBefore.slice(-12).join('\n') + "\n";
	return txtReturn;
}

function searchFixtures(championship, search) {
	var fixtures = calendar.getAllfixturesFromChampionship(championship);
	var splitText = search.split(/\sVS\s|\sVs\.\s|\svs\s|\sVS\.\s|\sV\.\s/);
	var buffer = [];
	if (splitText.length === 1) {
		for (var feedName in fixtures) {
			if (commons.removeAccents(fixtures[feedName].homeTeam).toUpperCase().indexOf(commons.removeAccents(search).toUpperCase()) > -1 || commons.removeAccents(fixtures[feedName].awayTeam).toUpperCase().indexOf(commons.removeAccents(search).toUpperCase()) > -1) {
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

	request({
		url: url,
		headers: resultHelper.headers
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			handle("Error, can't get info from data provider");
			return;
		}
		try {
			var parsedBody = JSON.parse(body);

		} catch (e) {
			notifications.notifyAdmin("Result for " + feedName + " can't be parsed", e + "\n" + body);
			return handle('Couldn t parse result, admin is notified');
		}

		resultHelper.process(parsedBody, feedName, function(err, result) {
			if (err) {
				notifications.notifyAdmin("There was an error getting result for " + feedName, "URL concerned: " + url + " error: " + err);
				db.query("UPDATE requested_fixtures SET has_critical_error=1 WHERE feed_name=?", [feedName]);
				return handle("Problem getting this result, admin is notified");
			}

			checkUsingSecondSource(championship, feedName, result.date, result.winnerCode, function(error, isOK) {

				if (error) {
					if (error.isCriticalError) {
						db.query("UPDATE requested_fixtures SET has_critical_error=1 WHERE feed_name=?", [feedName]);
					}
					return handle(error.msg);

				}

				if (isOK) {
					var datafeed = {};
					datafeed[feedName] = result.winnerCode;
					datafeeds.reliablyPost(datafeed);
					return handle(result.homeTeam + " vs " + result.awayTeam + "\n " + (result.localDay ? " on " + result.localDay.format("YYYY-MM-DD") : " ") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked");
				} else {
					deleteFromDB(feedName);
					notifications.notifyAdmin("Check failed for " + feedName, " ");
					return handle("Inconsistency found for result, admin is notified");

				}

			});

		});
	});


}

function getFeedStatus(from_address, feedName, handle) {
					
	var fixture = calendar.getFixtureFromFeedName(feedName);
	var resultHelper = calendar.getResultHelperFromFeedName(feedName);
	var championship = calendar.getChampionshipFromFeedName(feedName);
	
	function insertIntoAskedFixtures(){
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
					insertIntoAskedFixtures();
				}
				handle(getResponseForFeedAlreadyInDAG(fixture.homeTeam, fixture.awayTeam, fixture.date.format("YYYY-MM-DD HH:mm:ss"), value, is_stable));
			} else {
				insertIntoAskedFixtures();
				var device = require('byteballcore/device.js');
				device.sendMessageToDevice(from_address, 'text', "Result is being retrieved, please wait.");
				retrieveAndPostResult(fixture.urlResult, calendar.getChampionshipFromFeedName(feedName), feedName, resultHelper, function(txt) {
					handle(txt);
				});
			}
		});
	} else {
		insertIntoAskedFixtures();
		handle("To bet on this fixture, select the Sport Oracle and use the feedname below when you offer the contract to your peer: \n\n" + feedName + "\n\nThe value should be the team you expect as winner or 'draw': \n" + "Eg: " + fixture.feedName + " = " + fixture.feedName.split('_')[1] 
		+ "\n\nRules for " + championship + ": " + resultHelper.rules
		+ "\n\nResult is available "+ resultHelper.hoursToWaitBeforeGetResult +" hours after the fixture, you will be notified when the contract can be unlocked.\n\nFind more information about sport betting on our wiki: https://wiki.byteball.org/Sports_betting");
	}
}



function notifyForDatafeedPosted(feedName, value) {
	db.query(
		"SELECT device_address FROM devices_having_requested_fixture WHERE feed_name=?", [feedName],
		function(rows) {
			rows.forEach(
				function(row) {
					var device = require('byteballcore/device.js');
					device.sendMessageToDevice(row.device_address, 'text', "Sport oracle posted " + feedName + " = " + value);
				}
			)

			deleteFromDB(feedName);
		}
	);
}

function deleteFromDB(feedName){

	db.takeConnectionFromPool(function(conn) {
		var arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		conn.addQuery(arrQueries, "DELETE FROM requested_fixtures WHERE feed_name=?",[feedName]);
		conn.addQuery(arrQueries, "DELETE FROM devices_having_requested_fixture WHERE feed_name=?",[feedName]);
		conn.addQuery(arrQueries, "COMMIT");
		async.series(arrQueries, function() {
			conn.release();
		});
	});
	
}


setInterval(function() {
	db.query(
		"SELECT feed_name,result_url FROM requested_fixtures WHERE fixture_date < datetime('now', '-' || hours_to_wait ||' hours') AND has_critical_error=0",
		function(rows) {
			rows.forEach(
				function(row) {
					if (calendar.getFixtureFromFeedName(row.feed_name)) {
						datafeeds.readExisting(row.feed_name, function(exists) {
							if(!exists)
							retrieveAndPostResult(row.result_url, calendar.getChampionshipFromFeedName(row.feed_name), row.feed_name, calendar.getResultHelperFromFeedName(row.feed_name), function() {});
						});
					} else {
						notifications.notifyAdmin("Championship " + row.feed_name + " not in calendar anymore, can't get result", "");
						deleteFromDB(row.feed_name);
					}
				}
			)

		}
	);
},
1000 * 360);


eventBus.on('paired', function(from_address) {
	var device = require('byteballcore/device.js');
	device.sendMessageToDevice(from_address, 'text', getHomeInstructions());
});

eventBus.on('text', function(from_address, text) {
	var device = require('byteballcore/device.js');
	text = text.trim();
	let ucText = text.toUpperCase();
 
	if (!assocPeers[from_address]) {
		assocPeers[from_address] = {
			step: "home",
			cat: "none_yet",
		};
	}

	if (text == "home") {
		assocPeers[from_address].step = 'home';
	}

	if (text == "/JSON") {
		return device.sendMessageToDevice(from_address, 'text', calendar.getPublicCalendar());
	}

	if (text == "post" && headlessWallet.isControlAddress(from_address)) {
		assocPeers[from_address].step = 'waitingFeedname';
		return device.sendMessageToDevice(from_address, 'text', "Enter feedname or return " + commons.getTxtCommandButton("home"));
	}

	if (assocPeers[from_address].step == 'waitingFeedname' && headlessWallet.isControlAddress(from_address)) {
		datafeeds.readExisting(text, function(exists, is_stable, value) {
			if (exists) {
				assocPeers[from_address].step = 'home';
				return device.sendMessageToDevice(from_address, 'text', "This feedname was already posted with " + value + " as value");
			} else {
				assocPeers[from_address].step = 'waitingValue';
				assocPeers[from_address].feedNametoBePosted = text;
				return device.sendMessageToDevice(from_address, 'text', "Enter value for " + text + " or return " + commons.getTxtCommandButton("home"));
			}
		});
	}
	
	if (assocPeers[from_address].step == 'waitingValue' && headlessWallet.isControlAddress(from_address)) {
		var datafeed = {};
		datafeed[assocPeers[from_address].feedNametoBePosted] = text;
		reliablyPostDataFeed(datafeed);
		assocPeers[from_address].step = 'home';
		return device.sendMessageToDevice(from_address, 'text', "The feedname is being posted \n➡ " + commons.getTxtCommandButton("ok"));
	}
	
	if (assocPeers[from_address].step != 'waitingFeedname' && assocPeers[from_address].step != 'waitingValue') {
		
		if (calendar.isExistingChampionship(text)){
			assocPeers[from_address].step = text;
			assocPeers[from_address].cat = calendar.getCategoryFromChampionship(text);
			return device.sendMessageToDevice(from_address, 'text', getChampionshipInstructions(text));
		}


		if (calendar.getFixtureFromFeedName(text)) {
			getFeedStatus(from_address, text, function(response) {
				device.sendMessageToDevice(from_address, 'text', response);
			});
			return;
		}


		if (calendar.isExistingCategorie(assocPeers[from_address].cat) && assocPeers[from_address].step != 'home') {

			if (text == "last") {
				return device.sendMessageToDevice(from_address, 'text', getFixturesBeforeNow(assocPeers[from_address].step) + getChampionshipInstructions(assocPeers[from_address].step));
			}
			if (text == "coming") {
				return device.sendMessageToDevice(from_address, 'text', getFixturesAfterNow(assocPeers[from_address].step) + getChampionshipInstructions(assocPeers[from_address].step));
			}
			return device.sendMessageToDevice(from_address, 'text', "Search for '" + text + "' :\n" + searchFixtures(assocPeers[from_address].step, text) + getChampionshipInstructions(assocPeers[from_address].step));
		}

		return device.sendMessageToDevice(from_address, 'text', getHomeInstructions());
	}
});



function getResponseForFeedAlreadyInDAG(homeTeamName, awayTeamName, date, result, is_stable) {
	return homeTeamName + ' vs ' + awayTeamName + '\n' +
		'on ' + moment.utc(date).format("DD MMMM YYYY") + '\n' +
		(result === 'draw' ? 'draw' : result + ' won') +
		(is_stable ?
			"\n\nThe data is already in the database, you can unlock your smart contract now." :
			"\n\nThe data will be added into the database, I'll let you know when it is confirmed and you are able to unlock your contract.");
}



function checkUsingSecondSource(championship, feedName, UTCdate, result, handle) {

	if (theScore.canCheckChampionship) {

		theScore.checkResult(championship, feedName, UTCdate, result, function(error, isOK) {
			return handle(error, isOK);
		});

	} else {
		return handle(null, true);
	}

}



eventBus.on('my_transactions_became_stable', function(arrUnits) {

	db.query("SELECT feed_name,value FROM data_feeds WHERE unit IN(?)", [arrUnits], function(rows) {
		rows.forEach(row => {
			notifyForDatafeedPosted(row.feed_name, row.value);
		});
	});

});


//////

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

});
