/*jslint node: true */
"use strict";
const request = require('request');
const conf = require('ocore/conf.js');
const fs = require('fs');
const commons = require('../modules/commons.js');
const { soccerCompetitions } = require('abbreviations/soccerCompetitions')
var headers = {
	'X-Auth-Token': conf.footballDataApiKey
};

var assocConversions = {};
var assocFeednames = {};

getCompetitionsSequentially(soccerCompetitions);

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
				if (team.shortName){
					assocConversions[team.id] = team.shortName;
					let feedname = commons.removeAbbreviations(team.shortName).replace(/[()']/g, '').replace(/\s/g, '').toUpperCase();
					if (!assocFeednames[array[0]])
						assocFeednames[array[0]] = [];
					assocFeednames[array[0]].push(feedname);
				}
			});
			array.shift();
			if (array[0]) {
				setTimeout(function() {
					getCompetitionsSequentially(array)
				}, 200);

			} else {
				fs.writeFile("./soccerShortNames.json", JSON.stringify(assocConversions,null,'\t'), (err) => {
					if (err)
						throw Error("Could'nt write soccerShortNames.json" + err);
				});
				fs.writeFile("soccerFeedNames.json", JSON.stringify(assocFeednames,null,'\t'), (err) => {
					if (err)
						throw Error("Could'nt write soccerFeedNames.json" + err);
				});
			}
		} else {
			throw Error("couldn t get competition id " + array[0] + "\n" + " " + error);
		}
	});

}