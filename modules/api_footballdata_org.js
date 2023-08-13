/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const calendar = require('./calendar.js');
const conf = require('ocore/conf.js');
const commons = require('./commons.js');
const notifications = require('./notifications.js');
const abbreviations = require('sport-abbreviations');

var reloadInterval = 1000*3600*24;


function getFixturesAndPushIntoCalendar(category, championship, url) {

	var headers = {
		'X-Auth-Token': conf.footballDataApiKey
	};

	var firstCalendarLoading = true;
	
	var resultHelper = {};
	resultHelper.headers = headers;
	resultHelper.hoursToWaitBeforeGetResult = 4;
	resultHelper.rules = "The oracle will post the name of winning team after 90 minutes play. This includes added injury or stoppage time but doesn't include extra-time, penalty shootouts or golden goal. If the match is rescheduled to another day, no result will be posted.";
	resultHelper.process = function(response, expectedFeedName, handle) {
		if (response.status)
			var match = response;
		 else if (response.match)
			var match = response.match;
		 else
			return handle('Wrong format of data');

		let fixture = encodeFixture(championship, match);
		if (!fixture)
			return handle("Couldn't encode fixture");
		if (match.status == "FINISHED") {
			if (match.score && match.score.fullTime.home != null) {

				if (fixture.feedName === expectedFeedName){
					if (Number(match.score.fullTime.away) > Number(match.score.fullTime.home)) {
						fixture.winner = fixture.awayTeam;
						fixture.winnerCode = fixture.feedAwayTeamName;
					}
					if (Number(match.score.fullTime.away) < Number(match.score.fullTime.home)) {
						fixture.winner = fixture.homeTeam;
						fixture.winnerCode = fixture.feedHomeTeamName;
					}
					if (Number(match.score.fullTime.away) == Number(match.score.fullTime.home)) {
						fixture.winner = 'draw';
						fixture.winnerCode = 'draw';
					}
					return handle(null, fixture);
					
					} else {
						return handle('The feedname is not the expected one, feedname found: ' + fixture.feedName);	
					}
			} else {
				return handle('No result in response');
			}
				
		} else if (match.status == "POSTPONED" || match.status == "CANCELLED" ||  match.status == "CANCELED"){
			fixture.winner = 'canceled';
			fixture.winnerCode = 'canceled';
			return handle(null, fixture);
		} else {
			return handle('Fixture is not finished');
		}
		
	};
	
	calendar.addResultHelper(category, championship, resultHelper);
	
	function encodeFixture(championship, fixture) {
		let feedHomeTeamName = commons.convertPrimaryTeamIdToFeedName('soccer', fixture.homeTeam.id);
		let feedAwayTeamName = commons.convertPrimaryTeamIdToFeedName('soccer', fixture.awayTeam.id);
		if (!feedHomeTeamName ||!feedAwayTeamName)
			return null;
		let localDay = moment.utc(fixture.utcDate);
		if (fixture.season.id == 2013){ //for bresil championship we convert UTC time to local time approximately
			localDay.subtract(4, 'hours');
		}
		return {
			homeTeam: abbreviations['soccer'][fixture.homeTeam.id].name,
			awayTeam: abbreviations['soccer'][fixture.awayTeam.id].name,
			feedHomeTeamName: feedHomeTeamName,
			feedAwayTeamName: feedAwayTeamName,
			feedName: championship + '_' + feedHomeTeamName + '_' + feedAwayTeamName + '_' + localDay.format("YYYY-MM-DD"),
			urlResult: "https://api.football-data.org/v4/matches/"+ fixture.id,
			date: moment.utc(fixture.utcDate),
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
						throw Error('couldn t get fixtures from footballDataOrg ' + url + '\n' + body);
					} else {
						return notifications.notifyAdmin("I couldn't get " + championship + " calendar today", "");
					}
				}

				try {
					var jsonResult = JSON.parse(body);
					var arrRawFixtures = jsonResult.matches;
				} catch (e) {
					if (firstCalendarLoading) {
						throw Error('error parsing football-data response to ' + url + ': ' + e.toString() + ", response: " + body);
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

				var arrFixtures = arrRawFixtures.filter(fixture =>{
					return fixture.status != "POSTPONED" && fixture.status != "CANCELLED" && fixture.status != "CANCELED";
				}).map(fixture => {
					return encodeFixture(championship, fixture);
				});
				calendar.setReloadingFlag(championship, true);
				calendar.deleteAllFixturesFromChampionship(championship);
			
				arrFixtures.forEach(function(fixture) {
					if (fixture && fixture.date.diff(moment(),'days') > -15 && fixture.date.diff(moment(),'days') < 30){
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


exports.getFixturesAndPushIntoCalendar = getFixturesAndPushIntoCalendar;