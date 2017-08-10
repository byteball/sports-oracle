/*jslint node: true */
"use strict";
var moment = require('moment');
var request = require('request');
var _ = require('lodash');
var conf = require('byteballcore/conf.js');
var db = require('byteballcore/db.js');
var eventBus = require('byteballcore/event_bus.js');
var headlessWallet = require('headless-byteball');
var desktopApp = require('byteballcore/desktop_app.js');
var objectHash = require('byteballcore/object_hash.js');
var notifications = require('./notifications.js');
var btoa = require('btoa');
var calendar = {};
var arrPeers = [];




//------The differents feeds are added to the calendar
//------The 2 first arguments specify category and keyword
initMySportsFeedsCom('Baseball', 'MLB', 'https://api.mysportsfeeds.com/v1.1/pull/mlb/2017-regular/');
initMySportsFeedsCom('Basketball', 'NBA', 'https://api.mysportsfeeds.com/v1.1/pull/nba/2016-2017-regular/');
initMySportsFeedsCom('American football', 'NFL', 'https://api.mysportsfeeds.com/v1.1/pull/nfl/2017-regular/');
initMySportsFeedsCom('Ice hockey', 'NHL', 'https://api.mysportsfeeds.com/v1.1/pull/nhl/2017-2018-regular/');
//initUfcInfoCom('Mixed Martial Arts', 'UFC');


getCurrentChampionShipsFromfootballDataOrg(function(arrCurrentChampionShips) {
    arrCurrentChampionShips.forEach(function(currentChampionShip) {
        initFootballDataOrg(currentChampionShip.category, currentChampionShip.keyword, currentChampionShip.url);
    });
});

if (conf.bRunWitness)
	require('byteball-witness');

const RETRY_TIMEOUT = 5*60*1000;
var assocQueuedDataFeeds = {};
var assocDeviceAddressesByFeedName = {};

const WITNESSING_COST = 600; // size of typical witnessing unit
var my_address;
var count_witnessings_available = 0;

if (!conf.bSingleAddress)
	throw Error('oracle must be single address');

if (!conf.bRunWitness)
	headlessWallet.setupChatEventHandlers();

// this duplicates witness code if we are also running a witness
function readNumberOfWitnessingsAvailable(handleNumber){
	count_witnessings_available--;
	if (count_witnessings_available > conf.MIN_AVAILABLE_WITNESSINGS)
		return handleNumber(count_witnessings_available);
	db.query(
		"SELECT COUNT(*) AS count_big_outputs FROM outputs JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0", 
		[my_address, WITNESSING_COST], 
		function(rows){
			var count_big_outputs = rows[0].count_big_outputs;
			db.query(
				"SELECT SUM(amount) AS total FROM outputs JOIN units USING(unit) \n\
				WHERE address=? AND is_stable=1 AND amount<? AND asset IS NULL AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM witnessing_outputs \n\
				WHERE address=? AND is_spent=0 \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM headers_commission_outputs \n\
				WHERE address=? AND is_spent=0", 
				[my_address, WITNESSING_COST, my_address, my_address], 
				function(rows){
					var total = rows.reduce(function(prev, row){ return (prev + row.total); }, 0);
					var count_witnessings_paid_by_small_outputs_and_commissions = Math.round(total / WITNESSING_COST);
					count_witnessings_available = count_big_outputs + count_witnessings_paid_by_small_outputs_and_commissions;
					handleNumber(count_witnessings_available);
				}
			);
		}
	);
}


// make sure we never run out of spendable (stable) outputs. Keep the number above a threshold, and if it drops below, produce more outputs than consume.
function createOptimalOutputs(handleOutputs){
	var arrOutputs = [{amount: 0, address: my_address}];
	readNumberOfWitnessingsAvailable(function(count){
		if (count > conf.MIN_AVAILABLE_WITNESSINGS)
			return handleOutputs(arrOutputs);
		// try to split the biggest output in two
		db.query(
			"SELECT amount FROM outputs JOIN units USING(unit) \n\
			WHERE address=? AND is_stable=1 AND amount>=? AND asset IS NULL AND is_spent=0 \n\
			ORDER BY amount DESC LIMIT 1", 
			[my_address, 2*WITNESSING_COST],
			function(rows){
				if (rows.length === 0){
					notifications.notifyAdminAboutPostingProblem('only '+count+" spendable outputs left, and can't add more");
					return handleOutputs(arrOutputs);
				}
				var amount = rows[0].amount;
			//	notifications.notifyAdminAboutPostingProblem('only '+count+" spendable outputs left, will split an output of "+amount);
				arrOutputs.push({amount: Math.round(amount/2), address: my_address});
				handleOutputs(arrOutputs);
			}
		);
	});
}



////////


function postDataFeed(datafeed, onDone){
	function onError(err){
		notifications.notifyAdminAboutFailedPosting(err);
		onDone(err);
	}
	var network = require('byteballcore/network.js');
	var composer = require('byteballcore/composer.js');
	createOptimalOutputs(function(arrOutputs){
		let params = {
			paying_addresses: [my_address], 
			outputs: arrOutputs, 
			signer: headlessWallet.signer, 
			callbacks: composer.getSavingCallbacks({
				ifNotEnoughFunds: onError,
				ifError: onError,
				ifOk: function(objJoint){
					network.broadcastJoint(objJoint);
					onDone();
				}
			})
		};
		if (conf.bPostTimestamp)
			datafeed.timestamp = Date.now();
		let objMessage = {
			app: "data_feed",
			payload_location: "inline",
			payload_hash: objectHash.getBase64Hash(datafeed),
			payload: datafeed
		};
		params.messages = [objMessage];
		composer.composeJoint(params);
	});
}

function reliablyPostDataFeed(datafeed, device_address){
	var feed_name, feed_value;
	for(var key in datafeed){
		feed_name = key;
		feed_value = datafeed[key];
		break;
	}
	if (!feed_name)
		throw Error('no feed name');
	if (device_address){
		if (!assocDeviceAddressesByFeedName[feed_name])
			assocDeviceAddressesByFeedName[feed_name] = {addresses: [device_address], value: feed_value};
		else
			assocDeviceAddressesByFeedName[feed_name].addresses.push(device_address);
	}
	if (assocQueuedDataFeeds[feed_name]) // already queued
		return console.log(feed_name+" already queued");
	assocQueuedDataFeeds[feed_name] = datafeed;
	var onDataFeedResult = function(err){
		if (err){
			console.log('will retry posting the data feed later');
			setTimeout(function(){
				postDataFeed(datafeed, onDataFeedResult);
			}, RETRY_TIMEOUT + Math.round(Math.random()*3000));
		}
		else
			delete assocQueuedDataFeeds[feed_name];
	};
	postDataFeed(datafeed, onDataFeedResult);
}


function readExistingData(feed_name, device_address, handleResult){
	if (assocQueuedDataFeeds[feed_name]){
		assocDeviceAddressesByFeedName[feed_name].addresses.push(device_address);
		return handleResult(true, 0, assocDeviceAddressesByFeedName[feed_name].value);
	}
	db.query(
		"SELECT feed_name, is_stable, value \n\
		FROM data_feeds CROSS JOIN unit_authors USING(unit) CROSS JOIN units USING(unit) \n\
		WHERE address=? AND feed_name=?", 
		[my_address, feed_name],
		function(rows){
			if( rows.length === 0)
				return handleResult(false);
			if (rows.length > 1)
				notifications.notifyAdmin(rows.length+' entries for feed', feed_name);
			if (!rows[0].is_stable){
				if (!assocDeviceAddressesByFeedName[feed_name])
					assocDeviceAddressesByFeedName[feed_name] = {addresses: [device_address], value: rows[0].value};
				else
					assocDeviceAddressesByFeedName[feed_name].addresses.push(device_address);
			}
			return handleResult(true, rows[0].is_stable, rows[0].value);
		}
	);
}

function homeInstructions(){
	var instructions="Please choose a championship:\n";
	 for (var cat in calendar) {
		instructions+='\n---' + cat +'---\n'; 
		  for (var keyword in calendar[cat]){
			instructions+=txtCommandButton(keyword)+' ';   
		  }	 
	 }
	
	return instructions;
}
function championshipInstructions(championshipName) {
    return "------" + championshipName + "--------\n" + txtCommandButton("last") + " to list last games played\n" + txtCommandButton("coming") + " to list coming games \n" + txtCommandButton("cancel") + " to return home \n or write the name of the team you want to search";
}


function fixturesAfterNow(championship) {
    var txtReturn = '12 next games coming: \n';
    var bufferAfter = [];
    for (var feedName in championship) {
        if (moment.utc(championship[feedName].date).isAfter(moment())) {
            bufferAfter.push(championship[feedName].homeTeam + ' Vs. ' + championship[feedName].awayTeam + ":\n" + txtCommandButton(feedName));
        }
    }
	if (bufferAfter.length==0) {
	    txtReturn="No results found \n";
        return txtReturn;
	}
    txtReturn += bufferAfter.slice(0, 12).join('\n') + "\n" ;
    return txtReturn;
}

function fixturesBeforeNow(championship) {
    var txtReturn = '12 last games played: \n';
    var bufferBefore = [];
    for (var feedName in championship) {
        if (moment.utc(championship[feedName].date).isBefore(moment())) {
            bufferBefore.push(championship[feedName].homeTeam + ' Vs. ' + championship[feedName].awayTeam + ":\n" + txtCommandButton(feedName));
        }
    }
	if (bufferBefore.length==0) {
	    txtReturn="No results found  \n";
        return txtReturn;
	}
    txtReturn += bufferBefore.slice(-12).join('\n') + "\n" ;
    return txtReturn;
}

function searchFixtures(championship, search) {
    var txtReturn = '';
    var buffer = [];
    var now = moment();
    for (var feedName in championship) {
        if (removeAccents(championship[feedName].homeTeam).toUpperCase().indexOf(removeAccents(search).toUpperCase()) > -1 || removeAccents(championship[feedName].awayTeam).toUpperCase().indexOf(removeAccents(search).toUpperCase()) > -1) {
            buffer.push(championship[feedName].homeTeam + ' Vs. ' + championship[feedName].awayTeam + ":\n" + txtCommandButton(feedName));
        }
    }
	if (buffer.length==0) {
	txtReturn="No results found  \n";
    return txtReturn;
	}
    txtReturn += buffer.join('\n') + "\n";
    return txtReturn;
}


eventBus.on('paired', function(from_address){
	var device = require('byteballcore/device.js');
	device.sendMessageToDevice(from_address, 'text', homeInstructions());
});

eventBus.on('text', function(from_address, text) {
    var device = require('byteballcore/device.js');
    text = text.trim();
    let ucText = text.toUpperCase();

    if (!arrPeers[from_address]) {
        arrPeers[from_address] = {
            step: "home",
            cat: "none_yet",
        };
    }
    if (text == "cancel") {
        arrPeers[from_address].step = 'home';
    }

    if (calendar[arrPeers[from_address].cat] && arrPeers[from_address].step != 'home') {
        if (calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames[text]) {
            device.sendMessageToDevice(from_address, 'text', "feed name recognized");
            return;
        }
        if (text == "last") {
            device.sendMessageToDevice(from_address, 'text', fixturesBeforeNow(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames) + championshipInstructions(arrPeers[from_address].step));
            return;
        }
        if (text == "coming") {
            device.sendMessageToDevice(from_address, 'text', fixturesAfterNow(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames) + championshipInstructions(arrPeers[from_address].step));
            return;
        }
        device.sendMessageToDevice(from_address, 'text', "Search for " + text + " :\n" + searchFixtures(calendar[arrPeers[from_address].cat][arrPeers[from_address].step].feedNames, text) + championshipInstructions(arrPeers[from_address].step));
        return;
    }

    for (var cat in calendar) {
        if (calendar[cat][text]) {
            arrPeers[from_address].step = text;
            arrPeers[from_address].cat = cat;
            device.sendMessageToDevice(from_address, 'text', championshipInstructions(text));
            return;
        }

    }



    return device.sendMessageToDevice(from_address, 'text', homeInstructions());
});

function txtCommandButton(label, command) {
    var text = "";
    var _command = command ? command : label;
    text += "[" + label + "]" + "(command:" + _command + ")";
    return text;
}


function removeAbbreviations(text) {
	return text.replace(/\b(AC|ADO|AFC|AJ|AS|AZ|BSC|CF|EA|EC|ES|FC|FCO|FSV|GO|JC|LB|NAC|MSV|OGC|OSC|PR|RC|SC|PEC|PSV|SCO|SM|SV|TSG|US|VfB|VfL)\b/g, '').trim();
}

function removeAccents(str) {
  var accents    = 'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž';
  var accentsOut = "AAAAAAaaaaaaOOOOOOOooooooEEEEeeeeeCcDIIIIiiiiUUUUuuuuNnSsYyyZz";
  str = str.split('');
  var strLen = str.length;
  var i, x;
  for (i = 0; i < strLen; i++) {
    if ((x = accents.indexOf(str[i])) != -1) {
      str[i] = accentsOut[x];
    }
  }
  return str.join('');
}



function getResponseText(homeTeamName, awayTeamName, date, result, is_stable) {
    return removeAbbreviations(homeTeamName) + ' vs ' + removeAbbreviations(awayTeamName) + '\n' +
        'on ' + moment.utc(date).format("DD MMMM YYYY") + '\n' +
        (result === 'draw' ? 'draw' : result + ' won') +
        (is_stable ?
            "\n\nThe data is already in the database, you can unlock your smart contract now." :
            "\n\nThe data will be added into the database, I'll let you know when it is confirmed and you are able to unlock your contract.");
}


function getCurrentChampionShipsFromfootballDataOrg(handle) {
    var arrCompetitions = [];
    request({
        url: 'http://football-data.org/v1/competitions'
    }, function(error, response, body) {
        if (error || response.statusCode !== 200) {
            throw Error('couldn t get current championships from footballDataOrg');
        }

        var competitions = JSON.parse(body);
        competitions.forEach(function(competition) {
            arrCompetitions.push({
                category: 'Soccer',
                keyword: competition.league,
                url: competition._links.fixtures.href
            });
        });
        handle(arrCompetitions);
    });

}


function initFootballDataOrg(category, keyWord, url) {
    if (typeof calendar[category] === 'undefined') {
        calendar[category] = {};
    }
    if (typeof calendar[category][keyWord] === 'undefined') {
        calendar[category][keyWord] = {};
    }

    var headersRequest = {
        'X-Auth-Token': conf.footballDataApiKey

    };

    request({
            url: url,
            headers: headersRequest
        }, function(error, response, body) {
            if (error || response.statusCode !== 200) {
                throw Error('couldn t get fixtures from footballDataOrg ' + url);
            }

            try {
                var jsonResult = JSON.parse(body);
                var fixtures = jsonResult.fixtures;
            } catch (e) {
                //	notifications.notifyAdminAboutPostingProblem('error parsing football-data response: '+e.toString()+", response: "+body);
            }
            if (fixtures.length == 0) {
                throw Error('fixtures array empty, couldn t get fixtures from footballDataOrg');
            }
            var arrGames = fixtures.map(fixture => {
                let homeTeamName = removeAbbreviations(fixture.homeTeamName);
                let awayTeamName = removeAbbreviations(fixture.awayTeamName);
                let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
                let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
                return {
                    homeTeam: homeTeamName,
                    awayTeam: awayTeamName,
                    date: moment.utc(fixture.date),
                    urlResult: fixture._links.self.href,
                    feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + moment.utc(fixture.date).format("YYYY-MM-DD")
                }

            });

            calendar[category][keyWord].feedNames = {};
            arrGames.forEach(function(game) {
                calendar[category][keyWord].feedNames[game.feedName] = game;
            });

            calendar[category][keyWord].getResult = function(url) {

            };
            console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");

        }

    );
}




function initMySportsFeedsCom(category, keyWord, url) {

    if (typeof calendar[category] === 'undefined') {
        calendar[category] = {};
    }
    if (typeof calendar[category][keyWord] === 'undefined') {
        calendar[category][keyWord] = {};
    }

    request({
        url: url + "full_game_schedule.json",
        headers: {
            "Authorization": "Basic " + btoa(conf.MySportsFeedsUser + ":" + conf.MySportsFeedsPw)
        }
    }, function(error, response, body) {
        if (error || response.statusCode !== 200) {
            throw Error('couldn t get events from MySportsFeedsCom ' + url);
        }

        try {
            var jsonResult = JSON.parse(body);
            var fixtures = jsonResult.fullgameschedule.gameentry;
        } catch (e) {
            //	notifications.notifyAdminAboutPostingProblem('error parsing football-data response: '+e.toString()+", response: "+body);
        }
        if (fixtures.length == 0) {
            throw Error('fixtures array empty, couldn t get fixtures from footballDataOrg');
        }

        var arrGames = fixtures.map(fixture => {
            let homeTeamName = fixture.homeTeam.City + " " + fixture.homeTeam.Name;
            let awayTeamName = fixture.awayTeam.City + " " + fixture.awayTeam.Name;
            let feedHomeTeamName = homeTeamName.replace(/\s/g, '').toUpperCase();
            let feedAwayTeamName = awayTeamName.replace(/\s/g, '').toUpperCase();
            let fixtureDate = moment.utc(fixture.date);

            if (fixture.time.lastIndexOf('PM') > 0) {
                fixtureDate.add(12, 'hours');
            }
            fixture.time.replace('PM', '').replace('AM', '');
            fixture.time.split(':');
            fixtureDate.add(fixture.time[0], 'hours').add(fixture.time[1], 'minutes');
            fixtureDate.subtract(5, 'hours'); //EST to UTC time
            return {
                homeTeam: homeTeamName,
                awayTeam: awayTeamName,
                date: fixtureDate.utc(),
                urlResult: url + "game_boxscore.json?gameid=" + fixture.id,
                feedName: feedHomeTeamName + '_' + feedAwayTeamName + '_' + moment.utc(fixture.date).format("YYYY-MM-DD")
            }
        });

        calendar[category][keyWord].feedNames = {};
        arrGames.forEach(function(game) {
            if (typeof game === 'object') {
                calendar[category][keyWord].feedNames[game.feedName] = game;
            }
        });

        calendar[category][keyWord].getResult = function(url) {

        };

        console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");


    });

}


function initUfcInfoCom(category, keyWord) {
    if (typeof calendar[category] === 'undefined') {
        calendar[category] = {};
    }
    if (typeof calendar[category][keyWord] === 'undefined') {
        calendar[category][keyWord] = {};
    }

    request({
            url: 'http://www.ufc-info.com/upcomingEvents'
        }, function(error, response, body) {
            if (error || response.statusCode !== 200) {
                throw Error('couldn t get events from UfcInfoCom ');
            }

            try {
                var arrEvents = JSON.parse(body);

            } catch (e) {
                throw Error('couldn t get fixtures from UfcInfoCom');
            }
            if (arrEvents.length == 0) {
                throw Error('events array empty, couldn t get events from UfcInfoCom');
            }

            arrEvents = arrEvents.upcomingEvents.concat(arrEvents.pastEvents);

            //console.log(JSON.stringify(arrEvents) + "\n\n\n");
            arrEvents.forEach(function(event) {

                request({
                    url: 'http://www.ufc-info.com/event/' + event.id
                }, function(error, response, body) {

                    if (error || response.statusCode !== 200) {
                        throw Error('couldn t get event ' + event.id + 'from UfcInfoCom ');
                    }
                    try {
                        var arrEvent = JSON.parse(body);

                    } catch (e) {
                        throw Error('couldn t get events from UfcInfoCom');
                    }

                    console.log("reading event " + event.id + "\n\n\n");

                    var arrGames = arrEvent.matchups.map(matchup => {
                        if (matchup.fighter1_last_name) {
                            let fighter1Name = matchup.fighter1_first_name.concat(' ', matchup.fighter1_last_name);
                            let fighter2Name = matchup.fighter2_first_name.concat(' ', matchup.fighter2_last_name);
                            return {
                                homeTeam: fighter1Name,
                                awayTeam: fighter2Name,
                                date: moment.utc(event.date),
                                urlResult: 'http://www.ufc-info.com/event' + event.id + "/" + matchup.id,
                                feedName: fighter1Name.replace(/\s/g, '').toUpperCase() + '_' + fighter2Name.replace(/\s/g, '').toUpperCase() + '_' + moment.utc(event.date).format("YYYY-MM-DD")
                            }
                        }
                    });
                    calendar[category][keyWord].feedNames = {};
                    arrGames.forEach(function(game) {
                        if (typeof game === 'object') {
                            calendar[category][keyWord].feedNames[game.feedName] = game;
                        }

                    });

                    calendar[category][keyWord].getResult = function(url) {

                    };

                    console.log(JSON.stringify(calendar[category][keyWord]) + "\n\n\n");


                });
            });

        }

    );



}


eventBus.on('my_transactions_became_stable', function(arrUnits){
	var device = require('byteballcore/device.js');
	db.query("SELECT feed_name FROM data_feeds WHERE unit IN(?)", [arrUnits], function(rows){
		rows.forEach(row => {
			let feed_name = row.feed_name;
			if (!assocDeviceAddressesByFeedName[feed_name])
				return;
			let arrDeviceAddresses = _.uniq(assocDeviceAddressesByFeedName[feed_name].addresses);
			arrDeviceAddresses.forEach(device_address => {
				device.sendMessageToDevice(device_address, 'text', "The data about the sports event "+feed_name+" is now in the database, you can unlock your contract.");
			});
			delete assocDeviceAddressesByFeedName[feed_name];
		});
	});
});


//////

eventBus.on('headless_wallet_ready', function(){
	if (!conf.admin_email || !conf.from_email){
		console.log("please specify admin_email and from_email in your "+desktopApp.getAppDataDir()+'/conf.json');
		process.exit(1);
	}
	if (!conf.footballDataApiKey){
		console.log("please specify footballDataApiKey in your "+desktopApp.getAppDataDir()+'/conf.json');
		process.exit(1);
	}
	headlessWallet.readSingleAddress(function(address){
		my_address = address;
	});
});
