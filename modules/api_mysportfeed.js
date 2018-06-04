/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const btoa = require('btoa');
const conf = require('byteballcore/conf.js');
const calendar = require('./calendar.js');
const notifications = require('./notifications.js');

var reloadInterval = 1000*3600*24;


function getFixturesAndPushIntoCalendar (category, championship, url) {

	var headers = {
		"Authorization": "Basic " + btoa(conf.MySportsFeedsUser + ":" + conf.MySportsFeedsPw)
	};

	var firstCalendarLoading = true;

	//there are several different resultHelper function depending of sport

	var resultHelper = {};
	resultHelper.headers = headers;
	if (url.indexOf('mlb') > -1) {
		resultHelper.hoursToWaitBeforeGetResult = 6;
		resultHelper.rules = "The oracle will post the name of winning team. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		resultHelper.process = function(response, expectedFeedName, handle) {
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
		resultHelper.hoursToWaitBeforeGetResult = 6;
		resultHelper.rules = "The oracle will post the name of winning team. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		resultHelper.process = function(response, expectedFeedName, handle) {
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
		resultHelper.hoursToWaitBeforeGetResult = 6;
		resultHelper.rules = "The oracle will post the name of winning team for 3 x 20 minutes periods plus overtime/shootouts. If the match is interrupted, the team with the higher score at time of interruption will be posted. If the match is rescheduled to another day, no result will be posted.";
		resultHelper.process = function(response, expectedFeedName, handle) {
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

	calendar.addResultHelper(category, championship, resultHelper);

	
	function convertMySportsFeedsTimeToMomentUTC(mySportsFeedsDate, mySportsFeedsTime) {
		let UtcDate = moment.utc(mySportsFeedsDate + ' ' + mySportsFeedsTime,'YYYY-MM-DD hh:mma');
		if (calendar.isAmericanDST()){
			UtcDate.add(4, 'hours');
		}else{
			UtcDate.add(5, 'hours');
		}
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
			localDay: moment.utc(fixture.date)
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
					return notifications.notifyAdmin("I couldn't get " + championship + " calendar today", "");
				}
			}

			try {
				var parsedBody = JSON.parse(body);
			} catch (e) {
				if (firstCalendarLoading) {
					throw Error("Couldn't parse  footballDataOrg, error: " + e);
				} else {
					return notifications.notifyAdmin("I couldn't parse " + championship + "calendar today", "");
				}
			}
			var arrRawFixtures = parsedBody.fullgameschedule.gameentry;

			if (arrRawFixtures.length == 0) {
				if (firstCalendarLoading) {
					throw Error("fixtures array empty, couldn't get fixtures from footballDataOrg");
				} else {
					return notifications.notifyAdmin("I couldn't get fixtures for " + championship + " today", "");
				}
			}


			var arrFixtures = arrRawFixtures.map(fixture => {
				return encodeFixture(fixture);

			});
			calendar.setReloadingFlag(championship, true);
			calendar.deleteAllFixturesFromChampionship(championship);
			arrFixtures.forEach(function(fixture) {
				if (typeof fixture === 'object') {
					if (fixture.date.diff(moment(),'days') > -15 && fixture.date.diff(moment(),'days') < 30){
						
						if (calendar.getFixtureFromFeedName(fixture.feedName)){	//if feedname already in calendar then it's a doubleheaders, we need to differentiate the fixture
							var initialFeedName = fixture.feedName;
							if (calendar.getFixtureFromFeedName(fixture.feedName).date.isBefore(fixture.date)){
								calendar.addFixture(category,championship,initialFeedName + "_G1",calendar.getFixtureFromFeedName(initialFeedName));
								calendar.addFixture(category,championship,initialFeedName + "_G2",fixture);
							}else{
								
								calendar.addFixture(category,championship,initialFeedName + "_G1",fixture);
								calendar.addFixture(category,championship,initialFeedName + "_G2",calendar.getFixtureFromFeedName(initialFeedName));
							}
							calendar.deleteFixture(initialFeedName);
						} else {
							calendar.addFixture(category, championship, fixture.feedName, fixture)
						}
					}
				}
			});

			calendar.setReloadingFlag(championship, false);
			firstCalendarLoading = false;
		});

	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}

exports.getFixturesAndPushIntoCalendar = getFixturesAndPushIntoCalendar;