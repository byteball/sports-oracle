/*jslint node: true */
"use strict";

function getTxtCommandButton(label, command) {
	var text = "";
	var _command = command ? command : label;
	text += "[" + label + "]" + "(command:" + _command + ")";
	return text;
}


function removeAbbreviations(text) {
	return text.replace(/\b(AC|ADO|AFC|AJ|AS|AZ|BSC|CF|EA|EC|ES|FC|FCO|FSV|GO|JC|LB|NAC|MSV|OGC|OSC|PR|RC|SC|PEC|PSV|SCO|SM|SV|TSG|US|VfB|VfL)\b/g, '').trim();
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

exports.getTxtCommandButton = getTxtCommandButton;
exports.removeAbbreviations = removeAbbreviations;
exports.removeAccents = removeAccents;