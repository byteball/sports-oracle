/*jslint node: true */
"use strict";
const request = require('request');
const conf = require('ocore/conf.js');
const fs = require('fs');

var headers = {
	'X-Auth-Token': conf.footballDataApiKey
};

var arrCompetitions = ['fran', 'bund', 'epl', 'liga', 'seri','chlg'];

var assocFullNames = {};

getCompetitionsSequentially(arrCompetitions);

function getCompetitionsSequentially(array) {
	request({
		url: "https://api.thescore.com/" + array[0] + "/teams",
		headers: headers
	}, function(error, response, body) {
		console.log(body);
		if (!error) {
			console.log("\nParsing competition id :" + array[0]);
			var parsedBody = JSON.parse(body);
			parsedBody.forEach(function(team) {
				if (team.full_name){
					if (!assocFullNames[array[0]])
						assocFullNames[array[0]] = [];
					assocFullNames[array[0]].push(team.full_name);
				}
			});
			array.shift();
			if (array[0]) {
				setTimeout(function() {
					getCompetitionsSequentially(array)
				}, 200);

			} else {
				fs.writeFile("theScoreFullNames.json", JSON.stringify(assocFullNames,null,'\t'), (err) => {
					if (err)
						throw Error("Could'nt write soccerFeedNames.json" + err);
				});
			}
		} else {
			throw Error("couldn t get competition id " + array[0] + "\n" + " " + error);
		}
	});

}