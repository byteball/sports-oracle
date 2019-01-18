/*jslint node: true */
"use strict";
const db = require('ocore/db.js');
const async = require('async');

function getTxtCommandButton(label, command) {
	var text = "";
	var _command = command ? command : label;
	text += "[" + label + "]" + "(command:" + _command + ")";
	return text;
}


function removeAbbreviations(text) {
	return text.replace(/\b(AC|ADO|AFC|AJ|AS|BSC|CF|EA|EC|ES|FC|FCO|FSV|GO|JC|LB|NAC|MSV|OGC|OSC|PR|RC|SC|PEC|SCO|SM|SV|TSG|US|VfB|VfL)\b/g, '').trim();
}

function removeAccents(str) {
	var accents = 'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž';
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

function deleteFromDB(feedName){

	db.takeConnectionFromPool(function(conn) {
		var arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		conn.addQuery(arrQueries, "DELETE FROM requested_fixtures WHERE feed_name=?",[feedName]);
		conn.addQuery(arrQueries, "DELETE FROM devices_having_requested_fixture WHERE feed_name=?",[feedName]);
		conn.addQuery(arrQueries, "COMMIT");
		async.series(arrQueries, function() {
			conn.release();
		});
	});
	
}

exports.getTxtCommandButton = getTxtCommandButton;
exports.removeAbbreviations = removeAbbreviations;
exports.removeAccents = removeAccents;
exports.deleteFromDB = deleteFromDB;