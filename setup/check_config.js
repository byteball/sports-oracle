"use strict";
const request = require('request');
const fs = require('fs');
const async = require('async');
const PATH = require('path');

checkTheScoreTeamsCorrespondence();

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