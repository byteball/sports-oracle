/*jslint node: true */
"use strict";
var moment = require('moment');
var request = require('request');
var _ = require('lodash');
var conf = require('byteballcore/conf.js');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var headlessWallet = require('headless-byteball');
var desktopApp = require('byteballcore/desktop_app.js');
var objectHash = require('byteballcore/object_hash.js');
var notifications = require('./notifications.js');
var btoa = require('btoa');
var calendar = {};
var arrPeers = [];
var FootballDataOrgBlacklist=[466];
var reloadInterval = 1000*3600*24;

//------The different feeds are added to the calendar
//------The 2 first arguments specify category and keyword
//initMySportsFeedsCom('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2017-regular/');
initMySportsFeedsCom('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2017-2018-regular/');
initMySportsFeedsCom('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2018-playoff/');
initMySportsFeedsCom('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2017-2018-regular/');
initUfcCom('Mixed Martial Arts', 'UFC');

//------for soccer we fetch championships available
getCurrentChampionshipsFromFootballDataOrg(FootballDataOrgBlacklist,function(arrCurrentChampionShips) {
	arrCurrentChampionShips.forEach(function(currentChampionShip) {
		initFootballDataOrg(currentChampionShip.category, currentChampionShip.keyword, currentChampionShip.url);
	});
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
	for (var cat in calendar) {
		instructions += '\n---' + cat + '---\n';
		for (var keyword in calendar[cat]) {
			instructions += getTxtCommandButton(keyword) + ' ';
		}
	}

	return instructions;
}

function getChampionshipInstructions(championshipName) {
	return "-----------------------------  " + championshipName + "  -----------------------------\n Actions: \n" + " - List " + getTxtCommandButton("last") + " games played \n - List " + getTxtCommandButton("coming") + " games \n" + " - Return " + getTxtCommandButton("home") + "\n - Or write the team names in the format: 'team1 vs team2', partial names are also accepted";
}


function getFixturesAfterNow(championship) {
	var txtReturn = '12 next games coming: \n';
	var bufferAfter = [];
	for (var feedName in championship) {
		if (championship[feedName].date.isAfter(moment())) {
			bufferAfter.push(getTxtCommandButton(championship[feedName].homeTeam + ' vs ' + championship[feedName].awayTeam + " on " + championship[feedName].localDate.format("YYYY-MM-DD"), feedName) + "\n");
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
	var txtReturn = '12 last games played: \n';
	var bufferBefore = [];
	for (var feedName in championship) {
		if (championship[feedName].date.isBefore(moment())) {
			bufferBefore.push(getTxtCommandButton(championship[feedName].homeTeam + ' vs ' + championship[feedName].awayTeam + " on " + championship[feedName].localDate.format("YYYY-MM-DD"), feedName) + "\n");
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
	var splitText = search.split(/\sVS\s|\sVs\.\s|\svs\s|\sVS\.\s|\sV\.\s/);
	var buffer = [];
	if (splitText.length === 1) {
		for (var feedName in championship) {
			if (removeAccents(championship[feedName].homeTeam).toUpperCase().indexOf(removeAccents(search).toUpperCase()) > -1 || removeAccents(championship[feedName].awayTeam).toUpperCase().indexOf(removeAccents(search).toUpperCase()) > -1) {
				buffer.push(getTxtCommandButton(championship[feedName].homeTeam + ' vs ' + championship[feedName].awayTeam + " on " + championship[feedName].localDate.format("YYYY-MM-DD"), feedName) + "\n");
			}
		}
	} else if (splitText.length === 2) {
		var team1Name = splitText[0].replace(/\s/g, '');
		var team2Name = splitText[1].replace(/\s/g, '');
		for (var feedName in championship) {
			if ((removeAccents(championship[feedName].homeTeam).replace(/\s/g, '').toUpperCase().indexOf(removeAccents(team1Name).toUpperCase()) > -1 && removeAccents(championship[feedName].awayTeam).replace(/\s/g, '').toUpperCase().indexOf(removeAccents(team2Name).toUpperCase()) > -1) ||
				(removeAccents(championship[feedName].homeTeam).replace(/\s/g, '').toUpperCase().indexOf(removeAccents(team2Name).toUpperCase()) > -1 && removeAccents(championship[feedName].awayTeam).replace(/\s/g, '').toUpperCase().indexOf(removeAccents(team1Name).toUpperCase()) > -1)) {
				buffer.push(getTxtCommandButton(championship[feedName].homeTeam + ' vs ' + championship[feedName].awayTeam + " on " + championship[feedName].localDate.format("YYYY-MM-DD"), feedName) + "\n");
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
					return handle(result.homeTeam + " vs " + result.awayTeam + "\n " + (result.date ? " on " + result.date.format("YYYY-MM-DD") : " ") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and the contract can be unlocked");
				} else {
					db.query("DELETE FROM asked_fixtures WHERE feed_name=?", [feedName]);
					notifications.notifyAdmin("Check failed for " + feedName, " ");
					return handle("Inconsistency found for result, admin is notified");

				}

			});

		});
	});


}

function getFeedStatus(cat,championship, fixture, from_address, resultHelper, handle) {
					
	function insertIntoAskedFixtures(){
		db.query("INSERT INTO asked_fixtures (device_address, feed_name, fixture_date, status, result_url, cat, championship, hours_to_wait) VALUES (?,?,?,?,?,?,?,?)", [from_address, fixture.feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"), 'new', fixture.urlResult, cat, championship, resultHelper.hoursToWaitBeforeGetResult]);
	}

	if (fixture.date.isBefore(moment().subtract(resultHelper.hoursToWaitBeforeGetResult, 'hours'))) {
		readExistingData(fixture.feedName, function(exists, is_stable, value) {

			if (exists) {
				if (!is_stable) {
					insertIntoAskedFixtures();
				}
				handle(getResponseForFeedAlreadyInDAG(fixture.homeTeam, fixture.awayTeam, fixture.date.format("YYYY-MM-DD HH:mm:ss"), value, is_stable));
			} else {
				insertIntoAskedFixtures();
				var device = require('byteballcore/device.js');
				device.sendMessageToDevice(from_address, 'text', "Result is being retrieved, please wait.");
				retrieveAndPostResult(fixture.urlResult, championship, fixture.feedName, resultHelper, function(txt) {
					handle(txt);
				});
			}
		});
	} else {
		insertIntoAskedFixtures();
		handle("To bet on this fixture, select the Sport Oracle and use the feedname below when you offer the contract to your peer: \n\n" + fixture.feedName + "\n\nThe value should be the team you expect as winner or 'draw': \n" + "Eg: " + fixture.feedName + " = " + fixture.feedName.split('_')[1] 
		+ "\n\nRules for " + championship + ": " + resultHelper.rules
		+ "\n\nResult is available "+ resultHelper.hoursToWaitBeforeGetResult +" hours after the fixture, you will be notified when the contract can be unlocked.\n\nYou don't want to play alone ? Get a Slack invitation: http://slack.byteball.org/ and join us on #prediction_markets channel.");
	}
}

function getPublicCalendar() {
	var publicCalendar = _.cloneDeep(calendar);
	for (var cat in publicCalendar) {
		for (var championship in publicCalendar[cat]) { //we delete unneeded attributes
			delete publicCalendar[cat][championship].resultHelper;
			for (var fixture in publicCalendar[cat][championship].feedNames) {
				delete publicCalendar[cat][championship].feedNames[fixture].urlResult;
				delete publicCalendar[cat][championship].feedNames[fixture].feedName;
			}
		}
	}
	return JSON.stringify(publicCalendar);
}
	

function notifyForDatafeedPosted(feed_name) {
	db.query(
		"SELECT * FROM asked_fixtures WHERE feed_name=?  GROUP BY device_address", [feed_name],
		function(rows) {
			rows.forEach(
				function(row) {
					var device = require('byteballcore/device.js');
					device.sendMessageToDevice(row.device_address, 'text', "Sport oracle posted result for " + row.feed_name);
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
					if (calendar[row.cat] && calendar[row.cat][row.championship]) {
						readExistingData(row.feed_name, function(exists) {
							if(!exists)
							retrieveAndPostResult(row.result_url, row.championship, row.feed_name, calendar[row.cat][row.championship].resultHelper, function() {});
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
 
	if (!arrPeers[from_address]) {
		arrPeers[from_address] = {
			step: "home",
			cat: "none_yet",
		};
	}

	if (text == "home") {
		arrPeers[from_address].step = 'home';
	}

	if (text == "/JSON") {
		return device.sendMessageToDevice(from_address, 'text', getPublicCalendar());
	}

	if (text == "post" && headlessWallet.isControlAddress(from_address)) {
		arrPeers[from_address].step = 'waitingFeedname';
		return device.sendMessageToDevice(from_address, 'text', "Enter feedname or return " + getTxtCommandButton("home"));
	}

	if (arrPeers[from_address].step == 'waitingFeedname' && headlessWallet.isControlAddress(from_address)) {
		readExistingData(text, function(exists, is_stable, value) {
			if (exists) {
				arrPeers[from_address].step = 'home';
				return device.sendMessageToDevice(from_address, 'text', "This feedname was already posted with " + value + " as value");
			} else {
				arrPeers[from_address].step = 'waitingValue';
				arrPeers[from_address].feedNametoBePosted = text;
				return device.sendMessageToDevice(from_address, 'text', "Enter value for " + text + " or return " + getTxtCommandButton("home"));
			}
		});
	}
	
	if (arrPeers[from_address].step == 'waitingValue' && headlessWallet.isControlAddress(from_address)) {
		var datafeed = {};
		datafeed[arrPeers[from_address].feedNametoBePosted] = text;
		reliablyPostDataFeed(datafeed);
		arrPeers[from_address].step = 'home';
		return device.sendMessageToDevice(from_address, 'text', "The feedname is being posted \n➡ " + getTxtCommandButton("ok"));
	}
	
	if (arrPeers[from_address].step != 'waitingFeedname' && arrPeers[from_address].step != 'waitingValue') {
		
		for (var cat in calendar) {
			if (calendar[cat][text]) {
				arrPeers[from_address].step = text;
				arrPeers[from_address].cat = cat;
				return device.sendMessageToDevice(from_address, 'text', getChampionshipInstructions(text));
			}
		}

		for (var cat in calendar) {
			for (var championship in calendar[cat]) {
				if (calendar[cat][championship].feedNames[text]) {
					getFeedStatus(cat, championship, calendar[cat][championship].feedNames[text], from_address, calendar[cat][championship].resultHelper, function(response) {
						device.sendMessageToDevice(from_address, 'text', response);
					});
					return;
				}
			}
		}

		if (calendar[arrPeers[from_address].cat] && arrPeers[from_address].step != 'home') {

			if (text == "last") {
				return device.sendMessageToDevice(from_address, 'text', getFixturesBeforeNow(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames) + getChampionshipInstructions(arrPeers[from_address].step));
			}
			if (text == "coming") {
				return device.sendMessageToDevice(from_address, 'text', getFixturesAfterNow(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames) + getChampionshipInstructions(arrPeers[from_address].step));
			}
			return device.sendMessageToDevice(from_address, 'text', "Search for '" + text + "' :\n" + searchFixtures(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames, text) + getChampionshipInstructions(arrPeers[from_address].step));
		}

		return device.sendMessageToDevice(from_address, 'text', getHomeInstructions());
	}
});

function getTxtCommandButton(label, command) {
	var text = "";
	var _command = command ? command : label;
	text += "[" + label + "]" + "(command:" + _command + ")";
	return text;
}


function removeAbbreviations(text) {
	return text.replace(/\b(AC|ADO|AFC|AJ|AS|AZ|BSC|CF|EA|EC|ES|FC|FCO|FSV|GO|JC|LB|NAC|MSV|OGC|OSC|PR|RC|SC|PEC|PSV|SCO|SM|SV|TSG|US|VfB|VfL)\b/g, '').trim();
}

function removeAccents(str) {
	var accents = 'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž';
	var accentsOut = "AAAAAAaaaaaaOOOOOOOooooooEEEEeeeeeCcDIIIIiiiiUUUUuuuuNnSsYyyZz";
	str = str.split('');
	var strLen = str.length;
	var i, x;
	for (i = 0; i < strLen; i++) {
		if ((x = accents.indexOf(str[i])) != -1) {
			str[i] = accentsOut[x];
		}
	}
	return str.join('');
}



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
	if (typeof calendar[category] === 'undefined') {
		calendar[category] = {};
	}
	if (typeof calendar[category][keyWord] === 'undefined') {
		calendar[category][keyWord] = {};
	}

	var headers = {
		'X-Auth-Token': conf.footballDataApiKey
	};

	var firstCalendarLoading = true;
	
	calendar[category][keyWord].resultHelper = {};
	calendar[category][keyWord].resultHelper.headers = headers;
	calendar[category][keyWord].resultHelper.hoursToWaitBeforeGetResult = 4;
	calendar[category][keyWord].resultHelper.rules = "The oracle will post the name of winning team after 90 minutes play. This includes added injury or stoppage time but doesn't include extra-time, penalty shootouts or golden goal. If the match is rescheduled to another day, no result will be posted.";
	calendar[category][keyWord].resultHelper.process = function(response, expectedFeedName, handle) {
		if (response.fixture.status == "FINISHED") {
			if (response.fixture.result && response.fixture.result.goalsAwayTeam != null) {
					let fixture = encodeFixture(response.fixture);
						if (fixture.feedName === expectedFeedName){
							if (Number(response.fixture.result.goalsAwayTeam) > Number(response.fixture.result.goalsHomeTeam)) {
								fixture.winner = fixture.AwayTeam;
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
	
	function encodeFixture(fixture) {
		let homeTeamName = removeAbbreviations(fixture.homeTeamName);
		let awayTeamName = removeAbbreviations(fixture.awayTeamName);
		let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
		let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
		let localDate = moment.utc(fixture.date);
		if (fixture._links.competition.href == "http://api.football-data.org/v1/competitions/444"){ //for bresil championship we convert UTC time to local time approximately
			localDate.subtract(4, 'hours');
		}
		return {
			homeTeam: homeTeamName,
			awayTeam: awayTeamName,
			feedHomeTeamName: feedHomeTeamName,
			feedAwayTeamName: feedAwayTeamName,
			feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + localDate.format("YYYY-MM-DD"),
			urlResult: fixture._links.self.href.replace('http:', 'https:'),
			date: moment.utc(fixture.date),
			localDate: localDate
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

				calendar[category][keyWord].feedNames = {};
				arrGames.forEach(function(game) {
					if (game.date.diff(moment(),'days') > -15 && game.date.diff(moment(),'days') < 30){
						calendar[category][keyWord].feedNames[game.feedName] = game;
					}
				});

				firstCalendarLoading = false;
				console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");
			}

		);
	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}



function initMySportsFeedsCom(category, keyWord, url) {

	if (typeof calendar[category] === 'undefined') {
		calendar[category] = {};
	}
	if (typeof calendar[category][keyWord] === 'undefined') {
		calendar[category][keyWord] = {};
	}
	var headers = {
		"Authorization": "Basic " + btoa(conf.MySportsFeedsUser + ":" + conf.MySportsFeedsPw)
	};

	var firstCalendarLoading = true;

	//there are several different resultHelper function depending of sport

	calendar[category][keyWord].resultHelper = {};
	calendar[category][keyWord].resultHelper.headers = headers;
	if (url.indexOf('mlb') > -1) {
		calendar[category][keyWord].resultHelper.hoursToWaitBeforeGetResult = 6;
		calendar[category][keyWord].resultHelper.rules = "The oracle will post the name of winning team. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		calendar[category][keyWord].resultHelper.process = function(response, expectedFeedName, handle) {
			if (convertMySportsFeedsTimeToMomentUTC(response.gameboxscore.game.date, response.gameboxscore.game.time).diff(moment(), 'hours', true) > -5) {
				handle('The fixture may not had enough time to finish');
			} else {
				if (response.gameboxscore.inningSummary.inningTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);
					if (fixture.feedName === expectedFeedName){
						if (Number(response.gameboxscore.inningSummary.inningTotals.awayScore) > Number(response.gameboxscore.inningSummary.inningTotals.homeScore)) {
							fixture.winner = fixture.awayTeam;
							fixture.winnerCode = fixture.feedAwayTeamName;
						}
						if (Number(response.gameboxscore.inningSummary.inningTotals.awayScore) < Number(response.gameboxscore.inningSummary.inningTotals.homeScore)) {
							fixture.winner = fixture.homeTeam;
							fixture.winnerCode = fixture.feedHomeTeamName;
						}
						if (Number(response.gameboxscore.inningSummary.inningTotals.awayScore) == Number(response.gameboxscore.inningSummary.inningTotals.homeScore)) {
							fixture.winner = 'draw';
							fixture.winnerCode = 'draw';
						}
						handle(null, fixture);
					} else {
						handle('The feedname is not the expected one, feedname found: ' + fixture.feedName);
					}
				} else {
					handle('No inningTotals in response');
				}
			}
		};
	}

	if (url.indexOf('nba') > -1 || url.indexOf('nfl') > -1) {
		calendar[category][keyWord].resultHelper.hoursToWaitBeforeGetResult = 6;
		calendar[category][keyWord].resultHelper.rules = "The oracle will post the name of winning team. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		calendar[category][keyWord].resultHelper.process = function(response, expectedFeedName, handle) {
			if (convertMySportsFeedsTimeToMomentUTC(response.gameboxscore.game.date, response.gameboxscore.game.time).diff(moment(), 'hours', true) > -5) {
				handle('The fixture may not had enough time to finish');
			} else {
				if (response.gameboxscore.quarterSummary.quarterTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);
					if (fixture.feedName === expectedFeedName){
						if (Number(response.gameboxscore.quarterSummary.quarterTotals.awayScore) > Number(response.gameboxscore.quarterSummary.quarterTotals.homeScore)) {
							fixture.winner = fixture.awayTeam;
							fixture.winnerCode = fixture.feedAwayTeamName;
						}
						if (Number(response.gameboxscore.quarterSummary.quarterTotals.awayScore) < Number(response.gameboxscore.quarterSummary.quarterTotals.homeScore)) {
							fixture.winner = fixture.homeTeam;
							fixture.winnerCode = fixture.feedHomeTeamName;
						}
						if (Number(response.gameboxscore.quarterSummary.quarterTotals.awayScore) == Number(response.gameboxscore.quarterSummary.quarterTotals.homeScore)) {
							fixture.winner = 'draw';
							fixture.winnerCode = 'draw';
						}
					handle(null, fixture);
					} else {
						handle('The feedname is not the expected one, feedname found: ' + fixture.feedName);
					}
				} else {
					handle('No quarterTotals in response');
				}
			}
		};
	}

	if (url.indexOf('nhl') > -1) {
		calendar[category][keyWord].resultHelper.hoursToWaitBeforeGetResult = 6;
		calendar[category][keyWord].resultHelper.rules = "The oracle will post the name of winning team for 3 x 20 minutes periods plus overtime/shootouts. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		calendar[category][keyWord].resultHelper.process = function(response, expectedFeedName, handle) {
			if (convertMySportsFeedsTimeToMomentUTC(response.gameboxscore.game.date, response.gameboxscore.game.time).diff(moment(), 'hours', true) > -5) {
				handle('The fixture may not had enough time to finish');
			} else {
				if (response.gameboxscore.periodSummary.periodTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);
					if (fixture.feedName === expectedFeedName){
						if (Number(response.gameboxscore.periodSummary.periodTotals.awayScore) > Number(response.gameboxscore.periodSummary.periodTotals.homeScore)) {
							fixture.winner = fixture.awayTeam;
							fixture.winnerCode = fixture.feedAwayTeamName;
						}
						if (Number(response.gameboxscore.periodSummary.periodTotals.awayScore) < Number(response.gameboxscore.periodSummary.periodTotals.homeScore)) {
							fixture.winner = fixture.homeTeam;
							fixture.winnerCode = fixture.feedHomeTeamName;
						}
						if (Number(response.gameboxscore.periodSummary.periodTotals.awayScore) == Number(response.gameboxscore.periodSummary.periodTotals.homeScore)) {
							fixture.winner = 'draw';
							fixture.winnerCode = 'draw';
						}
						handle(null, fixture);
					} else {
						handle('The feedname is not the expected one, feedname found: ' + fixture.feedName);
					}
				} else {
					handle('No periodTotals in response');
				}
			}
		};
	}

	function convertMySportsFeedsTimeToMomentUTC(mySportsFeedsDate, mySportsFeedsTime) {
		let UtcDate = moment.utc(mySportsFeedsDate + ' ' + mySportsFeedsTime,'YYYY-MM-DD hh:mma');
		UtcDate.add(5, 'hours');
		return UtcDate;
	}

	function encodeFixture(fixture) {
		let homeTeamName = fixture.homeTeam.City + " " + fixture.homeTeam.Name;
		let awayTeamName = fixture.awayTeam.City + " " + fixture.awayTeam.Name;
		let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
		let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();

		return {
			homeTeam: homeTeamName,
			awayTeam: awayTeamName,
			feedHomeTeamName: feedHomeTeamName,
			feedAwayTeamName: feedAwayTeamName,
			feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + moment.utc(fixture.date).format("YYYY-MM-DD"),
			urlResult: url + "game_boxscore.json?gameid=" + fixture.id,
			date: convertMySportsFeedsTimeToMomentUTC(fixture.date, fixture.time).utc(),
			localDate: moment.utc(fixture.date)
		}
	}

	function loadInCalendar() {
		request({
			url: url + "full_game_schedule.json",
			headers: headers
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				if (firstCalendarLoading) {
					throw Error("couldn't get events from MySportsFeedsCom " + url);
				} else {
					return notifications.notifyAdmin("I couldn't get " + keyWord + " calendar today", "");
				}
			}

			try {
				var jsonResult = JSON.parse(body);
			} catch (e) {
				if (firstCalendarLoading) {
					throw Error("Couldn't parse  footballDataOrg, error: " + e);
				} else {
					return notifications.notifyAdmin("I couldn't parse " + keyWord + "calendar today", "");
				}
			}
			var fixtures = jsonResult.fullgameschedule.gameentry;

			if (fixtures.length == 0) {
				if (firstCalendarLoading) {
					throw Error("fixtures array empty, couldn't get fixtures from footballDataOrg");
				} else {
					return notifications.notifyAdmin("I couldn't get fixtures for " + keyWord + " today", "");
				}
			}


			var arrGames = fixtures.map(fixture => {
				return encodeFixture(fixture);

			});

			calendar[category][keyWord].feedNames = {};
			arrGames.forEach(function(game) {
				if (typeof game === 'object') {
					if (game.date.diff(moment(),'days') > -15 && game.date.diff(moment(),'days') < 30){
						calendar[category][keyWord].feedNames[game.feedName] = game;
					}
				}
			});

			firstCalendarLoading = false;
			console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");
		});

	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}


function initUfcCom(category, keyWord) {
	if (typeof calendar[category] === 'undefined') {
		calendar[category] = {};
	}
	if (typeof calendar[category][keyWord] === 'undefined') {
		calendar[category][keyWord] = {};
	}

	var firstCalendarLoading = true;
	calendar[category][keyWord].resultHelper = {};
	calendar[category][keyWord].resultHelper.hoursToWaitBeforeGetResult = 12;
	calendar[category][keyWord].resultHelper.rules = "The oracle will post the name of winner. In case the match is a draw or has been rescheduled to another event, no result will be posted.";
	calendar[category][keyWord].resultHelper.process = function(response, expectedFeedName, handle) {
		var fightFound = false;
		response.forEach(function(fight) {
			let fixture = encodeOnlyNames(fight);

			if (expectedFeedName.indexOf(fixture.feedName) > -1) {
				fightFound = true;
				if (fight.fighter1_is_winner || fight.fighter2_is_winner) {
					if (fight.fighter1_is_winner) {
						fixture.winnerCode = fixture.feedHomeTeamName;
						fixture.winner = fixture.homeTeam;
						return handle(null, fixture)
					}
					if (fight.fighter2_is_winner) {
						fixture.winnerCode = fixture.feedAwayTeamName;
						fixture.winner = fixture.awayTeam;
						return handle(null, fixture)
					}

				} else {
					return handle('this fight has no winner');
				}

			}

		});

		if (!fightFound) {
			handle('Fixture not found in response');
		}

	};

	function encodeOnlyNames(fight) {
		let feedHomeTeamName = fight.fighter1_first_name.concat(fight.fighter1_last_name).toUpperCase();
		let feedAwayTeamName = fight.fighter2_first_name.concat(fight.fighter2_last_name).toUpperCase();
		return {
			homeTeam: fight.fighter1_first_name + " " + fight.fighter1_last_name,
			awayTeam: fight.fighter2_first_name + " " + fight.fighter2_last_name,
			feedHomeTeamName: feedHomeTeamName,
			feedAwayTeamName: feedAwayTeamName,
			feedName: feedHomeTeamName + '_' + feedAwayTeamName
		}
	}


	function loadInCalendar() {
		request({
			url: 'https://ufc-data-api.ufc.com/api/v3/iphone/events',
			rejectUnauthorized: false
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				if (firstCalendarLoading) {
					throw Error('couldn t get events from UFC ');
				} else {
					return notifications.notifyAdmin("I couldn't get " + keyWord + " events today", "");
				}
			}

			try {
				var events = JSON.parse(body);
			} catch (e) {
				if (firstCalendarLoading) {
					throw Error('error parsing UFC events response: ' + e.toString() + ", response: " + body);
				} else {
					return notifications.notifyAdmin("I couldn't parse " + keyWord + " today", "");
				}
			}
			if (events.length == 0) {
				if (firstCalendarLoading) {
					throw Error('events array empty, couldn t get events from footballDataOrg');
				} else {
					return notifications.notifyAdmin("I couldn't get events from " + keyWord + " today", "");
				}
			}
			calendar[category][keyWord].feedNames = {};
			events.forEach(function(event) {
				let eventDate = moment.utc(event.event_date);
				if (eventDate.diff(moment(), 'days') > -10 && eventDate.diff(moment(), 'days') < 7 && event.event_time_zone_text == 'ETPT' && event.event_time_text != '') {
					request({
						url: 'https://ufc-data-api.ufc.com/api/v3/iphone/events/' + event.id + '/fights',
						rejectUnauthorized: false
					}, function(eventError, eventResponse, eventBody) {
						if (eventError || eventResponse.statusCode !== 200) {
							if (firstCalendarLoading) {
								throw Error('couldn t get event id ' + event.id + 'from UFC ');
							} else {
								return notifications.notifyAdmin('couldn t get event id ' + event.id + 'from UFC today', "");
							}
						}

						try {
							var fights = JSON.parse(eventBody);
						} catch (e) {
							if (firstCalendarLoading) {
								throw Error('error parsing UFC fights, response: ' + e.toString() + ", response: " + eventBody);
							} else {
								return notifications.notifyAdmin("I couldn't parse " + keyWord + " today", "");
							}
						}

						if (fights.length == 0) {
							if (firstCalendarLoading) {
								throw Error("fights array empty, couldn t get fights from UFC event id" + event.id);
							} else {
								return notifications.notifyAdmin("fights array empty, couldn t get fights from UFC event id " + event.id + " today", "");
							}
						}

						var arrayLocalTimes = event.event_time_text.split('/');
						if (arrayLocalTimes.length != 2 || (arrayLocalTimes[0].indexOf('AM') == -1 && arrayLocalTimes[0].indexOf('PM') == -1)) {
							if (firstCalendarLoading) {
								throw Error("Unusual date format for UFC event " + event.id);
							} else {
								return notifications.notifyAdmin("I constated an unusual date format for UFC event id " + event.id + " today", "");
							}
						}

						var timeShift = 5;

						if (eventDate.isDST()) {
							timeShift--;
						}
						timeShift -= 2; // event can begin 2 hours before announced time due to preliminary fights

						var UTCtime = moment.utc(eventDate.format("YYYY-MM-DD") + ' ' + arrayLocalTimes[0], ['YYYY-MM-DD hha', 'YYYY-MM-DD hh:mma']);
						UTCtime.add(timeShift, 'hours');

						var arrGames = fights.map(fight => {
							let feedNameObject = encodeOnlyNames(fight);
							feedNameObject.feedName += '_' + eventDate.format("YYYY-MM-DD");
							feedNameObject.localDate = eventDate;
							feedNameObject.date = UTCtime;
							feedNameObject.urlResult = 'http://ufc-data-api.ufc.com/api/v3/iphone/events/' + event.id + '/fights';
							return feedNameObject;
						});

						arrGames.forEach(function(game) {
							calendar[category][keyWord].feedNames[game.feedName] = game;
						});

						firstCalendarLoading = false;
						console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");


					});

				}
			});


		});
	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}

function checkUsingSecondSource(championship, feedName, UTCdate, result, handle) {

	if (championship == 'NBA' || championship == 'MLB' || championship == 'NHL' || championship == 'NFL') {

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
			url: 'https://api.thescore.com/' + championship.toLowerCase() + '/events/' + arrayEventIds[0]
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

				let feedHomeTeamName = parsedBody.home_team.full_name.replace(/\s/g, '').toUpperCase();
				let feedAwayTeamName = parsedBody.away_team.full_name.replace(/\s/g, '').toUpperCase();

				if ((feedHomeTeamName + '_' + feedAwayTeamName) === feedName.slice(0, -11)) {

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

	request({
		url: 'https://api.thescore.com/' + championship.toLowerCase() + '/schedule'
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

	db.query("SELECT feed_name FROM data_feeds WHERE unit IN(?)", [arrUnits], function(rows) {
		rows.forEach(row => {
			notifyForDatafeedPosted(row.feed_name);
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
