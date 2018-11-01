/*jslint node: true */
"use strict";
const _ = require('lodash');

var calendar = {};


function deleteAllFixturesFromChampionship(championship) {

	let category = getCategoryFromChampionship(championship);
	
	if (calendar[category] && calendar[category][championship])
		calendar[category][championship].fixtures = {};

}

function deleteFixturesFromChampionshipAndDay(championship, date) {

	let category = getCategoryFromChampionship(championship);

	if (calendar[category] && calendar[category][championship]){
		for (var feedName in calendar[category][championship].fixtures){
			if (calendar[category][championship].fixtures[feedName].localDay.format("YYYY-MM-DD") === date.format("YYYY-MM-DD")){
				delete calendar[category][championship][feedName];
			}
		}
	}
}



function setReloadingFlag(championship, state){
	
	let category = getCategoryFromChampionship(championship);
	
	if (!calendar[category])
		calendar[category] = {};
	
	if (!calendar[category][championship])
		calendar[category][championship] = {};
	
	calendar[category][championship].isReloading = state;
	
	
}


function isThereChampionshipReloading() {

	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].isReloading)
				return true;
		}

	}
	return false;
}

function addFixture(category, championship, feedName, fixtureDescription) {

	if (!calendar[category])
		calendar[category] = {};

	if (!calendar[category][championship])
		calendar[category][championship] = {};

	if (!calendar[category][championship].fixtures)
		calendar[category][championship].fixtures = {};

	if (!calendar[category][championship].fixtures[feedName])
		calendar[category][championship].fixtures[feedName] = {};

	calendar[category][championship].fixtures[feedName] = fixtureDescription;
	console.log("\nAdding " + championship + " " + feedName);
}

function addResultHelper(category, championship, resultHelper) {

	if (!calendar[category])
		calendar[category] = {};

	if (!calendar[category][championship])
		calendar[category][championship] = {};

	calendar[category][championship].resultHelper = resultHelper;
}

function getFixtureFromFeedName(feedName) {
	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].fixtures && calendar[cat][champ].fixtures[feedName])
				return calendar[cat][champ].fixtures[feedName];
		}
	}
	return null;
}

function getResultHelperFromFeedName(feedName) {
	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].fixtures && calendar[cat][champ].fixtures[feedName])
				return calendar[cat][champ].resultHelper;
		}

	}
	return null;
}

function getAllfixturesFromChampionship(championship) {
	for (var cat in calendar) {
		if (calendar[cat][championship])
			return calendar[cat][championship].fixtures;
	}
	return false;

}

function getAllCategories() {
	return Object.keys(calendar);
}

function getAllChampionshipsFromCategory(category) {
	return Object.keys(calendar[category]);
}

function getCategoryFromChampionship(championship) {
	for (var cat in calendar) {
		if (calendar[cat][championship])
			return cat;
	}
	return null;
}

function getCategoryFromFeedName(feedName) {
	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].fixtures && calendar[cat][champ].fixtures[feedName])
				return cat;
		}
	}
	return null;
}

function getChampionshipFromFeedName(feedName) {
	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].fixtures && calendar[cat][champ].fixtures[feedName])
				return champ;
		}
	}
	return null;
}


function deleteFixture(feedName) {
	for (var cat in calendar) {
		for (var champ in calendar[cat]) {
			if (calendar[cat][champ].fixtures && calendar[cat][champ].fixtures[feedName])
				delete calendar[cat][champ].fixtures[feedName];
		}
	}

}


function isExistingCategorie(category) {
	if (calendar[category])
		return true;
	return false;
}

function isExistingChampionship(championship) {
	for (var cat in calendar) {
		if (calendar[cat][championship])
			return true;
	}
	return false;
}


function getPublicCalendar() {
	var publicCalendar = _.cloneDeep(calendar);
	for (var cat in publicCalendar) {
		for (var championship in publicCalendar[cat]) { //we delete unneeded attributes
			delete publicCalendar[cat][championship].resultHelper;
			for (var feedName in publicCalendar[cat][championship].fixtures) {
				delete publicCalendar[cat][championship].fixtures[feedName].urlResult;
				delete publicCalendar[cat][championship].fixtures[feedName].feedName;
			}
		}
	}
	return JSON.stringify(publicCalendar);
}

function isAmericanDST(event_day){
	if (event_day > "2018-11-03" && event_day < "2019-03-10")
		return false;
	else
		return true;
}

exports.addFixture = addFixture;
exports.addResultHelper = addResultHelper;
exports.getFixtureFromFeedName = getFixtureFromFeedName;
exports.getResultHelperFromFeedName = getResultHelperFromFeedName;
exports.getAllfixturesFromChampionship = getAllfixturesFromChampionship;
exports.getAllCategories = getAllCategories;
exports.getAllChampionshipsFromCategory = getAllChampionshipsFromCategory;
exports.deleteFixture = deleteFixture;
exports.isExistingCategorie = isExistingCategorie;
exports.isExistingChampionship = isExistingChampionship;
exports.getPublicCalendar = getPublicCalendar;
exports.getCategoryFromFeedName = getCategoryFromFeedName;
exports.getCategoryFromChampionship = getCategoryFromChampionship;
exports.getChampionshipFromFeedName = getChampionshipFromFeedName;
exports.isAmericanDST = isAmericanDST;
exports.setReloadingFlag = setReloadingFlag;
exports.isThereChampionshipReloading = isThereChampionshipReloading;
exports.deleteAllFixturesFromChampionship = deleteAllFixturesFromChampionship;
exports.deleteFixturesFromChampionshipAndDay = deleteFixturesFromChampionshipAndDay;