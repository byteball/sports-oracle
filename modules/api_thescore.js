/*jslint node: true */
"use strict";
const moment = require('moment');
const request = require('request');
const calendar = require('./calendar.js');
const fs = require("fs");
const notifications = require('./notifications.js');

var soccerTeamsCorrespondence = {}
fs.readFile('./soccerTeamsCorrespondence.json', (err, content) => {
	if (err)
		throw Error("Could'nt read soccerTeamsCorrespondence.json" + err);
	soccerTeamsCorrespondence= JSON.parse(content);
});

function canCheckChampionship(championship){
	if (championship == 'NBA' || championship == 'MLB' || championship == 'NHL' || championship == 'NFL' || soccerTeamsCorrespondence[championship])
		return true;
	return false;
	
}


function checkResult(championship, feedName, UTCdate, result, callbacks) {

	function findAndCheckFixture(arrayEventIds) {
		if (arrayEventIds.length == 0) {
			notifications.notifyAdmin("arrayEventIds empty when checking " + feedName, ' ');
			return callbacks.ifCriticalError();
		}
		request({
			url: 'https://api.thescore.com/' + theScoreKeyURL + '/events/' + arrayEventIds[0]
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) 
				return callbacks.ifError();
			
			try {
				var parsedBody = JSON.parse(body);

			} catch (e) {
				notifications.notifyAdmin("Result for event id " + arrayEventIds[0] + " can't be parsed from thescore.com", body);
				return callbacks.ifCriticalError();
			}

			if (parsedBody.status && (parsedBody.status == "final" || parsedBody.status == "postponed")) {
				
				if (soccerTeamsCorrespondence[championship]){
					if (soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name] && soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name]){
						var feedHomeTeamName = soccerTeamsCorrespondence[championship][parsedBody.home_team.full_name];
						var feedAwayTeamName = soccerTeamsCorrespondence[championship][parsedBody.away_team.full_name];
					} else {
						notifications.notifyAdmin("Couldn't find a correspondence for " + feedName + " from thescore", ' ');
						return callbacks.ifCriticalError();
					}
				} else {
					var feedHomeTeamName = parsedBody.home_team.full_name.replace(/\s/g, '').toUpperCase();
					var feedAwayTeamName = parsedBody.away_team.full_name.replace(/\s/g, '').toUpperCase();
				}
				
				if (feedHomeTeamName === feedName.split("_")[0] && feedAwayTeamName == feedName.split("_")[1] 
					&& moment(parsedBody.game_date).isSameOrAfter(UTCdate.subtract(1, 'hours')) && moment(parsedBody.game_date).isSameOrBefore(UTCdate.add(3, 'hours'))) {

					if (parsedBody.status == "postponed") {
						notifications.notifyAdmin(feedName + " has been postponed", ' ');
						return callbacks.ifPostponed();
					}
					
					if (parsedBody.box_score.score.home.score > parsedBody.box_score.score.away.score && result == feedHomeTeamName) {
						return callbacks.ifOK();
					}
					if (parsedBody.box_score.score.home.score < parsedBody.box_score.score.away.score && result == feedAwayTeamName) {
						return callbacks.ifOK();
					}
					if (parsedBody.box_score.score.home.score == parsedBody.box_score.score.away.score && result == 'draw') {
						return callbacks.ifOK();
					}

					return callbacks.ifFailedCheck();

				}
			}

			if (arrayEventIds.length > 1) {
				return findAndCheckFixture(arrayEventIds.splice(1));
			} else {
				notifications.notifyAdmin("Couldn't check " + feedName + " from thescore", ' ');
				return callbacks.ifCriticalError();

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
		if (error || response.statusCode !== 200) 
			return callbacks.ifError();

		try {
			var parsedBody = JSON.parse(body);

		} catch (e) {
			notifications.notifyAdmin("Result for " + feedName + " can't be parsed from thescore.com" + "\n" + body);
			return callbacks.ifCriticalError();
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
				return callbacks.ifCriticalError();
			}


		} else {
			notifications.notifyAdmin("Wrong JSON format from thescore.com for " + championship, JSON.stringify(parsedBody));
			return callbacks.ifError();

		}


	});

}

exports.checkResult = checkResult;
exports.canCheckChampionship = canCheckChampionship;