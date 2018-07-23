/*jslint node: true */
"use strict";
const request = require('request');
const conf = require('byteballcore/conf.js');
const fs = require('fs');

var headers = {
	'X-Auth-Token': conf.footballDataApiKey
};

var arrCompetitions = [2001, 2013, 2015];

var assocConversions = {};



getCompetitionsSequentially(arrCompetitions);

function getCompetitionsSequentially(array) {
	request({
		url: "https://api.football-data.org/v2/competitions/" + array[0] + "/teams",
		headers: headers
	}, function(error, response, body) {
		console.log(body);
		if (!error) {
			console.log("\nParsing competition id :" + array[0]);
			var parsedBody = JSON.parse(body);
			parsedBody.teams.forEach(function(team) {
				assocConversions[team.id] = team.shortName;
			});
			array.shift();
			if (array[0]) {
				setTimeout(function() {
					getCompetitionsSequentially(array, 200)
				});

			} else {
				fs.writeFile("soccerShortNames.json", JSON.stringify(assocConversions), (err) => {
					if (err)
						throw Error("Could'nt write NamesToShortNames.json" + err);;
				});
			}
		} else {
			throw Error("couldn t get competition id " + array[0] + "\n" + " " + error);
		}
	});

}