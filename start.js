/*jslint node: true */
"use strict";
var moment = require('moment');
var request = require('request');
var conf = require('byteballcore/conf.js');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var headlessWallet = require('headless-byteball');
var desktopApp = require('byteballcore/desktop_app.js');
var objectHash = require('byteballcore/object_hash.js');
var notifications = require('./notifications.js');
var fs = require("fs");
const commons = require('./modules/commons.js');
const calendar = require('./modules/calendar.js');
const mySportFeed = require('./modules/api_mysportfeed.js');
const UfcCom = require('./modules/api_ufc_com.js');
var assocPeers = [];
var FootballDataOrgBlacklist=[466];
var reloadInterval = 1000*3600*24;


//------The different feeds are added to the calendar
//------The 2 first arguments specify category and keyword
mySportFeed.getFixturesAndPushIntoCalendar('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2018-regular/');
mySportFeed.getFixturesAndPushIntoCalendar('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2018-playoff/');
//initMySportsFeedsCom('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2018-playoff/');
mySportFeed.getFixturesAndPushIntoCalendar('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2018-playoff/');
UfcCom.getFixturesAndPushIntoCalendar('Mixed Martial Arts', 'UFC');

//------for soccer we fetch championships available
getCurrentChampionshipsFromFootballDataOrg(FootballDataOrgBlacklist,function(arrCurrentChampionShips) {
	arrCurrentChampionShips.forEach(function(currentChampionShip) {
		initFootballDataOrg(currentChampionShip.category, currentChampionShip.keyword, currentChampionShip.url);
	});
});

var soccerTeamsCorrespondence = {}
fs.readFile('./soccerTeamsCorrespondence.json', (err, content) => {
	if (err)
		throw Error("Could'nt read soccerTeamsCorrespondence.json");
	soccerTeamsCorrespondence= JSON.parse(content);
});

if (conf.bRunWitness)
	require('byteball-witness');

const RETRY_TIMEOUT = 5 * 60 * 1000;
var assocQueuedDataFeeds = {};

const WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var count_witnessings_available = 0;

if (!conf.bSingleAddress)
	throw Error('oracle must be single address');

if (!conf.bRunWitness)
	headlessWallet.setupChatEventHandlers();

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
	var network = require('byteballcore/network.js');
	var composer = require('byteballcore/composer.js');
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

function reliablyPostDataFeed(datafeed) {
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


function readExistingData(feed_name, handleResult) {
	if (assocQueuedDataFeeds[feed_name]) {
		return handleResult(true, 0, assocQueuedDataFeeds[feed_name]);
	}
	db.query(
		"SELECT feed_name, is_stable, value \n\
		FROM data_feeds CROSS JOIN unit_authors USING(unit) CROSS JOIN units USING(unit) \n\
		WHERE address=? AND feed_name=?", [my_address, feed_name],
		function(rows) {
			if (rows.length === 0)
				return handleResult(false);
			if (rows.length > 1)
				notifications.notifyAdmin(rows.length + ' entries for feed', feed_name);
			return handleResult(true, rows[0].is_stable, rows[0].value);
		}
	);
}

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
				db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [feedName]);
				return handle("Problem getting this result, admin is notified");
			}

			checkUsingSecondSource(championship, feedName, result.date, result.winnerCode, function(error, isOK) {

				if (error) {
					if (error.isCriticalError) {
						db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [feedName]);
					}
					return handle(error.msg);

				}

				if (isOK) {
					var datafeed = {};
					datafeed[feedName] = result.winnerCode;
					reliablyPostDataFeed(datafeed);
					return handle(result.homeTeam + " vs " + result.awayTeam + "\n " + (result.localDay ? " on " + result.localDay.format("YYYY-MM-DD") : " ") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked");
				} else {
					db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [feedName]);
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
		db.query("INSERT INTO asked_fixtures (device_address, feed_name, fixture_date, status, result_url, cat, championship, hours_to_wait) VALUES (?,?,?,?,?,?,?,?)", [from_address, feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"), 'new', fixture.urlResult, calendar.getCategoryFromFeedName(feedName), championship, resultHelper.hoursToWaitBeforeGetResult]);
	}

	if (fixture.date.isBefore(moment().subtract(resultHelper.hoursToWaitBeforeGetResult, 'hours'))) {
		readExistingData(feedName, function(exists, is_stable, value) {

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



function notifyForDatafeedPosted(feed_name, value) {
	db.query(
		"SELECT * FROM asked_fixtures WHERE feed_name=?  GROUP BY device_address", [feed_name],
		function(rows) {
			rows.forEach(
				function(row) {
					var device = require('byteballcore/device.js');
					device.sendMessageToDevice(row.device_address, 'text', "Sport oracle posted " + feed_name + " = " + value);
				}
			)

			db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [feed_name]);
		}
	);
}


setInterval(function() {
	db.query(
		"SELECT DISTINCT feed_name, result_url, cat, championship FROM asked_fixtures WHERE fixture_date < datetime('now', '-' || hours_to_wait ||' hours') GROUP BY feed_name",
		function(rows) {
			rows.forEach(
				function(row) {
					if (calendar.getFixtureFromFeedName(row.feed_name)) {
						readExistingData(row.feed_name, function(exists) {
							if(!exists)
							retrieveAndPostResult(row.result_url, row.championship, row.feed_name, calendar.getResultHelperFromFeedName(row.feed_name), function() {});
						});
					} else {
						notifications.notifyAdmin("Championship " + row.feed_name + " not in calendar anymore, can't get result", "");
						db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [row.feed_name]);
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
		readExistingData(text, function(exists, is_stable, value) {
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

function getCurrentChampionshipsFromFootballDataOrg(blacklist, handle) {
	var arrCompetitions = [];
	request({
		url: 'https://api.football-data.org/v1/competitions',
		headers: {
			'X-Auth-Token': conf.footballDataApiKey
		}
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			throw Error('couldn t get current championships from footballDataOrg');
		}

		var competitions = JSON.parse(body);
		competitions.forEach(function(competition) {
			if (blacklist.indexOf(competition.id) == -1) {
				arrCompetitions.push({
					category: 'Soccer',
					keyword: competition.league,
					url: competition._links.fixtures.href.replace('http:', 'https:')
				});
			}
		});
		handle(arrCompetitions);
	});

}


function initFootballDataOrg(category, keyWord, url) {

	var headers = {
		'X-Auth-Token': conf.footballDataApiKey
	};

	var firstCalendarLoading = true;
	
	var resultHelper = {};
	resultHelper.headers = headers;
	resultHelper.hoursToWaitBeforeGetResult = 4;
	resultHelper.rules = "The oracle will post the name of winning team after 90 minutes play. This includes added injury or stoppage time but doesn't include extra-time, penalty shootouts or golden goal. If the match is rescheduled to another day, no result will be posted.";
	resultHelper.process = function(response, expectedFeedName, handle) {
		if (response.fixture.status == "FINISHED") {
			if (response.fixture.result && response.fixture.result.goalsAwayTeam != null) {
					let fixture = encodeFixture(response.fixture);
						if (fixture.feedName === expectedFeedName){
							if (Number(response.fixture.result.goalsAwayTeam) > Number(response.fixture.result.goalsHomeTeam)) {
								fixture.winner = fixture.awayTeam;
								fixture.winnerCode = fixture.feedAwayTeamName;
							}
							if (Number(response.fixture.result.goalsAwayTeam) < Number(response.fixture.result.goalsHomeTeam)) {
								fixture.winner = fixture.homeTeam;
								fixture.winnerCode = fixture.feedHomeTeamName;
							}
							if (Number(response.fixture.result.goalsAwayTeam) == Number(response.fixture.result.goalsHomeTeam)) {
								fixture.winner = 'draw';
								fixture.winnerCode = 'draw';
							}
							handle(null, fixture);
							
							} else {
								handle('The feedname is not the expected one, feedname found: ' + fixture.feedName);	
							}
					} else {
						handle('No result in response');
					}
				
		} else {
			handle('Fixture is not finished');
		}
	};
	
	calendar.addResultHelper(category, keyWord, resultHelper);
	
	function encodeFixture(fixture) {
		let homeTeamName = commons.removeAbbreviations(fixture.homeTeamName);
		let awayTeamName = commons.removeAbbreviations(fixture.awayTeamName);
		let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
		let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
		let localDay = moment.utc(fixture.date);
		if (fixture._links.competition.href == "http://api.football-data.org/v1/competitions/444"){ //for bresil championship we convert UTC time to local time approximately
			localDay.subtract(4, 'hours');
		}
		return {
			homeTeam: homeTeamName,
			awayTeam: awayTeamName,
			feedHomeTeamName: feedHomeTeamName,
			feedAwayTeamName: feedAwayTeamName,
			feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + localDay.format("YYYY-MM-DD"),
			urlResult: fixture._links.self.href.replace('http:', 'https:'),
			date: moment.utc(fixture.date),
			localDay: localDay
		}
	}

	function loadInCalendar() {
		request({
				url: url,
				headers: headers
			}, function(error, response, body) {
				if (error || response.statusCode !== 200) {
					if (firstCalendarLoading) {
						throw Error('couldn t get fixtures from footballDataOrg ' + url);
					} else {
						return notifications.notifyAdmin("I couldn't get " + keyWord + " calendar today", "");
					}
				}

				try {
					var jsonResult = JSON.parse(body);
					var fixtures = jsonResult.fixtures;
				} catch (e) {
					if (firstCalendarLoading) {
						throw Error('error parsing football-data response: ' + e.toString() + ", response: " + body);
					} else {
						return notifications.notifyAdmin("I couldn't parse " + keyWord + " today", "");
					}
				}
				if (fixtures.length == 0) {
					if (firstCalendarLoading) {
						throw Error('fixtures array empty, couldn t get fixtures from footballDataOrg');
					} else {
						return notifications.notifyAdmin("I couldn't get fixtures from " + keyWord + " today", "");
					}
				}


				var arrGames = fixtures.map(fixture => {
					return encodeFixture(fixture);
				});

				arrGames.forEach(function(game) {
					if (game.date.diff(moment(),'days') > -15 && game.date.diff(moment(),'days') < 30){
						calendar.addFixture(category, keyWord, game.feedName, game);
					}
				});

				firstCalendarLoading = false;
			}

		);
	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}



function checkUsingSecondSource(championship, feedName, UTCdate, result, handle) {

	if (championship == 'NBA' || championship == 'MLB' || championship == 'NHL' || championship == 'NFL' || soccerTeamsCorrespondence[championship]) {

		checkUsingTheScore(championship, feedName, UTCdate, result, function(error, isOK) {
			return handle(error, isOK);

		});


	} else {
		return handle(null, true);
	}

}


function checkUsingTheScore(championship, feedName, UTCdate, result, handle) {

	function findAndCheckFixture(arrayEventIds) {
		if (arrayEventIds.length == 0) {
			notifications.notifyAdmin("arrayEventIds empty when checking " + feedName, ' ');
			return handle({
				msg: "Couldn't check result from second source of data, admin is notified",
				isCriticalError: true
			});
		}
		request({
			url: 'https://api.thescore.com/' + theScoreKeyURL + '/events/' + arrayEventIds[0]
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				return handle({
					msg: "Error, can't get info from data provider",
					isCriticalError: false
				});
			}
			try {
				var parsedBody = JSON.parse(body);

			} catch (e) {
				notifications.notifyAdmin("Result for event id " + arrayEventIds[0] + " can't be parsed from thescore.com", body);
				return handle({
					msg: "Couldn't parse result from second source of data, admin is notified",
					isCriticalError: true
				});
			}

			if (parsedBody.status && parsedBody.status == "final") {
				
				if (soccerTeamsCorrespondence[championship]){
					if (soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name] && soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name]){
						var feedHomeTeamName = soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name];
						var feedAwayTeamName = soccerTeamsCorrespondence[championship][parsedBody.away_team.full_name];
					} else {
						notifications.notifyAdmin("Couldn't find a correspondence for " + feedName + " from thescore", ' ');
						return handle({
							msg: "Couldn't check result from second source of data, admin is notified",
							isCriticalError: true
						});
					}
				} else {
					var feedHomeTeamName = parsedBody.home_team.full_name.replace(/\s/g, '').toUpperCase();
					var feedAwayTeamName = parsedBody.away_team.full_name.replace(/\s/g, '').toUpperCase();
				}
				
				if (feedHomeTeamName === feedName.split("_")[0] && feedAwayTeamName == feedName.split("_")[1] && moment(parsedBody.game_date).isSame(UTCdate, 'hour')) {

					if (parsedBody.box_score.score.home.score > parsedBody.box_score.score.away.score && result == feedHomeTeamName) {
						return handle(null, true);
					}
					if (parsedBody.box_score.score.home.score < parsedBody.box_score.score.away.score && result == feedAwayTeamName) {
						return handle(null, true);
					}
					if (parsedBody.box_score.score.home.score == parsedBody.box_score.score.away.score && result == 'draw') {
						return handle(null, true);
					}

					return handle(null, false);

				}
			}

			if (arrayEventIds.length > 1) {
				return findAndCheckFixture(arrayEventIds.splice(1));
			} else {
				notifications.notifyAdmin("Couldn't check " + feedName + " from thescore", ' ');
				return handle({
					msg: "Couldn't parse result from second source of data, admin is notified",
					isCriticalError: true
				});

			}


		});

	}
	
	
	if (soccerTeamsCorrespondence[championship]){
		var theScoreKeyURL = soccerTeamsCorrespondence[championship].theScoreKeyURL;
	} else {
		var theScoreKeyURL = championship.toLowerCase();	
	}

	request({
		url: 'https://api.thescore.com/' + theScoreKeyURL + '/schedule'
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			return handle({
				msg: "Error, can't get info from data provider",
				isCriticalError: false
			});
		}
		try {
			var parsedBody = JSON.parse(body);

		} catch (e) {
			notifications.notifyAdmin("Result for " + feedName + " can't be parsed from thescore.com" + "\n" + body);
			return handle({
				msg: "Couldn't parse result from second source of data, admin is notified",
				isCriticalError: true
			});

		}


		if (parsedBody.current_season) {
			let dayOrWeekFound = false;
			parsedBody.current_season.forEach(function(dayOrWeek) {

				if (championship == 'NFL') {

					if (moment(dayOrWeek.start_date).isSameOrBefore(UTCdate) && moment(dayOrWeek.end_date).isSameOrAfter(UTCdate)) {
						findAndCheckFixture(dayOrWeek.event_ids, feedName);
						dayOrWeekFound = true;
					}


				} else {

					if (dayOrWeek.id === UTCdate.format("YYYY-MM-DD")) {
						findAndCheckFixture(dayOrWeek.event_ids, feedName);
						dayOrWeekFound = true;
					}
				}

			});

			if (!dayOrWeekFound) {
				notifications.notifyAdmin("Day not found for " + feedName, JSON.stringify(parsedBody));
				return handle({
					msg: "Couldn't parse result from second source of data, admin is notified",
					isCriticalError: true
				});
			}


		} else {
			notifications.notifyAdmin("Wrong JSON format from thescore.com for " + championship, JSON.stringify(parsedBody));
			return handle({
				msg: "Couldn't parse result from second source of data, admin is notified",
				isCriticalError: true
			});
		}


	});

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

	headlessWallet.readSingleAddress(function(address) {
		my_address = address;
	});
});
