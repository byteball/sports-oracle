const db = require('ocore/db.js');
const conf = require('ocore/conf.js');
const headlessWallet = require('headless-obyte');
const calendar = require('./calendar.js');
const datafeeds = require('./datafeeds.js');
const eventBus = require('ocore/event_bus.js');
const moment = require('moment');

var my_address;

eventBus.on('aa_definition_saved', function (payload) {

	var base_aa = payload.definition[1].base_aa;
	console.log("base_aa " + base_aa);
	if (!base_aa || base_aa != conf.issuer_base_aa)
		return;
	checkAndAddRequestedFixture(payload.definition[1].params);
});


function checkAndAddRequestedFixture(params){

	if (!my_address) // definition can be saved while headless wallet is not ready yet
		setTimeout(function(){
			checkAndAddRequestedFixture(params)
		}, 5000);

		console.log(JSON.stringify(params));
	if (params.oracle !== my_address)
		return;
	
	const feedName = params.championship + '_' +  params.home_team + '_'  +  params.away_team + '_' +  params.expiry_date;
	console.log(feedName);
	var fixture = calendar.getFixtureFromFeedName(feedName);
		console.log(fixture);
	if (fixture){
		var resultHelper = calendar.getResultHelperFromFeedName(feedName);
		var championship = calendar.getChampionshipFromFeedName(feedName);
		
		if (!resultHelper || !championship)
			return console.log("no helper or championship");

		if (fixture.date.isBefore(moment().subtract(resultHelper.hoursToWaitBeforeGetResult, 'hours'))) {
			datafeeds.readExisting(feedName, function(exists) {
				if (!exists)
					db.query("INSERT OR IGNORE INTO requested_fixtures (feed_name, fixture_date, result_url, hours_to_wait) VALUES (?,?,?,?) ",[feedName, fixture.date.format("YYYY-MM-DD HH:mm:ss"),fixture.urlResult,resultHelper.hoursToWaitBeforeGetResult]);
			});
		}
	}
}

eventBus.on('headless_wallet_ready', function() {

	headlessWallet.readSingleAddress(function(address) {
		my_address = address;
	});
});