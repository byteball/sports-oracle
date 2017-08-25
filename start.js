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

//------The different feeds are added to the calendar
//------The 2 first arguments specify category and keyword
initMySportsFeedsCom('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2017-regular/');
initMySportsFeedsCom('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2017-2018-regular/');
initMySportsFeedsCom('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2017-regular/');
initMySportsFeedsCom('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2017-2018-regular/');
//initUfcInfoCom('Mixed Martial Arts', 'UFC');//not working yet

//------for soccer we fetch championships available
getCurrentChampionshipsFromFootballDataOrg(function(arrCurrentChampionShips) {
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


function retrieveAndPostResult(url, feedName, resultHelper, handle) {

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

		resultHelper.process(parsedBody, function(err, result) {
			if (err) {
				notifications.notifyAdmin("Result for " + feedName + " should be available but it is not", "URL concerned:" + url + "error:" + err);
				return handle("Result not available yet, you will be notified when available");
			}
			if (result.feedName !== feedName) {
				notifications.notifyAdmin('Inconsistency for ' + feedName, 'Result feedname:' + result.feedName + ' Response from ' + url + ' : ' + body);
				return handle("Inconsistent result, admin is notified");
			}

			var datafeed = {};
			datafeed[feedName] = result.winnerCode;
			reliablyPostDataFeed(datafeed);
			handle(result.homeTeam + " vs " + result.awayTeam + "\n on " + result.date.format("YYYY-MM-DD") + "\n" + (result.winner === 'draw' ? 'draw' : result.winner + ' won') + "\n\nThe data will be added into the database, I'll let you know when it is confirmed and you are able to unlock your contract.");

		});
	});


}

function getFeedStatus(peer, fixture, from_address, resultHelper, handle) {

	if (fixture.date.isBefore(moment().subtract(6, 'hours'))) {
		readExistingData(fixture.feedName, function(exists, is_stable, value) {

			if (exists) {
				if (!is_stable) {
					db.query("INSERT INTO asked_fixtures (device_address, feed_name, fixture_date, status, result_url, cat, championship) VALUES (?,?,?,?,?,?,?)", [from_address, fixture.feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"), 'new', fixture.urlResult, peer.cat, peer.step]);
				}
				handle(getResponseForFeedAlreadyInDAG(fixture.homeTeam, fixture.awayTeam, fixture.date.format("YYYY-MM-DD HH:mm:ss"), value, is_stable));
			} else {
				db.query("INSERT INTO asked_fixtures (device_address, feed_name, fixture_date, status, result_url, cat, championship) VALUES (?,?,?,?,?,?,?)", [from_address, fixture.feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"), 'new', fixture.urlResult, peer.cat, peer.step]);
				retrieveAndPostResult(fixture.urlResult, fixture.feedName, resultHelper, function(txt) {
					handle(txt);
				});
			}
		});
	} else {
		db.query("INSERT INTO asked_fixtures (device_address, feed_name, fixture_date, status, result_url, cat, championship) VALUES (?,?,?,?,?,?,?)", [from_address, fixture.feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"), 'new', fixture.urlResult, peer.cat, peer.step]);
		handle("The code for the sport oracle is: \n" + fixture.feedName + "\nEg: " + fixture.feedName + " = " + fixture.feedName.split('_')[1] + "\nResult is available 6 hours after the fixture, you will be notified when you can unlock the contract.");
	}
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
		"SELECT * FROM asked_fixtures WHERE fixture_date < datetime('now', '-6 hours') GROUP BY feed_name", [],
		function(rows) {
			rows.forEach(
				function(row) {
					if (calendar[row.cat] && calendar[row.cat][row.championship]) {
						readExistingData(row.feed_name, function(exists) {
							if(!exists)
							retrieveAndPostResult(row.result_url, row.feed_name, calendar[row.cat][row.championship].resultHelper, function() {});
						});
					} else {
						notifications.notifyAdmin("Championship " + feedName + " not in calendar anymore, can't get result", "");
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
				getFeedStatus(arrPeers[from_address], calendar[cat][championship].feedNames[text], from_address, calendar[cat][championship].resultHelper, function(response) {
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


function getCurrentChampionshipsFromFootballDataOrg(handle) {
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
			arrCompetitions.push({
				category: 'Soccer',
				keyword: competition.league,
				url: competition._links.fixtures.href.replace('http:','https:')
			});
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
	request({
			url: url,
			headers: headers
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				throw Error('couldn t get fixtures from footballDataOrg ' + url);
			}

			try {
				var jsonResult = JSON.parse(body);
				var fixtures = jsonResult.fixtures;
			} catch (e) {
				//	notifications.notifyAdminAboutPostingProblem('error parsing football-data response: '+e.toString()+", response: "+body);
			}
			if (fixtures.length == 0) {
				throw Error('fixtures array empty, couldn t get fixtures from footballDataOrg');
			}

			function encodeFixture(fixture) {
				let homeTeamName = removeAbbreviations(fixture.homeTeamName);
				let awayTeamName = removeAbbreviations(fixture.awayTeamName);
				let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
				let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
				return {
					homeTeam: homeTeamName,
					awayTeam: awayTeamName,
					feedHomeTeamName: feedHomeTeamName,
					feedAwayTeamName: feedAwayTeamName,
					feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + moment.utc(fixture.date).format("YYYY-MM-DD"),
					urlResult: fixture._links.self.href.replace('http:','https:'),
					date: moment.utc(fixture.date),
					localDate: moment.utc(fixture.date) //local date is not given by FootballDataOrg, a shift in date can happen for competitions in america
				}
			}

			var arrGames = fixtures.map(fixture => {
				return encodeFixture(fixture);
			});

			calendar[category][keyWord].feedNames = {};
			arrGames.forEach(function(game) {
				calendar[category][keyWord].feedNames[game.feedName] = game;
			});

			calendar[category][keyWord].resultHelper = {};
			calendar[category][keyWord].resultHelper.headers = headers;
			calendar[category][keyWord].resultHelper.process = function(response, handle) {
				if (response.fixture.result && response.fixture.result.goalsAwayTeam != null) {
					let fixture = encodeFixture(response.fixture);

					if (Number(response.fixture.result.goalsAwayTeam) > Number(response.fixture.result.goalsHomeTeam)) {
						fixture.winner = fixture.homeTeam;
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
					handle('No result in response');
				}
			};
			console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");

		}

	);
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
	request({
		url: url + "full_game_schedule.json",
		headers: headers
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			throw Error("couldn't get events from MySportsFeedsCom " + url);
		}

		try {
			var jsonResult = JSON.parse(body);
		} catch (e) {
			throw Error("Couldn't parse  footballDataOrg, error: " + e);
		}
		var fixtures = jsonResult.fullgameschedule.gameentry;
		
		if (fixtures.length == 0) {
			throw Error("fixtures array empty, couldn't get fixtures from footballDataOrg");
		}
	

		function encodeFixture(fixture) {
			let homeTeamName = fixture.homeTeam.City + " " + fixture.homeTeam.Name;
			let awayTeamName = fixture.awayTeam.City + " " + fixture.awayTeam.Name;
			let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
			let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
			let fixtureDate = moment.utc(fixture.date);

			if (fixture.time.lastIndexOf('PM') > 0) {
				fixtureDate.add(12, 'hours');
			}
			fixture.time.replace('PM', '').replace('AM', '');
			fixture.time.split(':');
			fixtureDate.add(fixture.time[0], 'hours').add(fixture.time[1], 'minutes');
			fixtureDate.add(5, 'hours'); //EST to UTC time

			return {
				homeTeam: homeTeamName,
				awayTeam: awayTeamName,
				feedHomeTeamName: feedHomeTeamName,
				feedAwayTeamName: feedAwayTeamName,
				feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + moment.utc(fixture.date).format("YYYY-MM-DD"),
				urlResult: url + "game_boxscore.json?gameid=" + fixture.id,
				date: fixtureDate.utc(),
				localDate: moment.utc(fixture.date)
			}
		}

		var arrGames = fixtures.map(fixture => {
			return encodeFixture(fixture);

		});

		calendar[category][keyWord].feedNames = {};
		arrGames.forEach(function(game) {
			if (typeof game === 'object') {
				calendar[category][keyWord].feedNames[game.feedName] = game;
			}
		});
		//there are several different resultHelper function depending of sport

		calendar[category][keyWord].resultHelper = {};
		calendar[category][keyWord].resultHelper.headers = headers;
		if (url.indexOf('mlb') > -1) {
			calendar[category][keyWord].resultHelper.process = function(response, handle) {
				if (response.gameboxscore.inningSummary.inningTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);

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
					handle('No inningTotals in response');
				}
			};
		}

		if (url.indexOf('nba') > -1 || url.indexOf('nfl') > -1) {
			calendar[category][keyWord].resultHelper.process = function(response, handle) {
				if (response.gameboxscore.quarterSummary.quarterTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);

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
					handle('No quarterTotals in response');
				}
			};
		}

		if (url.indexOf('nhl') > -1) {
			calendar[category][keyWord].resultHelper.process = function(response, handle) {
				if (response.gameboxscore.periodSummary.periodTotals) {
					let fixture = encodeFixture(response.gameboxscore.game);

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
					handle('No periodTotals in response');
				}
			};
		}


		console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");
	});

}

/* not finished
function initUfcInfoCom(category, keyWord) {
    if (typeof calendar[category] === 'undefined') {
        calendar[category] = {};
    }
    if (typeof calendar[category][keyWord] === 'undefined') {
        calendar[category][keyWord] = {};
    }

    request({
            url: 'http://www.ufc-info.com/upcomingEvents'
        }, function(error, response, body) {
            if (error || response.statusCode !== 200) {
                throw Error('couldn t get events from UfcInfoCom ');
            }

            try {
                var arrEvents = JSON.parse(body);

            } catch (e) {
                throw Error('couldn t get fixtures from UfcInfoCom');
            }
            if (arrEvents.length == 0) {
                throw Error('events array empty, couldn t get events from UfcInfoCom');
            }

            arrEvents = arrEvents.upcomingEvents.concat(arrEvents.pastEvents);

            //console.log(JSON.stringify(arrEvents) + "\n\n\n");
            arrEvents.forEach(function(event) {

                request({
                    url: 'http://www.ufc-info.com/event/' + event.id
                }, function(error, response, body) {

                    if (error || response.statusCode !== 200) {
                        throw Error('couldn t get event ' + event.id + 'from UfcInfoCom ');
                    }
                    try {
                        var arrEvent = JSON.parse(body);

                    } catch (e) {
                        throw Error('couldn t get events from UfcInfoCom');
                    }

                    console.log("reading event " + event.id + "\n\n\n");

                    var arrGames = arrEvent.matchups.map(matchup => {
                        if (matchup.fighter1_last_name) {
                            let fighter1Name = matchup.fighter1_first_name.concat(' ', matchup.fighter1_last_name);
                            let fighter2Name = matchup.fighter2_first_name.concat(' ', matchup.fighter2_last_name);
                            return {
                                homeTeam: fighter1Name,
                                awayTeam: fighter2Name,
                                date: moment.utc(event.date),
								localDate: moment.utc(event.date),
                                urlResult: 'http://www.ufc-info.com/event' + event.id + "/" + matchup.id,
                                feedName: fighter1Name.replace(/\s/g, '').toUpperCase() + '_' + fighter2Name.replace(/\s/g, '').toUpperCase() + '_' + moment.utc(event.date).format("YYYY-MM-DD")
                            }
                        }
                    });
                    calendar[category][keyWord].feedNames = {};
                    arrGames.forEach(function(game) {
                        if (typeof game === 'object') {
                            calendar[category][keyWord].feedNames[game.feedName] = game;
                        }

                    });
                    calendar[category][keyWord].resultHelper = function(url) {

                    };

                    console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");
                });
            });

        }

    );

}
*/

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
