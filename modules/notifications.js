/*jslint node: true */
'use strict';
var conf = require('ocore/conf.js');
var mail = require('ocore/mail.js');

function notifyAdmin(subject, body){
	console.log('notifyAdmin:\n'+subject+'\n'+body);
	mail.sendmail({
		to: conf.admin_email,
		from: conf.from_email,
		subject: subject,
		body: body
	});
}

function notifyAdminAboutFailedPosting(err){
	notifyAdmin('posting failed: '+err, err);
}

function notifyAdminAboutPostingProblem(err){
	notifyAdmin('posting problem: '+err, err);
}

exports.notifyAdmin = notifyAdmin;
exports.notifyAdminAboutFailedPosting = notifyAdminAboutFailedPosting;
exports.notifyAdminAboutPostingProblem = notifyAdminAboutPostingProblem;

