/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const calendar = require('./calendar.js');
const conf = require('byteballcore/conf.js');
const commons = require('./commons.js');
const notifications = require('./notifications.js');

var reloadInterval = 1000*3600*24;
var blackListedChampionships=[466];


function getAllChampionshipsAndPushIntoCalendar(){

	getCurrentChampionshipsFromFootballDataOrg(blackListedChampionships,function(arrCurrentChampionShips) {
		arrCurrentChampionShips.forEach(function(currentChampionShip) {
			initFootballDataOrg(currentChampionShip.category, currentChampionShip.championship, currentChampionShip.url);
		});
	});

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
					championship: competition.league,
					url: competition._links.fixtures.href.replace('http:', 'https:')
				});
			}
		});
		handle(arrCompetitions);
	});

}


function initFootballDataOrg(category, championship, url) {

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
	
	calendar.addResultHelper(category, championship, resultHelper);
	
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
						return notifications.notifyAdmin("I couldn't get " + championship + " calendar today", "");
					}
				}

				try {
					var jsonResult = JSON.parse(body);
					var arrRawFixtures = jsonResult.fixtures;
				} catch (e) {
					if (firstCalendarLoading) {
						throw Error('error parsing football-data response: ' + e.toString() + ", response: " + body);
					} else {
						return notifications.notifyAdmin("I couldn't parse " + championship + " today", "");
					}
				}
				if (arrRawFixtures.length == 0) {
					if (firstCalendarLoading) {
						throw Error('fixtures array empty, couldn t get fixtures from footballDataOrg');
					} else {
						return notifications.notifyAdmin("I couldn't get fixtures from " + championship + " today", "");
					}
				}


				var arrFixtures = arrRawFixtures.map(fixture => {
					return encodeFixture(fixture);
				});
				calendar.setReloadingFlag(championship, true);
				calendar.deleteAllFixturesFromChampionship(championship);
			
				arrFixtures.forEach(function(fixture) {
					if (fixture.date.diff(moment(),'days') > -15 && fixture.date.diff(moment(),'days') < 30){
						calendar.addFixture(category, championship, fixture.feedName, fixture);
					}
				});
				calendar.setReloadingFlag(championship, false);
				firstCalendarLoading = false;
			}

		);
	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}


exports.getAllChampionshipsAndPushIntoCalendar = getAllChampionshipsAndPushIntoCalendar;