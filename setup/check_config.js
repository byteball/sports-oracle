"use strict";
const abbreviations = require('../config/abbreviations.json');
const request = require('request');
const conf = require('ocore/conf.js');
const fs = require('fs');
const async = require('async');
const PATH = require('path');
const { soccerCompetitions } = require('../soccerCompetitions');

checkSoccerCompetitionsSequentially(soccerCompetitions);
checkTheScoreTeamsCorrespondence();

async function checkSoccerCompetitionsSequentially(array) {
	var arrMissingAbbreviations = [];
	request({
		url: "https://api.football-data.org/v2/competitions/" + array[0] + "/teams",
		headers: {
			'X-Auth-Token': conf.footballDataApiKey
		}
	}, function(error, response, body) {
		if (!error && response.statusCode == 200) {
			console.log("\nParsing football-data.org for competition id :" + array[0]);
			var parsedBody = JSON.parse(body);
			parsedBody.teams.forEach(function(team) {
				if(!abbreviations.soccer[team.id]){
					abbreviations.soccer[team.id] = {
						abbreviation: "",
						name: team.name
					};
					arrMissingAbbreviations.push(team.name);
				} else {
					if (!abbreviations.soccer[team.id].abbreviation || abbreviations.soccer[team.id].abbreviation.length == 0)
						arrMissingAbbreviations.push(team.name);
				}
			});

			array.shift();
			if (array[0]) {
				setTimeout(function() {
					checkSoccerCompetitionsSequentially(array)
				}, 500);

			} else {
				fs.writeFile(PATH.resolve(__dirname + "../../config/abbreviations.json"), JSON.stringify(abbreviations,null,'\t'), (err) => {
					if (err)
						throw Error("Could'nt write ../config/abbreviations.json" + err);
					if(arrMissingAbbreviations.length > 0) {
						console.log("Missing abbreviations:")
						arrMissingAbbreviations.forEach(function(teamName){
							console.log(teamName);
						});
						console.log("modify 'config/abbreviations.json' to add them");
					} else {
						console.log("'config/abbreviations.json' is complete");
					}
				});
			}
		} else {
			throw Error("couldn t get competition id " + array[0] + "\n" + " " + error);
		}
	});

}


function checkTheScoreTeamsCorrespondence(){

	var theScoreTeamsCorrespondence = require("../config/theScoreSoccerTeamsCorrespondence.json");
	var leagues = Object.keys(theScoreTeamsCorrespondence);
	var arrMissingTeams = []

	async.each(leagues, function(league, cb){
		if (league == "_comment")
			return cb();
		request({
			url: 'https://api.thescore.com/' + theScoreTeamsCorrespondence[league].theScoreKeyURL + '/teams'
		}, 
		function(error, response, body) {
			if (error || response.statusCode !== 200) {
				console.error(`thescore request error: couldn t get theScore ${league} league`, error);
				return cb();
			} 

			console.log("\nParsing the Score team for competition :" + league);
			var parsedBody = JSON.parse(body);

			parsedBody.forEach(function(team){
				
				if (!theScoreTeamsCorrespondence[league][team.full_name]){
					theScoreTeamsCorrespondence[league][team.full_name] = "";
					arrMissingTeams.push(team.full_name);
				} else if (theScoreTeamsCorrespondence[league][team.full_name].length === 0){
					arrMissingTeams.push(team.full_name);
				}
			});
			return cb();
		});
	},
	function(){
		fs.writeFile(PATH.resolve(__dirname + "../../config/theScoreSoccerTeamsCorrespondence.json"), JSON.stringify(theScoreTeamsCorrespondence,null,'\t'), (err) => {
			if (err)
				throw Error("Could'nt write ./config/theScoreSoccerTeamsCorrespondence.json" + err);

			if (arrMissingTeams.length === 0){
				console.log("'../config/theScoreSoccerTeamsCorrespondence.json' is complete.")
			} else {
				console.log("missing teams: ");
				arrMissingTeams.forEach(function(teamName){
					console.log(teamName);
				});
				console.log("modify '../config/theScoreSoccerTeamsCorrespondence.json' to add them");
			}
		});
	});
}