/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const calendar = require('./calendar.js');
const notifications = require('./notifications.js');

var reloadInterval = 1000*3600*24;


function getFixturesAndPushIntoCalendar(category, championship) {

	var firstCalendarLoading = true;
	var resultHelper = {};
	resultHelper.hoursToWaitBeforeGetResult = 12;
	resultHelper.rules = "The oracle will post the name of winner. In case the match is a draw or has been rescheduled to another event, no result will be posted.";
	resultHelper.process = function(response, expectedFeedName, handle) {
		var fightFound = false;
		response.forEach(function(fight) {
			let fixture = encodeOnlyNames(fight);

			if (fixture && expectedFeedName.indexOf(fixture.feedName) > -1) {
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

	calendar.addResultHelper(category, championship, resultHelper);
	
	function encodeOnlyNames(fight) {
		if (fight.fighter1_first_name && fight.fighter2_first_name && typeof fight.fighter1_first_name == "string" && typeof fight.fighter2_first_name == "string"){
			let feedHomeTeamName = fight.fighter1_first_name.concat(fight.fighter1_last_name).toUpperCase();
			let feedAwayTeamName = fight.fighter2_first_name.concat(fight.fighter2_last_name).toUpperCase();
			return {
				homeTeam: fight.fighter1_first_name + " " + fight.fighter1_last_name,
				awayTeam: fight.fighter2_first_name + " " + fight.fighter2_last_name,
				feedHomeTeamName: feedHomeTeamName,
				feedAwayTeamName: feedAwayTeamName,
				feedName: feedHomeTeamName + '_' + feedAwayTeamName
			}
		} else {
			return null;
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
					return notifications.notifyAdmin("I couldn't get " + championship + " events today", "");
				}
			}

			try {
				var events = JSON.parse(body);
			} catch (e) {
				if (firstCalendarLoading) {
					throw Error('error parsing UFC events response: ' + e.toString() + ", response: " + body);
				} else {
					return notifications.notifyAdmin("I couldn't parse " + championship + " today", "");
				}
			}
			if (events.length == 0) {
				if (firstCalendarLoading) {
					throw Error('events array empty, couldn t get events from footballDataOrg');
				} else {
					return notifications.notifyAdmin("I couldn't get events from " + championship + " today", "");
				}
			}
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
							var parsedBody = JSON.parse(eventBody);
						} catch (e) {
							if (firstCalendarLoading) {
								throw Error('error parsing UFC fights, response: ' + e.toString() + ", response: " + eventBody);
							} else {
								return notifications.notifyAdmin("I couldn't parse " + championship + " today", "");
							}
						}

						if (parsedBody.length == 0) {
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

						if (calendar.isAmericanDST()) {
							timeShift--;
						}
						timeShift -= 2; // event can begin 2 hours before announced time due to preliminary fights

						var UTCtime = moment.utc(eventDate.format("YYYY-MM-DD") + ' ' + arrayLocalTimes[0], ['YYYY-MM-DD hha', 'YYYY-MM-DD hh:mma']);
						UTCtime.add(timeShift, 'hours');

						var arrFixtures = parsedBody.map(fight => {
							let feedNameObject = encodeOnlyNames(fight);
							if (feedNameObject){
								feedNameObject.feedName += '_' + eventDate.format("YYYY-MM-DD");
								feedNameObject.localDay = eventDate;
								feedNameObject.date = UTCtime;
								feedNameObject.urlResult = 'http://ufc-data-api.ufc.com/api/v3/iphone/events/' + event.id + '/fights';
								return feedNameObject;
							}
						});
						calendar.setReloadingFlag(championship, true);
						calendar.deleteAllFixturesFromChampionship(championship);
						arrFixtures.forEach(function(fixture) {
							if (fixture)
							calendar.addFixture(category, championship, fixture.feedName, fixture);
						});
						calendar.setReloadingFlag(championship, false);
						firstCalendarLoading = false;

					});

				}
			});


		});
	}

	loadInCalendar();
	setInterval(loadInCalendar, reloadInterval);
}

exports.getFixturesAndPushIntoCalendar= getFixturesAndPushIntoCalendar;